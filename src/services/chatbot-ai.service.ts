/**
 * Chatbot com IA — atendente conversacional simples pro WhatsApp.
 *
 * Responde dúvidas sobre cardápio, formas de pagamento, entrega e endereço usando a
 * Claude API, com um system prompt montado a partir dos dados reais do negócio.
 * NÃO finaliza pedidos pelo chat — sempre direciona pro link do cardápio online.
 *
 * Ativado/desativado pelo toggle "Modo do Chatbot" (Mensagens > ai/triggers), que
 * grava em Settings via setSetting('chatbotMode', ...). Ver chatbot.service.ts,
 * que decide entre este fluxo e o fluxo simples (link direto) com base nesse modo.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as productRepo from '../repositories/product.repository';
import * as orderRepo from '../repositories/order.repository';
import * as customerRepo from '../repositories/customer.repository';
import {
  getCurrentBusinessInfo,
  getPaymentMethods,
  getBusinessOrigin,
  getDeliveryZones,
  getOpeningHours,
} from '../repositories/settings.repository';
import { getBusinessContext } from '../database/businessContext';
import { createShopToken } from './shop-token.service';
import { startHandoff } from './handoff.service';
import { estaAberto, horarioEmTexto, proximaAbertura } from '../utils/opening-hours';

const HANDOFF_TAG = '[ATENDENTE]';
const HANDOFF_REPLY = 'Certo! Vou chamar um atendente, ele vai te responder por aqui em instantes.';
import logger from '../utils/logger';

const STATUS_LABELS: Record<string, string> = {
  RECEIVED: 'recebido, aguardando confirmação da cozinha',
  PREPARING: 'em preparo na cozinha',
  OUT_FOR_DELIVERY: 'saiu para entrega',
  DELIVERED: 'entregue',
  CANCELLED: 'cancelado',
};

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 500; // respostas de WhatsApp são curtas — não precisa de mais que isso.

/* ─── Sessão de conversa por (businessId, phone), em memória ───────────────
   Mantém as últimas mensagens pra dar contexto às próximas respostas.
   Expira sozinha depois de um tempo sem atividade, pra não crescer sem limite. */

const MAX_HISTORY_MESSAGES = 12; // ~6 idas e vindas
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2h de inatividade zera o contexto

interface ChatTurn { role: 'user' | 'assistant'; content: string; }
interface Session { history: ChatTurn[]; lastActivity: number; }

const sessions = new Map<string, Session>();

function sessionKey(businessId: string, phone: string): string {
  return `${businessId}:${phone}`;
}

function getSession(key: string): Session {
  const now = Date.now();
  const existing = sessions.get(key);
  if (existing && now - existing.lastActivity < SESSION_TTL_MS) return existing;
  const fresh: Session = { history: [], lastActivity: now };
  sessions.set(key, fresh);
  return fresh;
}

/* ─── Cliente Anthropic (lazy, só cria se a chave estiver configurada) ─── */

let client: Anthropic | null | undefined;

function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  client = apiKey ? new Anthropic({ apiKey }) : null;
  if (!client) {
    logger.warn('[ChatbotAI] ANTHROPIC_API_KEY não configurada — modo IA indisponível.');
  }
  return client;
}

/* ─── URL do cardápio público ─── */

function buildShopUrl(slug: string, token?: string): string {
  const base = (process.env.PUBLIC_SHOP_URL || 'https://dashfood-rose.vercel.app').replace(/\/$/, '');
  const url = `${base}/c/${slug}`;
  return token ? `${url}?token=${token}` : url;
}

/* ─── System prompt: cardápio + configurações reais do negócio ─── */

