import Anthropic from '@anthropic-ai/sdk';
import * as customerRepo from '../repositories/customer.repository';
import * as productRepo from '../repositories/product.repository';
import { createOrder } from '../repositories/order.repository';
import { getDeliveryFee, getChatbotMode, getChatbotEnabled, getChatbotConfig, type ChatbotConfig } from '../repositories/settings.repository';
import { handleHamburguerMessage } from './chatbot-hamburger.service';
import { getBusinessContext } from '../database/businessContext';
import { CreateOrderItemDTO } from '../dtos/order.dto';
import { broadcast } from './notification.service';
import logger from '../utils/logger';

/* ─── Cliente Anthropic ─── */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/* ─── Constantes ─── */

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const PRODUCT_CACHE_TTL = 5 * 60 * 1000;
const MAX_HISTORY = 12;

/* ─── Tipos ─── */

interface CartItem {
  productId: string;
  productName: string;
  quantity: number;
  size: string;
  halfProductId?: string;
  halfProductName?: string;
  unitPrice: number;
}

interface Session {
  messages: Anthropic.MessageParam[];
  cart: CartItem[];
  customerId?: string;
  customerName?: string;
  savedAddress?: string;
  lastActivity: number;
  processing: boolean;
}

interface ProductCache {
  products: any[];
  cacheTime: number;
}

/* ─── Estado em memória (escopado por businessId) ─── */

// Chave: "businessId:phone"
const sessions = new Map<string, Session>();

// Chave: businessId
const productsCacheMap = new Map<string, ProductCache>();

/* ─── Helpers ─── */

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function extractPhone(chatId: string): string {
  // JID do Baileys: "5511910731832:7@s.whatsapp.net" — strip device ID e server
  const clean = chatId.split('@')[0].split(':')[0];
  const digits = clean.replace(/\D/g, '');
  return digits.startsWith('55') ? digits.slice(2) : digits;
}

function sessionKey(businessId: string, phone: string): string {
  return `${businessId}:${phone}`;
}

function getSession(businessId: string, phone: string): Session {
  const key = sessionKey(businessId, phone);
  let s = sessions.get(key);
  if (s && Date.now() - s.lastActivity > SESSION_TIMEOUT_MS) {
    sessions.delete(key);
    s = undefined;
  }
  if (!s) {
    s = { messages: [], cart: [], lastActivity: Date.now(), processing: false };
    sessions.set(key, s);
  }
  s.lastActivity = Date.now();
  return s as Session;
}

async function loadProducts(businessId: string): Promise<any[]> {
  const now = Date.now();
  const cached = productsCacheMap.get(businessId);
  if (!cached || now - cached.cacheTime > PRODUCT_CACHE_TTL) {
    const products = await productRepo.getAllProducts();
    productsCacheMap.set(businessId, { products, cacheTime: now });
    return products;
  }
  return cached.products;
}

function buildMenuText(products: any[]): string {
  const categories = [...new Set(products.map((p: any) => p.category))].sort() as string[];
  let menu = '=== CARDÁPIO ===\n\n';
  for (const cat of categories) {
    menu += `[${cat}]\n`;
    for (const p of products.filter((x: any) => x.category === cat)) {
      menu += `  ID:${p.id} | ${p.name} | ${brl(parseFloat(p.price))}`;
      if (p.description) menu += ` | ${p.description}`;
      menu += '\n';
    }
    menu += '\n';
  }
  return menu;
}

/* ─── Helpers de histórico ─── */

function compressOldToolCalls(messages: Anthropic.MessageParam[], keepLast = 4): Anthropic.MessageParam[] {
  if (messages.length <= keepLast) return messages;
  const recent = messages.slice(-keepLast);
  const old    = messages.slice(0, -keepLast);
  const compressed = old.filter(m => {
    if (Array.isArray(m.content)) {
      return !m.content.some((c: any) => c.type === 'tool_use' || c.type === 'tool_result');
    }
    return true;
  });
  return [...compressed, ...recent];
}

