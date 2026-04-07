import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import logger from '../utils/logger';
import { handleMessage } from './chatbot.service';
import { businessStorage } from '../database/businessContext';
import { broadcast } from './notification.service';

let client: Client | null = null;
let qrCodeData: string | null = null;
let isReady = false;
let initializing = false;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
const processedMessages = new Set<string>();

function removeSingletonLock(dataPath: string): void {
  const lockPaths = [
    path.join(dataPath, 'session-default', 'SingletonLock'),
    path.join(dataPath, 'session-default', 'SingletonCookie'),
    path.join(dataPath, 'session-default', 'SingletonSocket'),
  ];
  for (const lockPath of lockPaths) {
    try {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
        console.log(`[WhatsApp] Lock removido: ${lockPath}`);
      }
    } catch { /* ignora */ }
  }
}

export async function initWhatsApp(): Promise<void> {
  if (initializing) {
    console.log('[WhatsApp] Já inicializando, ignorando chamada duplicada.');
    return;
  }
  initializing = true;
  qrCodeData = null;
  isReady = false;

  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }

  if (client) {
    try { client.removeAllListeners(); client.destroy(); } catch { /* ignora */ }
    client = null;
  }

  // Matar processos Chromium stale (apenas Linux)
  if (process.platform !== 'win32') {
    try { execSync('pkill -f chromium || true', { stdio: 'ignore' }); } catch { /* ignora */ }
  }

  const isWindows = process.platform === 'win32';
  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const dataPath = process.env.WWEBJS_DATA_PATH || '.wwebjs_auth';
  console.log(`[WhatsApp] dataPath: ${dataPath}`);
  console.log(`[WhatsApp] executablePath: ${execPath || '(bundled)'}`);
  console.log(`[WhatsApp] platform: ${process.platform}`);

  const baseArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--no-first-run',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-features=IsolateOrigins,site-per-process',
  ];

  // --single-process é necessário em containers Linux (Azure) mas quebra no Windows
  if (!isWindows) {
    baseArgs.push('--single-process');
  }

  client = new Client({
    authStrategy: new LocalAuth({ dataPath }),
    webVersion: '2.2412.54',
    webVersionCache: {
      type: 'local',
      path: process.env.WWEBJS_CACHE_PATH || (isWindows ? '.wwebjs_cache' : '/app/wwebjs_cache'),
    },
    puppeteer: {
      headless: true,
      executablePath: execPath,
      timeout: 60000,
      args: baseArgs,
    }
  });

  client.on('qr', async (qr: string) => {
    console.log('[WhatsApp] QR event disparado, gerando imagem...');
    qrCodeData = qr;
    isReady = false;
    logger.info('QR Code recebido! Escaneie pelo WhatsApp:');
    qrTerminal.generate(qr, { small: true });
    try {
      const qrImage = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
      broadcast('whatsapp-status', { connected: false, qrCode: qrImage });
    } catch { /* ignora */ }
  });

  client.on('ready', () => {
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
    isReady = true;
    qrCodeData = null;
    initializing = false;
    logger.info('WhatsApp conectado com sucesso!');
    broadcast('whatsapp-status', { connected: true, qrCode: null });
  });

  client.on('authenticated', () => {
    logger.info('WhatsApp autenticado!');
    // Watchdog único: reinicia se ready não disparar em 3 minutos
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
      watchdogTimer = null;
      if (!isReady) {
        console.warn('[WhatsApp] Timeout: ready não disparou após autenticação. Reiniciando...');
        initializing = false;
        try { client?.removeAllListeners(); client?.destroy(); } catch {}
        client = null;
        initWhatsApp();
      }
    }, 3 * 60 * 1000);
  });

  client.on('auth_failure', (msg: string) => {
    isReady = false;
    qrCodeData = null;
    initializing = false;
    logger.error('Falha na autenticação do WhatsApp:', msg);
    logger.info('[WhatsApp] Reiniciando em 5s após auth_failure...');
    setTimeout(() => initWhatsApp(), 5000);
  });

  client.on('disconnected', (reason: string) => {
    isReady = false;
    qrCodeData = null;
    initializing = false;
    logger.warn('WhatsApp desconectado:', reason);
    broadcast('whatsapp-status', { connected: false, qrCode: null });
    logger.info('[WhatsApp] Reiniciando em 5s após desconexão...');
    setTimeout(() => initWhatsApp(), 5000);
  });

  const whatsappBusinessContext = {
    businessId: process.env.WHATSAPP_BUSINESS_ID || '',
    userId: 'whatsapp-bot',
    role: 'bot',
  };

  client.on('message', async (message: Message) => {
    try {
      if (message.fromMe || message.from.endsWith('@g.us') || message.from === 'status@broadcast') return;
      if (!message.body) return;

      const msgId = message.id._serialized;
      if (processedMessages.has(msgId)) return;
      processedMessages.add(msgId);
      setTimeout(() => processedMessages.delete(msgId), 60_000);

      // Resolve o número real do cliente — contas novas usam LID e message.from
      // retorna um ID interno (ex: 12692333056044) ao invés do telefone real.
      // getContact().number retorna o número real (ex: 5511945175747).
      let phoneForBot = message.from;
      try {
        const contact = await (message as any).getContact();
        if (contact?.number) {
          phoneForBot = contact.number + '@c.us';
          if (phoneForBot !== message.from) {
            console.log(`[WhatsApp] LID resolvido: ${message.from} → ${phoneForBot}`);
          }
        }
      } catch {
        // fallback: usa message.from (pode ser LID, mas é o que temos)
      }

      const reply = await businessStorage.run(whatsappBusinessContext, () =>
        handleMessage(message.from, message.body)
      );
      if (reply && client) await client.sendMessage(message.from, reply);
    } catch (err: any) {
      logger.error(`[WhatsApp Bot] Erro ao processar mensagem de ${message.from}: ${err.message}`);
    }
  });

  removeSingletonLock(dataPath);
  console.log('[WhatsApp] Iniciando client... aguarde o QR Code.');
  client.initialize().catch((err: any) => {
    console.error('[WhatsApp] Erro ao inicializar:', err.message || err);
    console.error('[WhatsApp] Stack:', err.stack || '(sem stack)');
    initializing = false;
    console.log('[WhatsApp] Reiniciando em 10s após falha no initialize...');
    setTimeout(() => initWhatsApp(), 10000);
  });
}