async function buildSystemPrompt(shopUrl: string): Promise<string | null> {
  const [business, products, paymentMethods, origin, zones, hours] = await Promise.all([
    getCurrentBusinessInfo(),
    productRepo.getAllProducts(),
    getPaymentMethods(),
    getBusinessOrigin(),
    getDeliveryZones(),
    getOpeningHours(),
  ]);
  if (!business) return null;

  const menu = (products as any[])
    .filter(p => p.stockQuantity === null || p.stockQuantity === undefined || p.stockQuantity > 0)
    .map(p => `- ${p.name} (${p.category}) — R$ ${Number(p.price).toFixed(2)}${p.description ? ': ' + p.description : ''}`)
    .join('\n') || '(nenhum produto cadastrado no momento)';

  const payments = paymentMethods.map(p => p.label).join(', ') || 'não informado';
  const deliveryInfo = zones.length
    ? zones.map(z => `até ${z.maxKm}km: R$ ${z.fee.toFixed(2)}`).join(' | ')
    : 'consulte pelo cardápio';

  // O prompt é montado a cada mensagem, então "Situação agora" está sempre atualizada.
  let horarioInfo = '- Horário de funcionamento: não cadastrado';
  if (hours) {
    const aberto = estaAberto(hours);
    const proxima = aberto ? null : proximaAbertura(hours);
    horarioInfo =
      `- Horário de funcionamento: ${horarioEmTexto(hours)}\n` +
      `- Situação agora: ${aberto ? 'ABERTO' : 'FECHADO'}` +
      (proxima ? ` (abre ${proxima})` : '');
  }

  return [
    `Você é a atendente virtual da ${business.name}, respondendo clientes pelo WhatsApp.`,
    '',
    'CARDÁPIO ATUAL:',
    menu,
    '',
    'INFORMAÇÕES:',
    `- Formas de pagamento aceitas: ${payments}`,
    `- Taxas de entrega: ${deliveryInfo}`,
    horarioInfo,
    origin ? `- Estamos em ${origin.city}/${origin.uf}` : '',
    `- Link do cardápio online (é por lá que o cliente finaliza o pedido): ${shopUrl}`,
    '',
    'REGRAS:',
    '- Responda sempre em português do Brasil, em tom simpático, direto e curto (estilo mensagem de WhatsApp — sem markdown, sem títulos, no máximo 3-4 frases).',
    '- Use SOMENTE os itens e preços listados acima. Nunca invente produto, sabor, adicional ou preço que não esteja no cardápio.',
    '- Você não finaliza pedidos pelo chat. Quando o cliente quiser pedir, envie o link do cardápio acima.',
    '- Se o cliente perguntar sobre o status de um pedido e nenhum "DADOS REAIS DO PEDIDO" aparecer nesta conversa, peça o número do pedido — nunca invente um status.',
    '- Se perguntarem o horário, responda com base em "Horário de funcionamento" acima.',
    '- Se estiver FECHADO e o cliente quiser pedir, avise com simpatia e diga quando abre.',
    '- Se o horário estiver "não cadastrado", diga que vai confirmar com a equipe — nunca invente.',
    `- Se o cliente pedir para falar com uma pessoa, fizer uma reclamação ou pedir algo que você não consegue resolver com as informações acima, responda APENAS com: ${HANDOFF_TAG}`,
  ].filter(Boolean).join('\n');
}

/* ─── Perfil do cliente: identifica quem está falando pelo telefone ─────────
   Busca uma vez por mensagem e alimenta tanto a saudação/confirmação de
   endereço quanto a consulta de status de pedido abaixo — evita duas idas
   ao banco pra achar o mesmo cliente. */

function formatAddress(c: any): string | null {
  const parts = [c.street && c.number ? `${c.street}, ${c.number}` : c.street, c.complement]
    .filter(Boolean).join(' - ');
  const cityLine = [c.neighborhood, [c.city, c.uf].filter(Boolean).join('/')].filter(Boolean).join(', ');
  const full = [parts, cityLine].filter(Boolean).join(' — ');
  return full || null;
}

function buildCustomerProfileNote(customer: any | null): string {
  if (!customer) {
    return 'PERFIL DO CLIENTE: ainda não tem cadastro nesse telefone. Se ele quiser fazer um pedido, oriente a usar o link do cardápio acima — o cadastro é feito automaticamente no primeiro pedido por lá.';
  }
  const firstName = (customer.name || '').trim().split(/\s+/)[0] || '';
  const address = formatAddress(customer);
  return [
    `PERFIL DO CLIENTE: já é cadastrado, nome "${customer.name}".`,
    firstName ? `Cumprimente pelo primeiro nome (${firstName}) na primeira mensagem da conversa, sem repetir o nome inteiro toda hora depois.` : '',
    address
      ? `Endereço cadastrado: ${address}. Se ele for pedir entrega, confirme se é nesse endereço em vez de pedir pra digitar tudo de novo (só peça um endereço novo se ele disser que mudou ou quiser entregar em outro lugar).`
      : 'Não há endereço cadastrado — se ele quiser entrega, oriente a informar o endereço pelo link do cardápio.',
  ].filter(Boolean).join(' ');
}