function needsMenu(msg: string): boolean {
  return /card[áa]pio|menu|\bopç[oõ]es\b|quero|pedido|pre[çc]o|sabor|tem\s+(a[íi]|disponível)/i.test(msg);
}

/* ─── Triggers ─── */

type TriggerFn = (products: any[], session: Session, deliveryFee: number, config: ChatbotConfig) => string;

interface Trigger {
  patterns: RegExp[];
  response: TriggerFn;
}

const TRIGGERS: Trigger[] = [
  {
    patterns: [
      /card[áa]pio/i,
      /\bmenu\b/i,
      /o que (voc[êe]s? )?(tem|têm|vend[ée]|tem\s+a[íi])/i,
      /quais (s[ãa]o )?(os? )?(produtos?|itens?|op[çc][oõ]es?)/i,
      /lista\s+(de\s+)?(produtos?|sabores?|itens?)/i,
      /me\s+(manda|passa|mostra|envia)\s+(o\s+)?card[áa]pio/i,
      /ver\s+(o\s+)?card[áa]pio/i,
      /quero\s+ver\s+(o\s+)?card[áa]pio/i,
    ],
    response: (products, _session, deliveryFee, config) => {
      const { sizeOptions, paymentMethods } = config;
      const sizeKeys = Object.keys(sizeOptions);
      const categories = [...new Set(products.map((p: any) => p.category))].sort() as string[];
      const feeText = deliveryFee > 0 ? brl(deliveryFee) : 'grátis';
      let msg = '📋 *CARDÁPIO*\n';
      msg += '─────────────────────\n\n';
      for (const cat of categories) {
        msg += `*${cat.toUpperCase()}*\n\n`;
        for (const p of products.filter((x: any) => x.category === cat)) {
          const price = parseFloat(p.price);
          msg += `• *${p.name}*\n`;
          if (p.description) msg += `   ${p.description}\n`;
          if (sizeKeys.length === 1) {
            const multiplier = sizeOptions[sizeKeys[0]].multiplier ?? 1;
            msg += `   ${brl(Math.round(price * multiplier * 100) / 100)}\n\n`;
          } else {
            const priceList = sizeKeys.map(key => {
              const opt = sizeOptions[key];
              return `${opt.label}: *${brl(Math.round(price * opt.multiplier * 100) / 100)}*`;
            }).join('  |  ');
            msg += `   ${priceList}\n\n`;
          }
        }
      }
      msg += '─────────────────────\n';
      msg += `🚚 Taxa de entrega: *${feeText}*\n`;
      msg += `💳 Pagamento: ${paymentMethods.map(pm => pm.label).join(', ')}\n\n`;
      msg += 'Para fazer seu pedido é só me dizer! 😊';
      return msg;
    },
  },
];

function checkTriggers(body: string, products: any[], session: Session, deliveryFee: number, config: ChatbotConfig): string | null {
  const text = body.trim();
  for (const trigger of TRIGGERS) {
    if (trigger.patterns.some(p => p.test(text))) {
      const reply = trigger.response(products, session, deliveryFee, config);
      session.messages.push({ role: 'user',      content: body });
      session.messages.push({ role: 'assistant', content: reply });
      if (session.messages.length > MAX_HISTORY) {
        session.messages = session.messages.slice(-MAX_HISTORY);
      }
      logger.info(`[Chatbot Trigger] "${text.slice(0, 40)}" → trigger disparado`);
      return reply;
    }
  }
  return null;
}

/* ─── Ferramentas (Tools) ─── */

