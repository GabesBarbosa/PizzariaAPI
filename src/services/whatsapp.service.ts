import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { handleMessage, cleanPhone } from './chatbot.service';
import { renewHandoff } from './handoff.service';
import { businessStorage } from '../database/businessContext';
import { broadcast } from './notification.service';

/* ─── Logger silencioso para Baileys (usa pino internamente) ─── */

const baileysLogger = pino({ level: 'silent' });

/* ─── Estado por negócio ─── */

interface BusinessWhatsAppState {
  socket: WASocket | null;
  qrCodeData: string | null;
  isReady: boolean;
  initializing: boolean;
  processedMessages: Set<string>;
  retryCount: number;
  // Cache LID → JID real (e.g. "21131272695827@lid" → "5511910731832@s.whatsapp.net")
  lidCache: Map<string, string>;
  // Grace period antes de reportar desconexão ao frontend
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  // IDs das mensagens enviadas pelo bot. Mensagens "fromMe" fora desse Set foram
  // digitadas pelo dono no celular (usado para manter o modo atendente humano).
  botSentIds: Set<string>;
}

const BOT_SENT_TTL = 10 * 60 * 1000;
// O Baileys pode emitir o evento da própria mensagem antes de sendMessage() devolver o ID,
// então a checagem de "foi o bot ou o dono?" espera um pouco.
const OWN_MESSAGE_CHECK_DELAY = 3000;

function rememberBotMessage(state: BusinessWhatsAppState, id: string | null | undefined): void {
  if (!id) return;
  state.botSentIds.add(id);
  setTimeout(() => state.botSentIds.delete(id), BOT_SENT_TTL);
}

/** Resolve um JID (inclusive @lid) para o JID com o número real do contato. */
async function resolveContactJid(state: BusinessWhatsAppState, jid: string): Promise<string> {
  const normalizedJid = jidNormalizedUser(jid);
  if (!normalizedJid.endsWith('@lid')) return normalizedJid;

  // 1) Resolvedor nativo do Baileys (persistido no auth state, alimentado pelo
  //    próprio protocolo Signal) — mais confiável que o cache local abaixo, que só
  //    enche quando o evento de sincronização de contatos dispara (nem sempre acontece).
  let fromSignal: string | null = null;
  try {
    fromSignal = (await state.socket?.signalRepository?.lidMapping?.getPNForLID(normalizedJid)) ?? null;
  } catch (err: any) {
    logger.warn(`[WhatsApp] Falha ao resolver LID via signalRepository: ${err.message}`);
  }

  const fromCache = state.lidCache.get(normalizedJid);
  const fromContacts = (state.socket as any)?.contacts?.[normalizedJid]?.id;
  const resolvedJid = fromSignal ?? fromCache ?? fromContacts ?? normalizedJid;

  if (resolvedJid !== normalizedJid) {
    state.lidCache.set(normalizedJid, resolvedJid); // memoriza pra não bater no signalRepository de novo
  }

  logger.info(`[WhatsApp] LID detectado: ${normalizedJid} | signalRepository: ${fromSignal ?? 'miss'} | cache: ${fromCache ?? 'miss'} | contacts: ${fromContacts ?? 'miss'} | resolvido: ${resolvedJid}`);
  return resolvedJid;
}

const MAX_RETRIES = 5;
const businessClients = new Map<string, BusinessWhatsAppState>();

function getState(businessId: string): BusinessWhatsAppState {
  let state = businessClients.get(businessId);
  if (!state) {
    state = {
      socket: null,
      qrCodeData: null,
      isReady: false,
      initializing: false,
      processedMessages: new Set(),
      retryCount: 0,
      lidCache: new Map(),
      disconnectTimer: null,
      botSentIds: new Set(),
    };
    businessClients.set(businessId, state);
  }
  return state;
}

/* ─── Inicialização por negócio ─── */

