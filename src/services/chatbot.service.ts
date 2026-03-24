import Anthropic from '@anthropic-ai/sdk';
import * as customerRepo from '../repositories/customer.repository';
import * as productRepo from '../repositories/product.repository';
import { createOrder } from '../repositories/order.repository';
import { CreateOrderItemDTO } from '../dtos/order.dto';
import { broadcast } from './notification.service';
import logger from '../utils/logger';

/* ─── Cliente Anthropic ─── */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/* ─── Constantes ─── */

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const BROTINHO_MULTIPLIER = 0.65;
const PRODUCT_CACHE_TTL = 5 * 60 * 1000;
const MAX_HISTORY = 20; // mensagens máximas no histórico (controle de custo)

/* ─── Tipos ─── */

interface CartItem {
  productId: string;
  productName: string;
  quantity: number;
  size: 'normal' | 'brotinho';
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
}

/* ─── Estado em memória ─── */

const sessions = new Map<string, Session>();
let productsCache: any[] | null = null;
let cacheTime = 0;

/* ─── Helpers ─── */

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function extractPhone(chatId: string): string {
  const digits = chatId.replace(/\D/g, '');
  return digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
}

function getSession(phone: string): Session {
  let s = sessions.get(phone);
  if (s && Date.now() - s.lastActivity > SESSION_TIMEOUT_MS) {
    sessions.delete(phone);
    s = undefined;
  }
  if (!s) {
    s = { messages: [], cart: [], lastActivity: Date.now() };
    sessions.set(phone, s);
  }
  s.lastActivity = Date.now();
  return s;
}

async function loadProducts(): Promise<any[]> {
  const now = Date.now();
  if (!productsCache || now - cacheTime > PRODUCT_CACHE_TTL) {
    productsCache = await productRepo.getAllProducts();
    cacheTime = now;
  }
  return productsCache!;
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

/* ─── Ferramentas (Tools) ─── */

const tools: Anthropic.Tool[] = [
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
    description: 'Adiciona um item ao carrinho. Para pizzas meio a meio, informe também o segundo sabor.',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id:        { type: 'string', description: 'ID do produto (conforme cardápio)' },
        product_name:      { type: 'string', description: 'Nome do produto' },
        quantity:          { type: 'number', description: 'Quantidade (1-50)' },
        size:              { type: 'string', enum: ['normal', 'brotinho'], description: 'Tamanho — brotinho = 65% do preço normal' },
        unit_price:        { type: 'number', description: 'Preço unitário já calculado (considere tamanho e meio a meio)' },
        half_product_id:   { type: 'string', description: 'ID do segundo sabor (pizza meio a meio)' },
        half_product_name: { type: 'string', description: 'Nome do segundo sabor (pizza meio a meio)' },
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
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_order',
    description: 'Cria o pedido final com os itens do carrinho. Só chamar após confirmação explícita do cliente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        delivery_address: { type: 'string', description: 'Endereço completo de entrega ou "RETIRADA NO LOCAL"' },
        payment_method:   { type: 'string', enum: ['Dinheiro', 'Cartão', 'PIX'], description: 'Forma de pagamento' },
      },
      required: ['delivery_address', 'payment_method'],
    },
  },
];

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
          session.customerId = found[0].id;
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
        if (!session.customerId) return JSON.stringify({ error: 'Cliente não identificado' });

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
          deliveryAddress: input.delivery_address !== 'RETIRADA NO LOCAL' ? input.delivery_address : undefined,
          notes:           'Pedido via WhatsApp (IA)',
        });

        if (input.delivery_address !== 'RETIRADA NO LOCAL' && session.customerId) {
          await customerRepo.updateCustomer(session.customerId, { address: input.delivery_address }).catch(() => {});
        }

        broadcast('new-order', {
          id: order.id,
          customerName: session.customerName,
          total: order.total,
          itemCount: session.cart.reduce((s, i) => s + i.quantity, 0),
        });

        session.cart = [];
        return JSON.stringify({ success: true, orderId: order.id, total: order.total });
      }

      default:
        return JSON.stringify({ error: `Ferramenta desconhecida: ${name}` });
    }
  } catch (err: any) {
    logger.error(`[Chatbot Tool] ${name} erro: ${err.message}`);
    return JSON.stringify({ error: err.message });
  }
}

/* ─── Ponto de entrada ─── */

export async function handleMessage(phone: string, body: string): Promise<string> {
  const session = getSession(phone);

  try {
    const products = await loadProducts();

    const systemPrompt = `Você é o atendente virtual da *Pizzatec* 🍕, uma pizzaria delivery. Atenda clientes pelo WhatsApp de forma natural, simpática e eficiente.

${buildMenuText(products)}

**Regras de negócio:**
- Pizzas tamanho "brotinho" = ${Math.round(BROTINHO_MULTIPLIER * 100)}% do preço normal (${Math.round((1 - BROTINHO_MULTIPLIER) * 100)}% de desconto)
- Pizza meio a meio: preço baseado no sabor mais caro entre os dois
- Formas de pagamento aceitas: Dinheiro, Cartão (na entrega), PIX

**FLUXO OBRIGATÓRIO — siga sempre nesta ordem:**

1. **Identificação** — Chame find_or_create_customer imediatamente.
   - Cliente já cadastrado: cumprimente pelo nome e siga para o pedido.
   - Cliente novo: informe que é necessário fazer um cadastro rápido e colete:
     a) Nome completo
     b) Endereço completo (rua, número, bairro)
     Só então chame find_or_create_customer com create_new=true, name e address.
   ⚠️ NUNCA avance para o pedido sem o cliente estar cadastrado com nome e endereço.

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

    // Adiciona mensagem do usuário ao histórico
    session.messages.push({ role: 'user', content: body });

    // Trunca histórico para controlar custo (mantém as últimas N mensagens)
    if (session.messages.length > MAX_HISTORY) {
      session.messages = session.messages.slice(-MAX_HISTORY);
    }

    // Loop agêntico
    while (true) {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages: session.messages,
      });

      // Salva resposta do assistente no histórico
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
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result,
            });
          }
        }

        session.messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // stop_reason inesperado
      break;
    }

    return '❌ Desculpe, algo deu errado. Tente novamente.';

  } catch (err: any) {
    logger.error(`[Chatbot IA] Erro (${phone}): ${err.message}`);
    return '❌ Ocorreu um erro. Por favor, tente novamente em instantes.';
  }
}