function buildTools(config: ChatbotConfig): Anthropic.Tool[] {
  const sizeKeys = Object.keys(config.sizeOptions);
  const paymentLabels = config.paymentMethods.map(pm => pm.label);

  return [
    {
      name: 'find_or_create_customer',
      description: 'Busca o cliente pelo telefone cadastrado. Se não existir, cria o cadastro com nome e endereço — ambos obrigatórios para novos clientes.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name:       { type: 'string',  description: 'Nome completo do cliente — obrigatório para cadastro' },
          address:    { type: 'string',  description: 'Endereço completo do cliente — obrigatório para cadastro' },
          create_new: { type: 'boolean', description: 'true para criar o cadastro com nome e endereço fornecidos' },
        },
        required: [],
      },
    },
    {
      name: 'add_to_cart',
      description: 'Adiciona um item ao carrinho. Para itens meio a meio, informe também o segundo produto.',
      input_schema: {
        type: 'object' as const,
        properties: {
          product_id:        { type: 'string', description: 'ID do produto (conforme cardápio)' },
          product_name:      { type: 'string', description: 'Nome do produto' },
          quantity:          { type: 'number', description: 'Quantidade (1-50)' },
          size:              { type: 'string', enum: sizeKeys, description: 'Tamanho do produto' },
          unit_price:        { type: 'number', description: 'Preço unitário já calculado' },
          half_product_id:   { type: 'string', description: 'ID do segundo produto (item meio a meio)' },
          half_product_name: { type: 'string', description: 'Nome do segundo produto (item meio a meio)' },
        },
        required: ['product_id', 'product_name', 'quantity', 'size', 'unit_price'],
      },
    },
    {
      name: 'remove_from_cart',
      description: 'Remove um item do carrinho pelo índice (0-based).',
      input_schema: {
        type: 'object' as const,
        properties: {
          index: { type: 'number', description: 'Índice do item a remover (0-based)' },
        },
        required: ['index'],
      },
    },
    {
      name: 'view_cart',
      description: 'Retorna o conteúdo atual do carrinho com itens e total.',
      input_schema: { type: 'object' as const, properties: {}, required: [] },
    },
    {
      name: 'create_order',
      description: 'Cria o pedido final com os itens do carrinho. Só chamar após confirmação explícita do cliente.',
      input_schema: {
        type: 'object' as const,
        properties: {
          delivery_address: { type: 'string', description: 'Endereço completo de entrega ou "RETIRADA NO LOCAL"' },
          payment_method:   { type: 'string', enum: paymentLabels, description: 'Forma de pagamento' },
        },
        required: ['delivery_address', 'payment_method'],
      },
    },
  ];
}

/* ─── Execução das ferramentas ─── */

