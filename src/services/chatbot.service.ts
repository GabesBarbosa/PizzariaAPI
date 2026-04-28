import * as customerRepo from '../repositories/customer.repository';
import { getChatbotEnabled, getCurrentBusinessInfo } from '../repositories/settings.repository';
import { getBusinessContext } from '../database/businessContext';
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

function cleanPhone(raw: string): string {
  // JID do Baileys: "5511910731832:7@s.whatsapp.net" → 11910731832
  const base = raw.split('@')[0].split(':')[0];
  const digits = base.replace(/\D/g, '');
  return digits.startsWith('55') ? digits.slice(2) : digits;
}

function firstName(full: string): string {
  return (full || '').trim().split(/\s+/)[0] || '';
}

/* ─── URL do cardápio público ─── */

function buildShopUrl(slug: string): string {
  const base = (process.env.PUBLIC_SHOP_URL || 'https://nice-hill-08195f90f.7.azurestaticapps.net').replace(/\/$/, '');
  return `${base}/c/${slug}`;
}

/* ─── Ponto de entrada (mantém assinatura antiga) ─── */

export async function handleMessage(rawPhone: string, _body: string): Promise<string> {
  const enabled = await getChatbotEnabled();
  if (!enabled) return '';

  const ctx = getBusinessContext();
  if (!ctx) return '';

  const phone = cleanPhone(rawPhone);
  if (!phone) return '';

  if (!shouldGreet(ctx.businessId, phone)) return '';

  try {
    const [business, customer] = await Promise.all([
      getCurrentBusinessInfo(),
      customerRepo.findCustomerByPhone(phone).catch(() => null),
    ]);

    if (!business) {
      logger.warn(`[Chatbot] Business não encontrado para ${ctx.businessId}`);
      return '';
    }

    const link = buildShopUrl(business.slug);

    if (customer) {
      return `Olá de volta, ${firstName(customer.name)}! 🍕\n\n` +
        `Faça seu pedido direto por aqui:\n${link}`;
    }

    return `Olá! Bem-vindo à *${business.name}* 🍕\n\n` +
      `Monte seu pedido pelo nosso cardápio online:\n${link}\n\n` +
      `No primeiro pedido você faz um cadastro rápido e já é atendido!`;
  } catch (err: any) {
    logger.error(`[Chatbot] Erro ao processar mensagem de ${phone}: ${err.message}`);
    return '';
  }
}