export async function initWhatsApp(businessId: string): Promise<void> {
  const state = getState(businessId);

  if (state.initializing) {
    console.log(`[WhatsApp:${businessId}] Já inicializando, ignorando.`);
    return;
  }

  if (state.retryCount >= MAX_RETRIES) {
    console.error(`[WhatsApp:${businessId}] Limite de ${MAX_RETRIES} tentativas. Use restart.`);
    return;
  }

  state.initializing = true;
  state.qrCodeData = null;
  state.isReady = false;

  if (state.socket) {
    try { state.socket.end(undefined); } catch { /* ignora */ }
    state.socket = null;
  }

  const baseDataPath = process.env.WWEBJS_DATA_PATH || '.wwebjs_auth';
  const authDir = path.join(baseDataPath, businessId);

  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  console.log(`[WhatsApp:${businessId}] authDir: ${authDir} (tentativa ${state.retryCount + 1}/${MAX_RETRIES})`);

  try {
    const { state: authState, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();
    console.log(`[WhatsApp:${businessId}] Usando versão WA: ${version}`);

    const socket = makeWASocket({
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, baileysLogger),
      },
      version,
      logger: baileysLogger,
      defaultQueryTimeoutMs: 60000,
    });

    state.socket = socket;

    const businessContext = {
      businessId,
      userId: 'whatsapp-bot',
      role: 'bot',
    };

    // ── Persistir credenciais ──
    socket.ev.on('creds.update', saveCreds);

    // ── Cache de contatos: mapeia LID → JID real ──
    socket.ev.on('contacts.upsert', (contacts) => {
      for (const contact of contacts) {
        if (contact.lid && contact.id) {
          state.lidCache.set(contact.lid, contact.id);
          logger.info(`[WhatsApp] LID mapeado (upsert): ${contact.lid} → ${contact.id}`);
        }
      }
    });
    socket.ev.on('contacts.update', (updates) => {
      for (const upd of updates) {
        if (upd.lid && upd.id) {
          state.lidCache.set(upd.lid, upd.id);
          logger.info(`[WhatsApp] LID mapeado (update): ${upd.lid} → ${upd.id}`);
        }
      }
    });

    // ── Eventos de conexão ──
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // QR Code recebido — enviar para o frontend
      if (qr) {
        console.log(`[WhatsApp:${businessId}] QR Code recebido.`);
        state.qrCodeData = qr;
        state.isReady = false;
        state.retryCount = 0;
        try {
          const qrImage = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
          broadcast('whatsapp-status', { businessId, connected: false, qrCode: qrImage }, businessId);
        } catch { /* ignora */ }
      }

      // Conectado — cancela qualquer grace period pendente
      if (connection === 'open') {
        if (state.disconnectTimer) {
          clearTimeout(state.disconnectTimer);
          state.disconnectTimer = null;
        }
        state.isReady = true;
        state.qrCodeData = null;
        state.initializing = false;
        state.retryCount = 0;
        logger.info(`[WhatsApp:${businessId}] Conectado com sucesso!`);
        broadcast('whatsapp-status', { businessId, connected: true, qrCode: null }, businessId);
      }

      // Desconectado
      if (connection === 'close') {
        state.initializing = false;
        state.socket = null;

        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;

        if (statusCode === DisconnectReason.loggedOut) {
          // Logout definitivo — reporta imediatamente
          if (state.disconnectTimer) { clearTimeout(state.disconnectTimer); state.disconnectTimer = null; }
          state.isReady = false;
          state.qrCodeData = null;
          logger.warn(`[WhatsApp:${businessId}] Deslogado. Limpando sessão...`);
          try { fs.rmSync(authDir, { recursive: true, force: true }); } catch { /* ignora */ }
          state.retryCount = 0;
          broadcast('whatsapp-status', { businessId, connected: false, qrCode: null }, businessId);
          setTimeout(() => initWhatsApp(businessId), 2000);
        } else {
          // Desconexão temporária — aguarda 8s antes de reportar ao frontend
          // (reconexões normais do Baileys se resolvem antes disso)
          state.retryCount++;
          const delay = Math.min(5000 * state.retryCount, 30000);
          logger.warn(`[WhatsApp:${businessId}] Desconectado (code=${statusCode}). Retry em ${delay / 1000}s...`);
          setTimeout(() => initWhatsApp(businessId), delay);

          if (!state.disconnectTimer) {
            state.disconnectTimer = setTimeout(() => {
              state.disconnectTimer = null;
              if (!state.isReady) {
                state.isReady = false;
                state.qrCodeData = null;
                broadcast('whatsapp-status', { businessId, connected: false, qrCode: null }, businessId);
                logger.warn(`[WhatsApp:${businessId}] Grace period esgotado — reportando desconexão.`);
              }
            }, 8_000);
          }
        }
      }
    });

    // ── Mensagens recebidas ──
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const msg of messages) {
        try {
          if (!msg.message) continue;
          if (msg.key.remoteJid?.endsWith('@g.us')) continue;
          if (msg.key.remoteJid === 'status@broadcast') continue;

          // Mensagem enviada pelo próprio número. Se não foi o bot, foi o dono
          // digitando no celular: mantém a conversa em modo atendente humano.
          if (msg.key.fromMe) {
            const ownId = msg.key.id;
            const ownJid = msg.key.remoteJid;
            if (ownId && ownJid) {
              setTimeout(async () => {
                if (state.botSentIds.has(ownId)) return;
                try {
                  const phone = cleanPhone(await resolveContactJid(state, ownJid));
                  if (phone) renewHandoff(businessId, phone);
                } catch { /* ignora */ }
              }, OWN_MESSAGE_CHECK_DELAY);
            }
            continue;
          }

          if (type !== 'notify') continue;

          const msgId = msg.key.id;
          if (!msgId || state.processedMessages.has(msgId)) continue;
          state.processedMessages.add(msgId);
          setTimeout(() => state.processedMessages.delete(msgId), 60_000);

          // Extrai texto (mensagem normal ou citação)
          const body =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            '';

          if (!body) continue;

          const replyJid = msg.key.remoteJid!;
          const phone = await resolveContactJid(state, replyJid);

          const reply = await businessStorage.run(businessContext, () =>
            handleMessage(phone, body)
          );

          if (reply && state.socket) {
            const sent = await state.socket.sendMessage(replyJid, { text: reply });
            rememberBotMessage(state, sent?.key.id);
          }
        } catch (err: any) {
          logger.error(`[WhatsApp:${businessId}] Erro ao processar mensagem: ${err.message}`);
        }
      }
    });

    state.initializing = false;

  } catch (err: any) {
    console.error(`[WhatsApp:${businessId}] Erro ao inicializar:`, err.message || err);
    state.initializing = false;
    state.retryCount++;

    if (state.retryCount < MAX_RETRIES) {
      const delay = Math.min(10000 * state.retryCount, 30000);
      console.log(`[WhatsApp:${businessId}] Retry em ${delay / 1000}s...`);
      setTimeout(() => initWhatsApp(businessId), delay);
    }
  }
}