async function executeTool(
  phone: string,
  name: string,
  input: any,
  session: Session,
): Promise<string> {
  const cleanPhone = extractPhone(phone);

  try {
    switch (name) {

      case 'find_or_create_customer': {
        if (session.customerId) {
          return JSON.stringify({
            customerId: session.customerId,
            customerName: session.customerName,
            savedAddress: session.savedAddress,
            isNew: false,
          });
        }
        const found = await customerRepo.findCustomersByNameOrPhone(cleanPhone);
        if (found.length > 0) {
          session.customerId   = found[0].id;
          session.customerName = found[0].name;
          session.savedAddress = found[0].address || undefined;
          return JSON.stringify({
            customerId: found[0].id,
            customerName: found[0].name,
            savedAddress: found[0].address || null,
            isNew: false,
          });
        }
        if (input.create_new) {
          if (!input.name)    return JSON.stringify({ error: 'Nome é obrigatório para o cadastro.' });
          if (!input.address) return JSON.stringify({ error: 'Endereço é obrigatório para o cadastro.' });
          const customer = await customerRepo.createCustomer({ name: input.name, phone: cleanPhone, address: input.address });
          session.customerId   = customer.id;
          session.customerName = input.name;
          session.savedAddress = input.address;
          return JSON.stringify({ customerId: customer.id, customerName: input.name, savedAddress: input.address, isNew: true });
        }
        return JSON.stringify({ found: false, message: 'Cliente não encontrado. Colete nome e endereço para cadastro.' });
      }

      case 'add_to_cart': {
        const item: CartItem = {
          productId:       input.product_id,
          productName:     input.product_name,
          quantity:        Math.max(1, Math.min(50, Math.round(input.quantity))),
          size:            input.size,
          unitPrice:       input.unit_price,
          halfProductId:   input.half_product_id,
          halfProductName: input.half_product_name,
        };
        session.cart.push(item);
        const total = session.cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
        return JSON.stringify({ success: true, cartItems: session.cart.length, cartTotal: brl(total) });
      }

      case 'remove_from_cart': {
        const idx = input.index;
        if (idx < 0 || idx >= session.cart.length) {
          return JSON.stringify({ error: 'Índice inválido' });
        }
        session.cart.splice(idx, 1);
        const total = session.cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
        return JSON.stringify({ success: true, cartItems: session.cart.length, cartTotal: brl(total) });
      }

      case 'view_cart': {
        if (session.cart.length === 0) return JSON.stringify({ items: [], total: brl(0) });
        const items = session.cart.map((item, i) => ({
          index: i,
          name: item.halfProductName ? `${item.productName} / ${item.halfProductName}` : item.productName,
          size: item.size,
          quantity: item.quantity,
          unitPrice: brl(item.unitPrice),
          subtotal: brl(item.unitPrice * item.quantity),
        }));
        const total = session.cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
        return JSON.stringify({ items, total: brl(total) });
      }

      case 'create_order': {
        if (session.cart.length === 0) return JSON.stringify({ error: 'Carrinho vazio' });
        if (!session.customerId) {
          return JSON.stringify({ error: 'Cliente não identificado. Por favor, faça o cadastro primeiro.' });
        }

        const isPickup = input.delivery_address === 'RETIRADA NO LOCAL';
        const deliveryFee = isPickup ? 0 : await getDeliveryFee();

        const items: CreateOrderItemDTO[] = session.cart.map(item => ({
          productId:     item.productId,
          quantity:      item.quantity,
          size:          item.size,
          halfProductId: item.halfProductId,
        }));

        const order = await createOrder({
          customerId:      session.customerId,
          items,
          paymentMethod:   input.payment_method,
          deliveryAddress: !isPickup ? input.delivery_address : undefined,
          deliveryFee,
          notes:           'Pedido via WhatsApp (IA)',
          channel:         'whatsapp',
        });

        if (!isPickup && session.customerId) {
          await customerRepo.updateCustomer(session.customerId, { address: input.delivery_address }).catch((e: any) => {
            logger.warn(`[Chatbot] Falha ao atualizar endereço: ${e.message}`);
          });
        }

        broadcast('new-order', {
          id: order.id,
          customerName: session.customerName,
          total: order.total,
          itemCount: session.cart.reduce((s, i) => s + i.quantity, 0),
          channel: 'whatsapp',
        });

        session.cart = [];
        return JSON.stringify({ success: true, orderId: order.id, total: order.total });
      }

      default:
        return JSON.stringify({ error: `Ferramenta desconhecida: ${name}` });
    }
  } catch (err: any) {
    logger.error(`[Chatbot Tool] ${name} ERRO: ${err.message}`);
    return JSON.stringify({ error: err.message });
  }
}

/* ─── Ponto de entrada ─── */

