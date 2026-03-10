import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import logger from '../utils/logger';
import { handleMessage } from './chatbot.service';

let client: Client;
let qrCodeData: string | null = null;
let isReady = false;

export function initWhatsApp(): void {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/niconeitor/niconeitor/refs/heads/master/niconeitor.json'
    },
    puppeteer: {
      headless: true,
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
    logger.error('Falha na autenticação do WhatsApp:', msg);
  });

  client.on('disconnected', (reason: string) => {
    isReady = false;
    logger.warn('WhatsApp desconectado:', reason);
  });

  client.on('message', async (message: Message) => {
    try {
      if (message.fromMe || message.from.endsWith('@g.us') || message.from === 'status@broadcast') return;
      if (!message.body) return;

      const reply = await handleMessage(message.from, message.body);
      if (reply) await client.sendMessage(message.from, reply);
    } catch (err: any) {
      logger.error(`[WhatsApp Bot] Erro ao processar mensagem de ${message.from}: ${err.message}`);
    }
  });

  console.log('[WhatsApp] Iniciando client... aguarde o QR Code.');
  client.initialize().catch((err: any) => {
    console.error('[WhatsApp] Erro ao inicializar:', err.message || err);
  });
}

export async function getStatus(): Promise<{ connected: boolean; qrCode: string | null }> {
  let qrImage: string | null = null;
  if (qrCodeData) {
    try {
      qrImage = await QRCode.toDataURL(qrCodeData, { width: 280, margin: 2 });
    } catch {
      qrImage = null;
    }
  }
  return { connected: isReady, qrCode: qrImage };
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
