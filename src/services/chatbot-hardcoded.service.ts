/**
 * Chatbot hardcoded (modo triggers) — máquina de estados sem IA.
 * Fluxo guiado por menus, sem gastar tokens da Anthropic.
 */

import * as customerRepo from '../repositories/customer.repository';
import * as productRepo from '../repositories/product.repository';
import { createOrder } from '../repositories/order.repository';
import { getDeliveryFee } from '../repositories/settings.repository';
import { CreateOrderItemDTO } from '../dtos/order.dto';
import { broadcast } from './notification.service';
import logger from '../utils/logger';

/* ─── Tipos ─── */

type State =
  | 'INIT'
  | 'AWAIT_NAME'
  | 'AWAIT_ADDRESS'
  | 'MENU'
  | 'AWAIT_DELIVERY_CHOICE'
  | 'AWAIT_CUSTOM_ADDRESS'
  | 'AWAIT_PAYMENT'
  | 'CONFIRMING';

interface CartItem {
  productId: string;
  productName: string;
  quantity: number;
  size: 'normal' | 'brotinho';
  unitPrice: number;
}

interface HSession {
  state: State;
  customerId?: string;
  customerName?: string;
  savedAddress?: string;
  deliveryAddress?: string;
  paymentMethod?: string;
  cart: CartItem[];
  tempName?: string;
  lastActivity: number;
}

/* ─── Constantes ─── */

const SESSION_TIMEOUT_MS  = 30 * 60 * 1000;
const BROTINHO_MULTIPLIER = 0.65;
const PRODUCT_CACHE_TTL   = 5 * 60 * 1000;

/* ─── Estado em memória ─── */

const sessions = new Map<string, HSession>();
let productsCache: any[] | null = null;
let cacheTime = 0;

/* ─── Helpers ─── */

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function extractPhone(chatId: string): string {
  const d = chatId.replace(/\D/g, '');
  return d.startsWith('55') ? d.slice(2) : d;
}