export async function handleMessage(phone: string, body: string): Promise<string> {
  const { businessId } = getBusinessContext()!;

  const chatbotEnabled = await getChatbotEnabled();
  if (!chatbotEnabled) return '';

  const chatbotMode = await getChatbotMode();
  if (chatbotMode === 'triggers') {
    return handleHamburguerMessage(phone, body);
  }

  const session = getSession(businessId, phone);

  if (session.processing) {
    return '⏳ Ainda estou processando sua mensagem anterior. Aguarde um momento e tente novamente.';
  }

  session.processing = true;
  try {
    const [products, deliveryFee, chatbotConfig] = await Promise.all([
      loadProducts(businessId),
      getDeliveryFee(),
      getChatbotConfig(),
    ]);

    const triggerReply = checkTriggers(body, products, session, deliveryFee, chatbotConfig);
    if (triggerReply) return triggerReply;

    const feeText = deliveryFee > 0 ? brl(deliveryFee) : 'grátis';
    const { businessName, sizeOptions, paymentMethods } = chatbotConfig;

    // Monta texto de tamanhos dinamicamente
    const sizesText = Object.entries(sizeOptions)
      .map(([key, opt]) => `- "${key}" = ${Math.round(opt.multiplier * 100)}% do preço base (${opt.label})`)
      .join('\n');

    // Monta texto de pagamentos dinamicamente
    const paymentsText = paymentMethods.map(pm => pm.label).join(', ');

    const basePrompt = `Você é o atendente virtual da *${businessName}*. Atenda clientes pelo WhatsApp de forma natural, simpática e eficiente.

**Regras de negócio:**
**Tamanhos disponíveis:**
${sizesText}
- Itens meio a meio (quando disponível): preço baseado no produto mais caro entre os dois
- Formas de pagamento aceitas: ${paymentsText}
- Taxa de entrega: ${feeText} (retirada no local = isento)

**FLUXO OBRIGATÓRIO — siga sempre nesta ordem:**

1. **Identificação** — Chame find_or_create_customer imediatamente.
   - Cliente já cadastrado: cumprimente pelo nome e siga para o pedido.
   - Cliente novo: colete apenas:
     a) Nome completo
     b) Endereço de entrega (rua, número e bairro)
     Só então chame find_or_create_customer com create_new=true, name e address.
   ⚠️ NUNCA avance para o pedido sem nome e endereço. Não peça mais nada além disso.
   ℹ️ O telefone é capturado automaticamente — não peça ao cliente.

2. **Pedido** — Ajude o cliente a escolher os itens. Use add_to_cart para cada item.

3. **Confirmação** — Antes de finalizar, mostre um resumo completo:
   - Itens, quantidades e preços
   - Endereço de entrega (use o endereço cadastrado ou pergunte se mudou)
   - Forma de pagamento
   Aguarde o cliente confirmar.

4. **Finalização** — Só após confirmação explícita chame create_order.

**Comportamento:**
- Responda SEMPRE em português brasileiro
- Use emojis com moderação
- Se o cliente quiser cancelar, conclua amigavelmente
- O número de telefone já está no sistema, não pergunte`;

    const menuBlock = needsMenu(body) ? '\n\n' + buildMenuText(products) : '';

    const systemBlocks: Anthropic.TextBlockParam[] = [
      { type: 'text', text: basePrompt + menuBlock, cache_control: { type: 'ephemeral' } },
    ];

    session.messages.push({ role: 'user', content: body });
    session.messages = compressOldToolCalls(session.messages);
    if (session.messages.length > MAX_HISTORY) {
      session.messages = session.messages.slice(-MAX_HISTORY);
    }

    while (true) {
      const response = await anthropic.messages.create(
        {
          model: 'claude-haiku-4-5',
          max_tokens: 1024,
          system: systemBlocks,
          tools: buildTools(chatbotConfig),
          messages: session.messages,
        },
        {
          headers: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
        },
      );

      session.messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
        return textBlock?.text ?? '';
      }

      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const result = await executeTool(phone, block.name, block.input, session);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
          }
        }
        session.messages.push({ role: 'user', content: toolResults });
        continue;
      }

      break;
    }

    return '❌ Desculpe, algo deu errado. Tente novamente.';

  } catch (err: any) {
    logger.error(`[Chatbot IA] Erro (${phone}): ${err.message}`);
    return '❌ Ocorreu um erro. Por favor, tente novamente em instantes.';
  } finally {
    session.processing = false;
  }
}
