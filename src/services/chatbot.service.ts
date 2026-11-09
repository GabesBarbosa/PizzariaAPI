import * as customerRepo from '../repositories/customer.repository';
import { getChatbotEnabled, getChatbotMode, getCurrentBusinessInfo, getOpeningHours } from '../repositories/settings.repository';
import { getBusinessContext } from '../database/businessContext';
import { createShopToken } from './shop-token.service';
import { handleAiMessage } from './chatbot-ai.service';
import { isInHandoff, renewHandoff, startHandoff } from './handoff.service';
import { estaAberto, horarioEmTexto, proximaAbertura } from '../utils/opening-hours';
import logger from '../utils/logger';

/* ─── Cooldown por (businessId, phone) para evitar spam de boas-vindas ─── */

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutos
const lastGreeting = new Map<string, number>();

function cooldownKey(businessId: string, phone: string): string {
  return `${businessId}:${phone}`;
}

function shouldGreet(businessId: string, phone: string): boolean {
  const key = cooldownKey(businessId, phone);
  const last = lastGreeting.get(key);
  if (last && Date.now() - last < COOLDOWN_MS) return false;
  lastGreeting.set(key, Date.now());
  return true;
}

/* ─── Normalização ─── */

export function cleanPhone(raw: string): string {
  // JID do Baileys: "5511910731832:7@s.whatsapp.net" → 11910731832
  const base = raw.split('@')[0].split(':')[0];
  return customerRepo.normalizePhone(base);
}

function firstName(full: string): string {
  return (full || '').trim().split(/\s+/)[0] || '';
}

/* ─── Atendente humano (RF30 / RN10) ─── */

const HANDOFF_WORDS = /\b(atendente|humano|pessoa|falar com algu[eé]m|gerente)\b/i;
export const HANDOFF_REPLY = 'Certo! Vou chamar um atendente, ele vai te responder por aqui em instantes.';

/* ─── Horário de funcionamento (RF27) ─── */

const PERGUNTA_HORARIO = /hor[aá]rio|que horas|\babre\b|\bfecha\b|\baberto|\bfuncionamento\b/i;

async function horarioReply(): Promise<string> {
  const hours = await getOpeningHours();
  if (!hours) return 'Ainda não temos o horário cadastrado. Um atendente vai te confirmar em breve!';
  let situacao: string;
  if (estaAberto(hours)) {
    situacao = 'Estamos *abertos* agora!';
  } else {
    const proxima = proximaAbertura(hours);
    situacao = 'No momento estamos *fechados*.' + (proxima ? ` Abrimos ${proxima}.` : '');
  }
  return `${situacao}\n\nNosso horário:\n${horarioEmTexto(hours).split('; ').join('\n')}`;
}

/** Aviso extra na saudação quando a loja está fechada. */
async function avisoFechado(): Promise<string> {
  const hours = await getOpeningHours().catch(() => null);
  if (!hours || estaAberto(hours)) return '';
  const proxima = proximaAbertura(hours);
  return `\n\n⏰ Estamos fechados agora${proxima ? `, abrimos ${proxima}` : ''}.`;
}

/* ─── URL do cardápio público ─── */

function buildShopUrl(slug: string, token?: string): string {
  const base = (process.env.PUBLIC_SHOP_URL || 'https://dashfood-rose.vercel.app').replace(/\/$/, '');
  const url = `${base}/c/${slug}`;
  return token ? `${url}?token=${token}` : url;
}

/* ─── Ponto de entrada (mantém assinatura antiga) ─── */

export async function handleMessage(rawPhone: string, body: string): Promise<string> {
  const enabled = await getChatbotEnabled();
  if (!enabled) return '';

  const ctx = getBusinessContext();
  if (!ctx) return '';

  const phone = cleanPhone(rawPhone);
  if (!phone) return '';

  // Conversa com atendente humano: o bot fica em silêncio.
  if (isInHandoff(ctx.businessId, phone)) {
    renewHandoff(ctx.businessId, phone);
    return '';
  }

  if (HANDOFF_WORDS.test(body)) {
    const customer = await customerRepo.findCustomerByPhone(phone).catch(() => null);
    startHandoff(ctx.businessId, phone, customer?.name);
    return HANDOFF_REPLY;
  }

  // Modo IA: atendente conversacional (Claude) responde toda mensagem, sem o
  // cooldown de saudação abaixo — esse cooldown é só pra não repetir o "oi fixo".
  const mode = await getChatbotMode();
  if (mode === 'ai') {
    return handleAiMessage(phone, body);
  }

  // Pergunta de horário é respondida sempre, mesmo dentro do cooldown da saudação.
  if (PERGUNTA_HORARIO.test(body)) {
    return horarioReply().catch(() => '');
  }

  if (!shouldGreet(ctx.businessId, phone)) return '';

  try {
    logger.info(`[Chatbot] Buscando cliente — phone: "${phone}" businessId: "${ctx.businessId}"`);
    const [business, customer] = await Promise.all([
      getCurrentBusinessInfo(),
      customerRepo.findCustomerByPhone(phone).catch(() => null),
    ]);
    logger.info(`[Chatbot] Cliente encontrado: ${customer ? customer.name : 'nenhum'}`);

    if (!business) {
      logger.warn(`[Chatbot] Business não encontrado para ${ctx.businessId}`);
      return '';
    }

    if (customer) {
      const token = createShopToken(ctx.businessId, phone);
      const link = buildShopUrl(business.slug, token);
      return `Olá de volta, ${firstName(customer.name)}! 🍴\n\n` +
        `Faça seu pedido direto por aqui:\n${link}` + await avisoFechado();
    }

    const link = buildShopUrl(business.slug);
    return `Olá! Bem-vindo à *${business.name}* 🍴\n\n` +
      `Monte seu pedido pelo nosso cardápio online:\n${link}\n\n` +
      `No primeiro pedido você faz um cadastro rápido e já é atendido!` + await avisoFechado();
  } catch (err: any) {
    logger.error(`[Chatbot] Erro ao processar mensagem de ${phone}: ${err.message}`);
    return '';
  }
}
