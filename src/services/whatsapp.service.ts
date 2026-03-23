import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import logger from '../utils/logger';
import { handleMessage } from './chatbot.service';
import { tenantStorage } from '../database/tenantContext';

function removeSingletonLock(dataPath: string): void {
  try {
    console.log(`[WhatsApp] removeSingletonLock iniciado para: ${dataPath}`);
    if (!fs.existsSync(dataPath)) {
      console.log(`[WhatsApp] dataPath não existe: ${dataPath}`);
      return;
    }
    const found = execSync(`find "${dataPath}" \\( -name "SingletonLock" -o -name "SingletonCookie" -o -name "SingletonSocket" \\) 2>/dev/null || true`, { encoding: 'utf8' }).trim();
    console.log(`[WhatsApp] Locks encontrados: ${found || '(nenhum)'}`);
    if (found) {
      execSync(`find "${dataPath}" \\( -name "SingletonLock" -o -name "SingletonCookie" -o -name "SingletonSocket" \\) -delete 2>/dev/null || true`);
      console.log('[WhatsApp] Locks removidos com sucesso');
    }
  } catch (e: any) {
    console.warn('[WhatsApp] Erro ao remover lock:', e.message);
  }
}

let client: Client | null = null;
let qrCodeData: string | null = null;
let isReady = false;
let initializing = false;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

export function initWhatsApp(): void {
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

  // Matar processos Chromium stale que possam ter sobrado
  try { execSync('pkill -f chromium || true', { stdio: 'ignore' }); } catch { /* ignora */ }

  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const dataPath = process.env.WWEBJS_DATA_PATH || '.wwebjs_auth';
  console.log(`[WhatsApp] dataPath: ${dataPath}`);
  console.log(`[WhatsApp] executablePath: ${execPath || '(bundled)'}`);
  console.log(`[WhatsApp] platform: ${process.platform}`);

  client = new Client({
    authStrategy: new LocalAuth({ dataPath }),
    puppeteer: {
      headless: true,
      executablePath: execPath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu'
      ]
    }
  });

  client.on('qr', (qr: string) => {
    console.log('[WhatsApp] QR event disparado, gerando imagem...');
    qrCodeData = qr;
    isReady = false;
    logger.info('QR Code recebido! Escaneie pelo WhatsApp:');
    qrTerminal.generate(qr, { small: true });
  });

  client.on('ready', () => {
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
    isReady = true;
    qrCodeData = null;
    initializing = false;
    logger.info('WhatsApp conectado com sucesso!');
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
    logger.info('[WhatsApp] Reiniciando em 5s após desconexão...');
    setTimeout(() => initWhatsApp(), 5000);
  });

  const whatsappTenantContext = {
    tenantId: process.env.WHATSAPP_TENANT_ID || 'default',
    dbName: process.env.DB_NAME || 'Pizzaria',
    userId: 'whatsapp-bot',
  };

  client.on('message', async (message: Message) => {
    try {
      if (message.fromMe || message.from.endsWith('@g.us') || message.from === 'status@broadcast') return;
      if (!message.body) return;

      const reply = await tenantStorage.run(whatsappTenantContext, () =>
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

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const number = digits.startsWith('55') && digits.length >= 12 ? digits : `55${digits}`;
  return `${number}@c.us`;
}

export const sendTextMessage = async (to: string, text: string) => {
  if (!isReady || !client) {
    throw new Error('WhatsApp não está conectado. Escaneie o QR Code primeiro.');
  }
  const chatId = formatPhone(to);
  const result = await client.sendMessage(chatId, text);
  return { id: result.id._serialized, to: chatId, status: 'sent' };
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
