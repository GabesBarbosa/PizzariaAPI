import axios from 'axios';
import logger from '../utils/logger';

/**
 * Envio de e-mail transacional por API HTTP.
 * HTTP em vez de SMTP porque o Railway bloqueia SMTP de saída nos planos Free/Hobby.
 *
 * Provedores aceitos (escolhido pelo formato da chave):
 *   - Brevo  (chave "xkeysib-..."): envia para qualquer destinatário só com um
 *     remetente verificado (um e-mail comum, sem domínio próprio). 300 e-mails/dia grátis.
 *   - Resend (chave "re_..."): sem domínio verificado, só entrega no e-mail do dono da conta.
 *
 * Variáveis de ambiente:
 *   EMAIL_API_KEY — chave do provedor (nunca no código)
 *   EMAIL_FROM    — remetente, ex.: "DashFood <seuemail@gmail.com>"
 *                   (no Brevo, precisa ser um remetente verificado no painel)
 */

function parseFrom(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2] } : { email: from.trim() };
}

async function sendViaBrevo(apiKey: string, from: string, to: string, subject: string, text: string, html?: string) {
  await axios.post(
    'https://api.brevo.com/v3/smtp/email',
    {
      sender: parseFrom(from),
      to: [{ email: to }],
      subject,
      textContent: text,
      ...(html ? { htmlContent: html } : {}),
    },
    { headers: { 'api-key': apiKey, 'content-type': 'application/json' }, timeout: 10_000 }
  );
}

async function sendViaResend(apiKey: string, from: string, to: string, subject: string, text: string, html?: string) {
  await axios.post(
    'https://api.resend.com/emails',
    { from, to: [to], subject, text, html },
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10_000 }
  );
}

export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<void> {
  const apiKey = process.env.EMAIL_API_KEY;
  if (!apiKey) {
    throw new Error('EMAIL_API_KEY não configurada — não é possível enviar e-mail.');
  }
  const isBrevo = apiKey.startsWith('xkeysib-');
  const from = process.env.EMAIL_FROM || 'DashFood <onboarding@resend.dev>';

  try {
    if (isBrevo) await sendViaBrevo(apiKey, from, to, subject, text, html);
    else await sendViaResend(apiKey, from, to, subject, text, html);
    logger.info(`[Email] "${subject}" enviado para ${to} via ${isBrevo ? 'Brevo' : 'Resend'}`);
  } catch (err: any) {
    const detail = err.response?.data?.message || err.message;
    logger.error(`[Email] Falha ao enviar para ${to} via ${isBrevo ? 'Brevo' : 'Resend'}: ${detail}`);
    throw new Error('Falha ao enviar e-mail');
  }
}
