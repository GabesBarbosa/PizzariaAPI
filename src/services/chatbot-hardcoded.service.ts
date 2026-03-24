/**
 * Chatbot hardcoded (modo triggers) — máquina de estados sem IA.
 * Fluxo guiado por menus numerados, sem gastar tokens da Anthropic.
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
  | 'AWAIT_DELIVERY'
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

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const BROTINHO_MULTIPLIER = 0.65;
const PRODUCT_CACHE_TTL  = 5 * 60 * 1000;

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

function buildMenuMsg(products: any[], deliveryFee: number): string {
  const categories = [...new Set(products.map((p: any) => p.category))].sort() as string[];
  let i = 1;
  const indexed: Array<{ num: number; product: any; size: 'normal' | 'brotinho' }> = [];
  let msg = '🍕 *CARDÁPIO PIZZATEC*\n';
  msg += '─────────────────────\n\n';
  for (const cat of categories) {
    msg += `*${cat}*\n`;
    for (const p of products.filter((x: any) => x.category === cat)) {
      const price = parseFloat(p.price);
      const brot  = Math.round(price * BROTINHO_MULTIPLIER * 100) / 100;
      msg += `*${i}.* ${p.name} — ${brl(price)}\n`;
      if (p.description) msg += `   _${p.description}_\n`;
      msg += `   🔸 Brotinho: *${i}b* — ${brl(brot)}\n`;
      indexed.push({ num: i,   product: p, size: 'normal'   });
      indexed.push({ num: i,   product: p, size: 'brotinho'  });
      i++;
    }
    msg += '\n';
  }
  msg += '─────────────────────\n';
  msg += `🚚 Entrega: *${deliveryFee > 0 ? brl(deliveryFee) : 'grátis'}*\n\n`;
  msg += 'Digite o *número* + quantidade para adicionar ao pedido.\n';
  msg += 'Ex: *2 1* = 1x item 2 (normal)  |  *2b 1* = 1x item 2 (brotinho)\n\n';
  msg += 'Quando terminar: *finalizar*  |  Ver carrinho: *carrinho*\n';
  msg += 'Recomeçar: *cancelar*';
  return msg;
}

function buildProductIndex(products: any[]): Map<string, { product: any; size: 'normal' | 'brotinho' }> {
  const map = new Map<string, { product: any; size: 'normal' | 'brotinho' }>();
  products.forEach((p, idx) => {
    const n = String(idx + 1);
    map.set(n,        { product: p, size: 'normal'   });
    map.set(n + 'b',  { product: p, size: 'brotinho'  });
  });
  return map;
}

function buildCartMsg(cart: CartItem[], deliveryFee: number, isPickup: boolean): string {
  if (cart.length === 0) return '🛒 Seu carrinho está vazio.';
  let msg = '🛒 *SEU CARRINHO:*\n\n';
  let subtotal = 0;
  cart.forEach((item, i) => {
    const total = item.unitPrice * item.quantity;
    subtotal += total;
    const sizeLabel = item.size === 'brotinho' ? ' (brotinho)' : '';
    msg += `${i + 1}. ${item.quantity}x ${item.productName}${sizeLabel} — ${brl(total)}\n`;
  });
  const fee = isPickup ? 0 : deliveryFee;
  msg += '\n';
  if (fee > 0) msg += `🚚 Taxa de entrega: ${brl(fee)}\n`;
  msg += `*TOTAL: ${brl(subtotal + fee)}*\n\n`;
  msg += 'Continuar adicionando ou digitar *finalizar* para confirmar.';
  return msg;
}

/* ─── Ponto de entrada ─── */

