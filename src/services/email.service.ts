import axios from 'axios';
import logger from '../utils/logger';

/**
 * Envio de e-mail transacional pela API HTTP do Resend (https://resend.com).
 * HTTP em vez de SMTP porque alguns provedores de hospedagem bloqueiam SMTP de saída.
 *
 * Variáveis de ambiente:
 *   EMAIL_API_KEY — chave da API do Resend (nunca no código)
 *   EMAIL_FROM    — remetente, ex.: "DashFood <nao-responda@seudominio.com>"
 */
const RESEND_URL = 'https://api.resend.com/emails';

export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<void> {
  const apiKey = process.env.EMAIL_API_KEY;
  if (!apiKey) {
    throw new Error('EMAIL_API_KEY não configurada — não é possível enviar e-mail.');
  }
  const from = process.env.EMAIL_FROM || 'DashFood <onboarding@resend.dev>';

  try {
    await axios.post(
      RESEND_URL,
      { from, to: [to], subject, text, html },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10_000 }
    );
    logger.info(`[Email] "${subject}" enviado para ${to}`);
  } catch (err: any) {
    const detail = err.response?.data?.message || err.message;
    logger.error(`[Email] Falha ao enviar para ${to}: ${detail}`);
    throw new Error('Falha ao enviar e-mail');
  }
}
