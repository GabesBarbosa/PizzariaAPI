import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { handleMessage } from './chatbot.service';
import { tenantStorage } from '../database/tenantContext';

function removeSingletonLock(dataPath: string): void {
  try {
    // whatsapp-web.js LocalAuth usa dataPath/session-{clientId} como userDataDir do Chromium
    const sessionDir = path.join(dataPath, 'session-');
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    for (const f of lockFiles) {
      const lockPath = path.join(sessionDir, f);
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
        console.log(`[WhatsApp] Lock removido: ${lockPath}`);
      }
    }
  } catch (e: any) {
    console.warn('[WhatsApp] Não foi possível remover lock:', e.message);
  }
}

let client: Client;
let qrCodeData: string | null = null;
let isReady = false;

export function initWhatsApp(): void {
  qrCodeData = null;
  isReady = false;

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
    isReady = true;
    qrCodeData = null;
    logger.info('WhatsApp conectado com sucesso!');
  });

  client.on('authenticated', () => {
    logger.info('WhatsApp autenticado!');
  });

  client.on('auth_failure', (msg: string) => {
    isReady = false;
    qrCodeData = null;
    logger.error('Falha na autenticação do WhatsApp:', msg);
    logger.info('[WhatsApp] Reiniciando em 5s após auth_failure...');
    setTimeout(() => initWhatsApp(), 5000);
  });

  client.on('disconnected', (reason: string) => {
    isReady = false;
    qrCodeData = null;
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
      if (reply) await client.sendMessage(message.from, reply);
    } catch (err: any) {
      logger.error(`[WhatsApp Bot] Erro ao processar mensagem de ${message.from}: ${err.message}`);
    }
  });

  removeSingletonLock(dataPath);
  console.log('[WhatsApp] Iniciando client... aguarde o QR Code.');
  client.initialize().catch((err: any) => {
    console.error('[WhatsApp] Erro ao inicializar:', err.message || err);
    console.error('[WhatsApp] Stack:', err.stack || '(sem stack)');
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
  try { client?.destroy(); } catch { /* ignora erros no destroy */ }
  setTimeout(() => initWhatsApp(), 1000);
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const number = digits.startsWith('55') && digits.length >= 12 ? digits : `55${digits}`;
  return `${number}@c.us`;
}

export const sendTextMessage = async (to: string, text: string) => {
  if (!isReady) {
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