/* ─── Consulta de status de pedido pelo número, direto na mensagem ───────
   Ex: "qual o status do pedido 123?", "pedido #123", "número do pedido 45".
   Só responde com dados de pedidos que pertencem ao telefone de quem pergunta —
   nunca vaza status de pedido de outro cliente. */

function extractOrderNumber(body: string): number | null {
  const match = body.match(/(?:#|pedido\s*n?[ºo°]?\.?\s*|n[uú]mero\s*(?:do\s*pedido)?\s*)(\d{1,6})/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isNaN(n) ? null : n;
}

async function buildOrderStatusNote(customer: any | null, body: string): Promise<string | null> {
  const orderId = extractOrderNumber(body);
  if (orderId === null) return null;

  if (!customer) {
    return `O cliente perguntou sobre o pedido #${orderId}, mas não existe nenhum cadastro com o telefone dele. Avise educadamente que não encontrou nenhum pedido nesse telefone.`;
  }

  const order = await orderRepo.findOrderById(orderId).catch(() => null);
  if (!order || order.customerId !== customer.id) {
    return `O cliente perguntou sobre o pedido #${orderId}, mas ele não foi encontrado (ou não pertence a esse telefone). Avise educadamente que não achou esse pedido e peça pra conferir o número.`;
  }

  const label = STATUS_LABELS[order.status] || order.status;
  const total = Number(order.total).toFixed(2);
  const createdAt = new Date(order.createdAt).toLocaleString('pt-BR');
  return `DADOS REAIS DO PEDIDO #${orderId} (use exatamente essas informações, não invente nada além disso): status atual = "${label}"; total = R$ ${total}; feito em ${createdAt}.`;
}

/**
 * Responde uma mensagem recebida no WhatsApp usando a Claude API.
 * `phone` já deve vir limpo (sem sufixo @s.whatsapp.net, sem DDI 55) — quem
 * chama é chatbot.service.ts. Retorna '' quando não há o que responder
 * (IA desligada, negócio não encontrado, etc.) pra não quebrar o fluxo do bot.
 */
export async function handleAiMessage(phone: string, body: string): Promise<string> {
  const anthropic = getClient();
  if (!anthropic) return '';

  const ctx = getBusinessContext();
  if (!ctx) return '';

  const business = await getCurrentBusinessInfo();
  if (!business) return '';

  const token = createShopToken(ctx.businessId, phone);
  const shopUrl = buildShopUrl(business.slug, token);

  const key = sessionKey(ctx.businessId, phone);
  const session = getSession(key);
  session.lastActivity = Date.now();
  session.history.push({ role: 'user', content: body });
  session.history = session.history.slice(-MAX_HISTORY_MESSAGES);

  try {
    let system = await buildSystemPrompt(shopUrl);
    if (!system) return '';

    const customer = await customerRepo.findCustomerByPhone(phone).catch(() => null);
    system += '\n\n' + buildCustomerProfileNote(customer);

    const orderNote = await buildOrderStatusNote(customer, body).catch(() => null);
    if (orderNote) system += '\n\n' + orderNote;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: session.history.map(h => ({ role: h.role, content: h.content })),
    });

    const reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    // A IA sinalizou que não consegue resolver: passa a conversa para um atendente.
    if (reply.startsWith(HANDOFF_TAG)) {
      startHandoff(ctx.businessId, phone, customer?.name);
      session.history.push({ role: 'assistant', content: HANDOFF_REPLY });
      session.history = session.history.slice(-MAX_HISTORY_MESSAGES);
      return HANDOFF_REPLY;
    }

    if (reply) {
      session.history.push({ role: 'assistant', content: reply });
      session.history = session.history.slice(-MAX_HISTORY_MESSAGES);
    }

    return reply;
  } catch (err: any) {
    if (err instanceof Anthropic.AuthenticationError) {
      logger.error('[ChatbotAI] Chave da Anthropic inválida — verifique ANTHROPIC_API_KEY.');
    } else if (err instanceof Anthropic.RateLimitError) {
      logger.warn(`[ChatbotAI] Rate limit da Anthropic atingido ao responder ${phone}.`);
    } else {
      logger.error(`[ChatbotAI] Erro ao consultar a IA para ${phone}: ${err.message}`);
    }
    return `Desculpa, tive um probleminha aqui 🙏 Você pode conferir nosso cardápio completo em: ${shopUrl}`;
  }
}