/* ─── Status (lazy init: primeira chamada inicia o WhatsApp) ─── */

export async function getStatus(businessId: string): Promise<{ connected: boolean; qrCode: string | null }> {
  const state = getState(businessId);

  // Só inicia se não há socket, não está inicializando e não há reconexão pendente
  if (!state.isReady && !state.initializing && !state.socket && !state.disconnectTimer) {
    state.retryCount = 0;
    initWhatsApp(businessId);
  }

  let qrImage: string | null = null;
  if (state.qrCodeData) {
    try {
      qrImage = await QRCode.toDataURL(state.qrCodeData, { width: 280, margin: 2 });
    } catch { /* ignora */ }
  }

  return { connected: state.isReady, qrCode: qrImage };
}

/* ─── Restart ─── */

export async function restartWhatsApp(businessId: string): Promise<void> {
  logger.info(`[WhatsApp:${businessId}] Restart solicitado.`);
  const state = getState(businessId);
  state.initializing = false;
  state.retryCount = 0;
  if (state.socket) {
    try { state.socket.end(undefined); } catch { /* ignora */ }
    state.socket = null;
  }
  setTimeout(() => initWhatsApp(businessId), 1000);
}

/* ─── Envio de mensagens ─── */

function buildJid(phone: string): string {
  // Remove tudo que não é dígito e garante código do país
  const digits = phone.replace(/\D/g, '');
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  return `${withCountry}@s.whatsapp.net`;
}

export const sendTextMessage = async (businessId: string, to: string, text: string) => {
  const state = getState(businessId);
  if (!state.isReady || !state.socket) {
    throw new Error('WhatsApp não está conectado. Escaneie o QR Code primeiro.');
  }

  const jid = buildJid(to);

  const results = await state.socket.onWhatsApp(jid);
  const result = results?.[0];
  if (!result?.exists) {
    throw new Error(`Número ${to} não está registrado no WhatsApp.`);
  }

  const sent = await state.socket.sendMessage(result.jid, { text });
  rememberBotMessage(state, sent?.key.id);
  return { id: sent?.key.id, to: result.jid, status: 'sent' };
};

export const sendBulkMessages = async (
  businessId: string,
  phones: string[],
  text: string
): Promise<{ success: string[]; failed: { phone: string; error: string }[] }> => {
  const state = getState(businessId);
  if (!state.isReady) {
    throw new Error('WhatsApp não está conectado. Escaneie o QR Code primeiro.');
  }

  const success: string[] = [];
  const failed: { phone: string; error: string }[] = [];

  for (const phone of phones) {
    try {
      await sendTextMessage(businessId, phone, text);
      success.push(phone);
    } catch (err: any) {
      failed.push({ phone, error: err.message || 'Erro desconhecido' });
    }
  }

  return { success, failed };
};