function getSession(phone: string): HSession {
  let s = sessions.get(phone);
  if (s && Date.now() - s.lastActivity > SESSION_TIMEOUT_MS) {
    sessions.delete(phone);
    s = undefined;
  }
  if (!s) {
    s = { state: 'INIT', cart: [], lastActivity: Date.now() };
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

/** Monta o cardápio numerado com instruções claras */
function buildMenuMsg(products: any[], deliveryFee: number): string {
  const categories = [...new Set(products.map((p: any) => p.category))].sort() as string[];
  let num = 1;
  let msg = '🍕 *CARDÁPIO PIZZATEC*\n';
  msg += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  for (const cat of categories) {
    msg += `*${cat.toUpperCase()}*\n`;
    for (const p of products.filter((x: any) => x.category === cat)) {
      const price    = parseFloat(p.price);
      const brotinho = Math.round(price * BROTINHO_MULTIPLIER * 100) / 100;
      msg += `*${num}.* ${p.name}`;
      if (p.description) msg += ` — _${p.description}_`;
      msg += `\n     Normal: ${brl(price)}`;
      msg += `  |  Brotinho (${num}b): ${brl(brotinho)}\n`;
      num++;
    }
    msg += '\n';
  }
  msg += '━━━━━━━━━━━━━━━━━━━━━\n';
  msg += `🚚 Taxa de entrega: *${deliveryFee > 0 ? brl(deliveryFee) : 'grátis'}*\n\n`;
  msg += '*Como pedir:*\n';
  msg += '• *1* → 1x item 1 (normal)\n';
  msg += '• *1 2* → 2x item 1 (normal)\n';
  msg += '• *1b* → 1x item 1 brotinho\n\n';
  msg += '📋 *carrinho* — ver itens adicionados\n';
  msg += '✅ *finalizar* — fechar pedido\n';
  msg += '❌ *cancelar* — recomeçar\n';
  return msg;
}

/** Monta índice: "1" → {product, size:'normal'}, "1b" → {product, size:'brotinho'} */
function buildProductIndex(products: any[]): Map<string, { product: any; size: 'normal' | 'brotinho' }> {
  const map = new Map<string, { product: any; size: 'normal' | 'brotinho' }>();
  products.forEach((p, idx) => {
    const n = String(idx + 1);
    map.set(n,       { product: p, size: 'normal'   });
    map.set(n + 'b', { product: p, size: 'brotinho'  });
  });
  return map;
}

/** Exibe o carrinho atual */
function buildCartMsg(cart: CartItem[], deliveryFee: number, isPickup: boolean): string {
  if (cart.length === 0) return '🛒 Seu carrinho está vazio.';
  let msg = '🛒 *SEU CARRINHO*\n━━━━━━━━━━━━━━\n\n';
  let subtotal = 0;
  cart.forEach((item, i) => {
    const total = item.unitPrice * item.quantity;
    subtotal += total;
    const sizeLabel = item.size === 'brotinho' ? ' (brotinho)' : '';
    msg += `${i + 1}. ${item.quantity}x ${item.productName}${sizeLabel} — ${brl(total)}\n`;
  });
  const fee = isPickup ? 0 : deliveryFee;
  msg += '\n';
  if (fee > 0) msg += `🚚 Entrega: ${brl(fee)}\n`;
  msg += `*TOTAL: ${brl(subtotal + fee)}*\n\n`;
  msg += '➕ Continue adicionando ou *finalizar* para confirmar.\n';
  msg += '🗑️ *remover* para tirar o último item.';
  return msg;
}

/* ─── Ponto de entrada ─── */

export async function handleHardcodedMessage(phone: string, body: string): Promise<string> {
  const session    = getSession(phone);
  const cleanPhone = extractPhone(phone);
  const text       = body.trim().toLowerCase();

  /* ── Comandos globais ── */
  if (/^(cancelar|sair|recomeçar|recomecar|cancel)$/.test(text)) {
    sessions.delete(phone);
    return '❌ Pedido cancelado. Quando quiser, é só mandar uma mensagem! 😊';
  }

  const [products, deliveryFee] = await Promise.all([loadProducts(), getDeliveryFee()]);

  switch (session.state) {

    /* ── INIT: identificar cliente ─────────────────────────── */
    case 'INIT': {
      const found = await customerRepo.findCustomersByNameOrPhone(cleanPhone);
      if (found.length > 0) {
        session.customerId   = found[0].id;
        session.customerName = found[0].name;
        session.savedAddress = found[0].address || undefined;
        session.state        = 'MENU';
        return `Olá, *${found[0].name}*! 👋 Que bom ter você aqui!\n\n` + buildMenuMsg(products, deliveryFee);
      }
      session.state = 'AWAIT_NAME';
      return 'Olá! 👋 Seja bem-vindo(a) à *Pizzatec* 🍕\n\nPara começar, *qual é o seu nome?*';
    }

    /* ── AWAIT_NAME ──────────────────────────────────────────── */
    case 'AWAIT_NAME': {
      if (body.trim().length < 2) return '⚠️ Por favor, informe seu nome.';
      session.tempName = body.trim();
      session.state    = 'AWAIT_ADDRESS';
      return `Prazer, *${session.tempName}*! 😊\n\n*Qual é o seu endereço de entrega?*\n_(Rua, número e bairro)_`;
    }

    /* ── AWAIT_ADDRESS ───────────────────────────────────────── */
    case 'AWAIT_ADDRESS': {
      if (body.trim().length < 5) return '⚠️ Por favor, informe o endereço completo (rua, número e bairro).';
      try {
        const customer = await customerRepo.createCustomer({
          name:    session.tempName!,
          phone:   cleanPhone,
          address: body.trim(),
        });
        session.customerId   = customer.id;
        session.customerName = session.tempName!;
        session.savedAddress = body.trim();
        session.state        = 'MENU';
        logger.info(`[Chatbot] Cliente CRIADO: id=${customer.id}, nome=${session.customerName}`);
        return `✅ *Cadastro realizado!* Agora veja nosso cardápio:\n\n` + buildMenuMsg(products, deliveryFee);
      } catch (err: any) {
        logger.error(`[Chatbot Hardcoded] Erro ao criar cliente: ${err.message}`);
        return '❌ Erro ao salvar cadastro. Tente novamente.';
      }
    }

    /* ── MENU: receber itens ─────────────────────────────────── */
    case 'MENU': {
      // Cardápio
      if (/^(card[áa]pio|menu|ver card[áa]pio|\?)$/.test(text)) {
        return buildMenuMsg(products, deliveryFee);
      }
      // Carrinho
      if (/^(carrinho|ver carrinho|meu carrinho)$/.test(text)) {
        return buildCartMsg(session.cart, deliveryFee, false);
      }
      // Remover último item
      if (/^remover$/.test(text)) {
        if (session.cart.length === 0) return '🛒 Seu carrinho já está vazio.';
        const removed = session.cart.pop()!;
        return `🗑️ *${removed.productName}* removido.\n\n` + buildCartMsg(session.cart, deliveryFee, false);
      }
      // Finalizar
      if (/^(finalizar|confirmar|fechar|pronto)$/.test(text)) {
        if (session.cart.length === 0) return '🛒 Seu carrinho está vazio. Adicione itens antes de finalizar.';
        session.state = 'AWAIT_DELIVERY_CHOICE';
        let msg = buildCartMsg(session.cart, deliveryFee, false);
        msg += '\n\n📍 *Endereço de entrega:*\n';
        if (session.savedAddress) {
          msg += `*1.* Entregar em: _${session.savedAddress}_\n`;
        }
        msg += `*${session.savedAddress ? '2' : '1'}.* Retirar no local (sem taxa de entrega)\n`;
        msg += `*${session.savedAddress ? '3' : '2'}.* Outro endereço`;
        return msg;
      }

      // Parsear "N" ou "Nb" ou "N Q" ou "Nb Q"
      const match = text.match(/^(\d+b?)\s*(\d+)?$/);
      if (match) {
        const key = match[1];
        const qty = parseInt(match[2] || '1', 10);
        if (isNaN(qty) || qty < 1 || qty > 20) return '⚠️ Quantidade inválida (máx. 20).';

        const index = buildProductIndex(products);
        const entry = index.get(key);
        if (!entry) return `⚠️ Item *${key}* não encontrado. Digite *cardápio* para ver as opções.`;

        const price     = parseFloat(entry.product.price);
        const unitPrice = entry.size === 'brotinho'
          ? Math.round(price * BROTINHO_MULTIPLIER * 100) / 100
          : price;

        // Agrupa se já existe o mesmo item no carrinho
        const existing = session.cart.find(
          c => c.productId === entry.product.id && c.size === entry.size
        );
        if (existing) {
          existing.quantity += qty;
        } else {
          session.cart.push({
            productId:   entry.product.id,
            productName: entry.product.name,
            quantity:    qty,
            size:        entry.size,
            unitPrice,
          });
        }

        const sizeLabel   = entry.size === 'brotinho' ? ' (brotinho)' : '';
        const cartSubtotal = session.cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
        return `✅ *${qty}x ${entry.product.name}${sizeLabel}* adicionado!\n` +
          `Subtotal do carrinho: *${brl(cartSubtotal)}*\n\n` +
          'Continue adicionando, *carrinho* para ver tudo ou *finalizar* para confirmar.';
      }

      // Qualquer outra mensagem → reapresenta cardápio
      return buildMenuMsg(products, deliveryFee);
    }

    /* ── AWAIT_DELIVERY_CHOICE ───────────────────────────────── */
    case 'AWAIT_DELIVERY_CHOICE': {
      const hasSaved    = !!session.savedAddress;
      const optPickup   = hasSaved ? '2' : '1';
      const optOther    = hasSaved ? '3' : '2';

      if (text === '1' && hasSaved) {
        session.deliveryAddress = session.savedAddress;
      } else if (text === optPickup) {
        session.deliveryAddress = 'RETIRADA NO LOCAL';
      } else if (text === optOther) {
        session.state = 'AWAIT_CUSTOM_ADDRESS';
        return '📍 Digite seu endereço de entrega (rua, número e bairro):';
      } else {
        const opts = hasSaved
          ? '*1* (cadastrado) · *2* (retirar) · *3* (outro)'
          : '*1* (retirar) · *2* (outro endereço)';
        return `⚠️ Opção inválida. Escolha: ${opts}`;
      }

      return goToPayment(session, deliveryFee);
    }

    /* ── AWAIT_CUSTOM_ADDRESS ────────────────────────────────── */
    case 'AWAIT_CUSTOM_ADDRESS': {
      if (body.trim().length < 5) return '⚠️ Por favor, informe o endereço completo (rua, número e bairro).';
      session.deliveryAddress = body.trim();
      return goToPayment(session, deliveryFee);
    }

    /* ── AWAIT_PAYMENT ───────────────────────────────────────── */
    case 'AWAIT_PAYMENT': {
      const paymentMap: Record<string, string> = { '1': 'CASH', '2': 'CARD', '3': 'PIX' };
      const payment = paymentMap[text];
      if (!payment) return '⚠️ Escolha: *1* (Dinheiro) · *2* (Cartão na entrega) · *3* (PIX)';
      session.paymentMethod = payment;
      session.state         = 'CONFIRMING';

      const paymentLabels: Record<string, string> = { CASH: 'Dinheiro', CARD: 'Cartão na entrega', PIX: 'PIX' };
      const isPickup  = session.deliveryAddress === 'RETIRADA NO LOCAL';
      const fee       = isPickup ? 0 : deliveryFee;
      const subtotal  = session.cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

      let msg = '📋 *RESUMO DO PEDIDO*\n━━━━━━━━━━━━━━━━━━\n\n';
      session.cart.forEach(item => {
        const sl = item.size === 'brotinho' ? ' (brotinho)' : '';
        msg += `${item.quantity}x ${item.productName}${sl} — ${brl(item.unitPrice * item.quantity)}\n`;
      });
      msg += '\n';
      if (fee > 0) msg += `🚚 Entrega: ${brl(fee)}\n`;
      msg += `💰 *TOTAL: ${brl(subtotal + fee)}*\n`;
      msg += `📍 ${isPickup ? 'Retirada no local' : session.deliveryAddress}\n`;
      msg += `💳 ${paymentLabels[payment]}\n\n`;
      msg += 'Confirmar? *sim* para confirmar · *não* para cancelar';
      return msg;
    }

    /* ── CONFIRMING ──────────────────────────────────────────── */
    case 'CONFIRMING': {
      if (/^(sim|s|yes|confirmar|confirmo)$/.test(text)) {
        try {
          const isPickup = session.deliveryAddress === 'RETIRADA NO LOCAL';
          const fee      = isPickup ? 0 : deliveryFee;
          const items: CreateOrderItemDTO[] = session.cart.map(i => ({
            productId: i.productId,
            quantity:  i.quantity,
            size:      i.size,
          }));
          const order = await createOrder({
            customerId:      session.customerId!,
            items,
            paymentMethod:   session.paymentMethod,
            deliveryAddress: !isPickup ? session.deliveryAddress : undefined,
            deliveryFee:     fee,
            notes:           'Pedido via WhatsApp',
            channel:         'whatsapp',
          });
          logger.info(`[Chatbot Hardcoded] Pedido CRIADO: id=${order.id}, total=${order.total}`);
          broadcast('new-order', {
            id:           order.id,
            customerName: session.customerName,
            total:        order.total,
            itemCount:    session.cart.reduce((s, i) => s + i.quantity, 0),
            channel:      'whatsapp',
          });
          sessions.delete(phone);
          return `✅ *Pedido #${order.id} confirmado!*\n\n🍕 Já estamos preparando sua pizza!\nObrigado, *${session.customerName}*! 😊❤️`;
        } catch (err: any) {
          logger.error(`[Chatbot Hardcoded] Erro ao criar pedido: ${err.message}`);
          return '❌ Erro ao registrar o pedido. Tente novamente ou ligue para nós.';
        }
      }
      if (/^(n[ãa]o|nao|no|cancelar)$/.test(text)) {
        sessions.delete(phone);
        return '❌ Pedido cancelado. Quando quiser fazer um novo, é só chamar! 😊';
      }
      return 'Digite *sim* para confirmar ou *não* para cancelar.';
    }

    default:
      sessions.delete(phone);
      return 'Olá! Para começar, é só mandar uma mensagem 😊';
  }
}

/* ─── Helper interno ─── */

function goToPayment(session: HSession, deliveryFee: number): string {
  session.state = 'AWAIT_PAYMENT';
  const isPickup = session.deliveryAddress === 'RETIRADA NO LOCAL';
  const fee      = isPickup ? 0 : deliveryFee;
  const subtotal = session.cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  return buildCartMsg(session.cart, deliveryFee, isPickup) +
    `\n\n*Total: ${brl(subtotal + fee)}*\n\n` +
    '💳 *Forma de pagamento:*\n*1.* Dinheiro\n*2.* Cartão na entrega\n*3.* PIX';
}