export async function handleHardcodedMessage(phone: string, body: string): Promise<string> {
  const session = getSession(phone);
  const cleanPhone = extractPhone(phone);
  const text = body.trim().toLowerCase();

  // Comando global: cancelar/recomeçar
  if (/^(cancelar|sair|recomeçar|recomecar|cancel)$/.test(text)) {
    sessions.delete(phone);
    return '❌ Pedido cancelado. Para começar um novo pedido, é só mandar uma mensagem! 😊';
  }

  const [products, deliveryFee] = await Promise.all([loadProducts(), getDeliveryFee()]);

  switch (session.state) {

    /* ── INIT: identificar cliente ─────────────────────────────────────── */
    case 'INIT': {
      const found = await customerRepo.findCustomersByNameOrPhone(cleanPhone);
      if (found.length > 0) {
        session.customerId   = found[0].id;
        session.customerName = found[0].name;
        session.savedAddress = found[0].address || undefined;
        session.state = 'MENU';
        return `Olá, *${found[0].name}*! 👋\n\nBem-vindo(a) de volta à Pizzatec! 🍕\n\n` + buildMenuMsg(products, deliveryFee);
      }
      // Cliente novo
      session.state = 'AWAIT_NAME';
      return 'Olá! 👋 Seja bem-vindo(a) à *Pizzatec* 🍕\n\nPara fazer seu pedido, precisamos de um cadastro rápido.\n\n*Qual é o seu nome completo?*';
    }

    /* ── AWAIT_NAME ─────────────────────────────────────────────────────── */
    case 'AWAIT_NAME': {
      if (body.trim().length < 3) return '⚠️ Por favor, informe seu nome completo.';
      session.tempName = body.trim();
      session.state = 'AWAIT_ADDRESS';
      return `Prazer, *${session.tempName}*! 😊\n\n*Qual é o seu endereço de entrega?*\n_(Rua, número e bairro)_`;
    }

    /* ── AWAIT_ADDRESS ──────────────────────────────────────────────────── */
    case 'AWAIT_ADDRESS': {
      if (body.trim().length < 5) return '⚠️ Por favor, informe o endereço completo (rua, número e bairro).';
      try {
        const customer = await customerRepo.createCustomer({
          name: session.tempName!,
          phone: cleanPhone,
          address: body.trim(),
        });
        session.customerId   = customer.id;
        session.customerName = session.tempName!;
        session.savedAddress = body.trim();
        session.state = 'MENU';
        logger.info(`[Chatbot] Cliente CRIADO (hardcoded): id=${customer.id}, nome=${session.customerName}`);
        return `✅ Cadastro realizado com sucesso!\n\nAgora veja nosso cardápio:\n\n` + buildMenuMsg(products, deliveryFee);
      } catch (err: any) {
        logger.error(`[Chatbot Hardcoded] Erro ao criar cliente: ${err.message}`);
        return '❌ Erro ao salvar cadastro. Tente novamente ou fale com o atendente.';
      }
    }

    /* ── MENU: receber itens ────────────────────────────────────────────── */
    case 'MENU': {
      // Ver cardápio
      if (/^(card[áa]pio|menu|ver card[áa]pio)$/.test(text)) {
        return buildMenuMsg(products, deliveryFee);
      }
      // Ver carrinho
      if (/^(carrinho|ver carrinho|meu carrinho)$/.test(text)) {
        return buildCartMsg(session.cart, deliveryFee, false);
      }
      // Finalizar
      if (/^(finalizar|confirmar|fechar|pronto)$/.test(text)) {
        if (session.cart.length === 0) return '🛒 Seu carrinho está vazio. Adicione itens antes de finalizar.';
        session.state = 'AWAIT_DELIVERY';
        return buildCartMsg(session.cart, deliveryFee, false) +
          '\n\n*Endereço de entrega:*\n' +
          (session.savedAddress ? `1. Usar endereço cadastrado: _${session.savedAddress}_\n` : '') +
          '2. Retirar no local (sem taxa)\n3. Outro endereço\n\nDigite *1*, *2* ou *3*:';
      }

      // Tentar parsear "Nx" ou "Nxb quantidade"
      // Formato aceito: "3 2" (2x item 3 normal) ou "3b 1" (1x item 3 brotinho)
      const orderMatch = text.match(/^(\d+b?)\s*(\d+)?$/);
      if (orderMatch) {
        const key = orderMatch[1];
        const qty = parseInt(orderMatch[2] || '1', 10);
        if (isNaN(qty) || qty < 1 || qty > 20) return '⚠️ Quantidade inválida. Digite entre 1 e 20.';

        const index = buildProductIndex(products);
        const entry = index.get(key);
        if (!entry) return `⚠️ Item *${key}* não encontrado. Verifique o cardápio digitando *cardápio*.`;

        const price = parseFloat(entry.product.price);
        const unitPrice = entry.size === 'brotinho'
          ? Math.round(price * BROTINHO_MULTIPLIER * 100) / 100
          : price;

        session.cart.push({
          productId:   entry.product.id,
          productName: entry.product.name,
          quantity:    qty,
          size:        entry.size,
          unitPrice,
        });

        const sizeLabel = entry.size === 'brotinho' ? ' (brotinho)' : '';
        return `✅ *${qty}x ${entry.product.name}${sizeLabel}* adicionado ao carrinho!\n\n` +
          `Subtotal: ${brl(session.cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0))}\n\n` +
          'Continuar adicionando, digitar *carrinho* para ver tudo ou *finalizar* para confirmar.';
      }

      // Saudação ou mensagem genérica → reapresenta cardápio
      return buildMenuMsg(products, deliveryFee);
    }

    /* ── AWAIT_DELIVERY ─────────────────────────────────────────────────── */
    case 'AWAIT_DELIVERY': {
      if (text === '1' && session.savedAddress) {
        session.deliveryAddress = session.savedAddress;
      } else if (text === '2') {
        session.deliveryAddress = 'RETIRADA NO LOCAL';
      } else if (text === '3') {
        session.state = 'MENU'; // reutilizaremos um sub-state via tempName
        // Pedimos o endereço diretamente
        session.state = 'AWAIT_DELIVERY'; // mantém
        return '📍 Digite seu endereço de entrega completo (rua, número e bairro):';
      } else if (text.length > 5 && session.state === 'AWAIT_DELIVERY' && !['1','2','3'].includes(text)) {
        // Digitou endereço diretamente
        session.deliveryAddress = body.trim();
      } else {
        return '⚠️ Digite *1* para endereço cadastrado, *2* para retirada, ou *3* para outro endereço.';
      }

      session.state = 'AWAIT_PAYMENT';
      const isPickup = session.deliveryAddress === 'RETIRADA NO LOCAL';
      return buildCartMsg(session.cart, deliveryFee, isPickup) +
        '\n\n💳 *Forma de pagamento:*\n1. Dinheiro\n2. Cartão (na entrega)\n3. PIX\n\nDigite *1*, *2* ou *3*:';
    }

    /* ── AWAIT_PAYMENT ──────────────────────────────────────────────────── */
    case 'AWAIT_PAYMENT': {
      const paymentMap: Record<string, string> = { '1': 'Dinheiro', '2': 'Cartão', '3': 'PIX' };
      const payment = paymentMap[text];
      if (!payment) return '⚠️ Digite *1* (Dinheiro), *2* (Cartão) ou *3* (PIX).';
      session.paymentMethod = payment;
      session.state = 'CONFIRMING';

      const isPickup = session.deliveryAddress === 'RETIRADA NO LOCAL';
      const fee = isPickup ? 0 : deliveryFee;
      const subtotal = session.cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

      let msg = '📋 *CONFIRMAÇÃO DO PEDIDO*\n';
      msg += '─────────────────────\n\n';
      session.cart.forEach(item => {
        const sl = item.size === 'brotinho' ? ' (brotinho)' : '';
        msg += `${item.quantity}x ${item.productName}${sl} — ${brl(item.unitPrice * item.quantity)}\n`;
      });
      msg += '\n';
      if (fee > 0) msg += `🚚 Entrega: ${brl(fee)}\n`;
      msg += `💰 *TOTAL: ${brl(subtotal + fee)}*\n`;
      msg += `📍 ${isPickup ? 'Retirada no local' : session.deliveryAddress}\n`;
      msg += `💳 ${payment}\n\n`;
      msg += 'Confirmar pedido? Digite *sim* para confirmar ou *não* para cancelar.';
      return msg;
    }

    /* ── CONFIRMING ─────────────────────────────────────────────────────── */
    case 'CONFIRMING': {
      if (/^(sim|s|yes|confirmar|confirmo)$/.test(text)) {
        try {
          const isPickup = session.deliveryAddress === 'RETIRADA NO LOCAL';
          const fee = isPickup ? 0 : deliveryFee;
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
            notes:           'Pedido via WhatsApp (hardcoded)',
            channel:         'whatsapp',
          });
          logger.info(`[Chatbot Hardcoded] Pedido CRIADO: id=${order.id}, total=${order.total}`);
          broadcast('new-order', {
            id: order.id,
            customerName: session.customerName,
            total: order.total,
            itemCount: session.cart.reduce((s, i) => s + i.quantity, 0),
          });
          sessions.delete(phone); // limpa sessão
          return `✅ *Pedido #${order.id} confirmado!*\n\n🍕 Em breve sua pizza estará pronta!\n\nObrigado pela preferência, *${session.customerName}*! 😊❤️`;
        } catch (err: any) {
          logger.error(`[Chatbot Hardcoded] Erro ao criar pedido: ${err.message}`);
          return '❌ Erro ao registrar o pedido. Por favor, tente novamente ou ligue para nós.';
        }
      }
      if (/^(n[ãa]o|nao|no|cancelar)$/.test(text)) {
        sessions.delete(phone);
        return '❌ Pedido cancelado. Se quiser fazer um novo pedido, é só mandar uma mensagem! 😊';
      }
      return 'Digite *sim* para confirmar o pedido ou *não* para cancelar.';
    }

    default:
      sessions.delete(phone);
      return 'Olá! Para começar, mande uma mensagem 😊';
  }
}