export async function getStatus(): Promise<{ connected: boolean; qrCode: string | null }> {
  console.log(`[WhatsApp] getStatus chamado — isReady: ${isReady}, temQR: ${!!qrCodeData}`);
  let qrImage: string | null = null;
  if (qrCodeData) {
    try {
      qrImage = await QRCode.toDataURL(qrCodeData, { width: 280, margin: 2 });
      console.log('[WhatsApp] QR image gerada com sucesso');
    } catch (e: any) {
      console.error('[WhatsApp] Erro ao gerar QR image:', e.message);
      qrImage = null;
    }
  }
  return { connected: isReady, qrCode: qrImage };
}

export function restartWhatsApp(): void {
  logger.info('[WhatsApp] Restart solicitado manualmente.');
  initializing = false;
  try { client?.removeAllListeners(); client?.destroy(); } catch { /* ignora erros no destroy */ }
  client = null;
  setTimeout(() => initWhatsApp(), 1000);
}

function buildPhoneWithCountry(phone: string): string {
  // Todos os números são brasileiros — adiciona 55 se não tiver
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}

export const sendTextMessage = async (to: string, text: string) => {
  if (!isReady || !client) {
    throw new Error('WhatsApp não está conectado. Escaneie o QR Code primeiro.');
  }

  const phone = buildPhoneWithCountry(to);

  // getNumberId resolve o chat ID correto (incluindo contas LID do novo sistema WhatsApp)
  const numberId = await (client as any).getNumberId(phone);
  if (!numberId) {
    throw new Error(`Número ${to} não está registrado no WhatsApp.`);
  }

  const result = await client.sendMessage(numberId._serialized, text);
  return { id: result.id._serialized, to: numberId._serialized, status: 'sent' };
};

export const sendBulkMessages = async (
  phones: string[],
  text: string
): Promise<{ success: string[]; failed: { phone: string; error: string }[] }> => {
  if (!isReady) {
    throw new Error('WhatsApp não está conectado. Escaneie o QR Code primeiro.');
  }

  const success: string[] = [];
  const failed: { phone: string; error: string }[] = [];

  for (const phone of phones) {
    try {
      await sendTextMessage(phone, text);
      success.push(phone);
    } catch (err: any) {
      failed.push({ phone, error: err.message || 'Erro desconhecido' });
    }
  }

  return { success, failed };
};
