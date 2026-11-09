/**
 * Encaminhamento para atendente humano (RF30 / RN10).
 *
 * Quando o cliente pede uma pessoa (ou a IA não consegue resolver), a conversa entra
 * em "modo humano": o bot fica em silêncio e o painel recebe um aviso. O dono responde
 * pelo WhatsApp do estabelecimento. O bot volta quando o dono clica em
 * "Encerrar atendimento" ou depois de 2 horas sem mensagens.
 *
 * Fica em memória, como o cooldown do chatbot e os tokens do cardápio. Se a API
 * reiniciar, as conversas voltam para o bot.
 */
import { broadcast } from './notification.service';
import logger from '../utils/logger';

const HANDOFF_TTL = 2 * 60 * 60 * 1000; // 2 horas sem mensagens

interface Handoff {
  phone: string;
  name?: string;
  startedAt: number;
  until: number;
}

const active = new Map<string, Handoff>();
const key = (businessId: string, phone: string) => `${businessId}:${phone}`;

function getActive(businessId: string, phone: string): Handoff | null {
  const k = key(businessId, phone);
  const h = active.get(k);
  if (!h) return null;
  if (Date.now() > h.until) {
    active.delete(k);
    return null;
  }
  return h;
}

export function startHandoff(businessId: string, phone: string, name?: string): void {
  const now = Date.now();
  const existing = getActive(businessId, phone);
  const handoff: Handoff = {
    phone,
    name: name ?? existing?.name,
    startedAt: existing?.startedAt ?? now,
    until: now + HANDOFF_TTL,
  };
  active.set(key(businessId, phone), handoff);
  logger.info(`[Handoff] ${phone} pediu atendimento humano (business ${businessId})`);
  broadcast('handoff', { phone, name: handoff.name ?? null, startedAt: handoff.startedAt }, businessId);
}

export function isInHandoff(businessId: string, phone: string): boolean {
  return getActive(businessId, phone) !== null;
}

/** Nova mensagem na conversa (do cliente ou do dono): estende o prazo de 2 horas. */
export function renewHandoff(businessId: string, phone: string): void {
  const h = getActive(businessId, phone);
  if (h) h.until = Date.now() + HANDOFF_TTL;
}

export function endHandoff(businessId: string, phone: string): boolean {
  const existed = active.delete(key(businessId, phone));
  if (existed) {
    logger.info(`[Handoff] Atendimento de ${phone} encerrado (business ${businessId})`);
    broadcast('handoff-ended', { phone }, businessId);
  }
  return existed;
}

/** Conversas aguardando atendimento humano, mais antigas primeiro. */
export function listHandoffs(businessId: string): Array<{ phone: string; name: string | null; startedAt: string; expiresAt: string }> {
  const prefix = `${businessId}:`;
  const result: Handoff[] = [];
  for (const [k] of active) {
    if (!k.startsWith(prefix)) continue;
    const h = getActive(businessId, k.slice(prefix.length));
    if (h) result.push(h);
  }
  return result
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(h => ({
      phone: h.phone,
      name: h.name ?? null,
      startedAt: new Date(h.startedAt).toISOString(),
      expiresAt: new Date(h.until).toISOString(),
    }));
}
