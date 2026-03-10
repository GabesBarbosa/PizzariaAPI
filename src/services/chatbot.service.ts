import * as customerRepo from '../repositories/customer.repository';
import * as productRepo from '../repositories/product.repository';
import { createOrder } from '../repositories/order.repository';
import { CreateOrderDTO, CreateOrderItemDTO } from '../dtos/order.dto';
import { broadcast } from './notification.service';
import logger from '../utils/logger';

/* ─── State Machine ─── */

enum State {
  IDLE,
  ASK_NAME,
  MAIN_MENU,
  SELECT_CATEGORY,
  SELECT_PRODUCT,
  SELECT_SIZE,
  ASK_HALF,
  SELECT_HALF_PRODUCT,
  SELECT_QUANTITY,
  MORE_ITEMS,
  ASK_ADDRESS,
  ASK_PAYMENT,
  CONFIRM_ORDER,
}

/* ─── Types ─── */

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
  state: State;
  customerId?: string;
  customerName?: string;
  cart: CartItem[];
  // temp: item being built
  pendingProductId?: string;
  pendingProductName?: string;
  pendingProductPrice?: number;
  pendingCategory?: string;
  pendingSize?: 'normal' | 'brotinho';
  pendingHalfId?: string;
  pendingHalfName?: string;
  pendingHalfPrice?: number;
  // cached reference data
  categories?: string[];
  categoryProducts?: any[];
  deliveryAddress?: string;
  paymentMethod?: string;
  lastActivity: number;
}

/* ─── Constants ─── */

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const BROTINHO_MULTIPLIER = 0.65;
const PRODUCT_CACHE_TTL = 5 * 60 * 1000;

/* ─── In-memory state ─── */

const sessions = new Map<string, Session>();
let productsCache: any[] | null = null;
let cacheTime = 0;

/* ─── Helpers ─── */

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function onlyDigits(s: string): string {
  return s.replace(/\D/g, '');
}

/** Extract clean BR phone (e.g. 11999998888) from WhatsApp chatId 5511999998888@c.us */
function extractPhone(chatId: string): string {
  const digits = onlyDigits(chatId);
  return digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
}

function isPizza(category: string): boolean {
  return category.toLowerCase().includes('pizza');
}

async function loadProducts(): Promise<any[]> {
  const now = Date.now();
  if (!productsCache || now - cacheTime > PRODUCT_CACHE_TTL) {
    productsCache = await productRepo.getAllProducts();
    cacheTime = now;
  }
  return productsCache!;
}

function getSession(phone: string): Session {
  let s = sessions.get(phone);
  if (s && Date.now() - s.lastActivity > SESSION_TIMEOUT_MS) {
    sessions.delete(phone);
    s = undefined;
  }
  if (!s) {
    s = { state: State.IDLE, cart: [], lastActivity: Date.now() };
    sessions.set(phone, s);
  }
  s.lastActivity = Date.now();
  return s;
}

function resetSession(phone: string): void {
  sessions.delete(phone);
}

function calcUnitPrice(
  base: number,
  halfPrice: number | undefined,
  size: 'normal' | 'brotinho',
): number {
  let price = halfPrice != null ? Math.max(base, halfPrice) : base;
  if (size === 'brotinho') price = Math.round(price * BROTINHO_MULTIPLIER * 100) / 100;
  return price;
}

/* ─── Entry point (called from whatsapp.service) ─── */

export async function handleMessage(phone: string, body: string): Promise<string> {
  const msg = body.trim();
  const session = getSession(phone);

  if (msg.toLowerCase() === 'cancelar' && session.state !== State.IDLE) {
    resetSession(phone);
    return '❌ Pedido cancelado.\n\nDigite *oi* para começar um novo pedido!';
  }

  try {
    switch (session.state) {
      case State.IDLE:                return onIdle(phone, msg, session);
      case State.ASK_NAME:            return onAskName(phone, msg, session);
      case State.MAIN_MENU:           return onMainMenu(msg, session);
      case State.SELECT_CATEGORY:     return onSelectCategory(msg, session);
      case State.SELECT_PRODUCT:      return onSelectProduct(msg, session);
      case State.SELECT_SIZE:         return onSelectSize(msg, session);
      case State.ASK_HALF:            return onAskHalf(msg, session);
      case State.SELECT_HALF_PRODUCT: return onSelectHalfProduct(msg, session);
      case State.SELECT_QUANTITY:     return onSelectQuantity(msg, session);
      case State.MORE_ITEMS:          return onMoreItems(msg, session);
      case State.ASK_ADDRESS:         return onAskAddress(msg, session);
      case State.ASK_PAYMENT:         return onAskPayment(msg, session);
      case State.CONFIRM_ORDER:       return onConfirmOrder(phone, msg, session);
      default:
        resetSession(phone);
        return 'Ops, algo deu errado. Digite *oi* para recomeçar.';
    }
  } catch (err: any) {
    logger.error(`[Chatbot] Erro (${phone}): ${err.message}`);
    resetSession(phone);
    return '❌ Ocorreu um erro. Por favor, digite *oi* para recomeçar.';
  }
}

/* ─── State handlers ─── */

async function onIdle(phone: string, msg: string, s: Session): Promise<string> {
  const triggers = [
    'oi', 'olá', 'ola', 'hi', 'hello', 'bom dia', 'boa tarde', 'boa noite',
    'menu', 'cardápio', 'cardapio', 'pedir', 'pedido', 'quero',
  ];
  if (!triggers.some(t => msg.toLowerCase().includes(t))) {
    return '👋 Olá! Sou o atendente virtual da *Pizzatec*! 🍕\n\nDigite *oi* para fazer seu pedido!';
  }

  const cleanPhone = extractPhone(phone);
  const customers = await customerRepo.findCustomersByNameOrPhone(cleanPhone);

  if (customers.length > 0) {
    s.customerId = customers[0].id;
    s.customerName = customers[0].name;
    s.deliveryAddress = customers[0].address || undefined;
    s.state = State.MAIN_MENU;
    return `👋 Olá, *${s.customerName}*! Bem-vindo(a) de volta à *Pizzatec*! 🍕\n\n` + mainMenuText();
  }

  s.state = State.ASK_NAME;
  return '👋 Olá! Bem-vindo(a) à *Pizzatec*! 🍕\n\n' +
    'Parece que é sua primeira vez aqui! 😊\n' +
    'Qual é o seu *nome*?';
}

async function onAskName(phone: string, msg: string, s: Session): Promise<string> {
  if (msg.length < 2) return 'Por favor, digite seu nome (mínimo 2 caracteres):';

  const phoneClean = extractPhone(phone);
  const customer = await customerRepo.createCustomer({ name: msg, phone: phoneClean });

  s.customerId = customer.id;
  s.customerName = msg;
  s.state = State.MAIN_MENU;
  return `Prazer, *${msg}*! 😊\n\n` + mainMenuText();
}

function mainMenuText(): string {
  return 'O que deseja fazer?\n\n' +
    '1️⃣ 📋 Fazer pedido\n' +
    '2️⃣ ❌ Sair\n\n' +
    '_Digite o número da opção:_';
}

async function onMainMenu(msg: string, s: Session): Promise<string> {
  if (msg === '1') return showCategories(s);
  if (msg === '2') {
    s.state = State.IDLE;
    s.cart = [];
    return '👋 Até a próxima! Digite *oi* quando quiser pedir.';
  }
  return 'Digite *1* para pedir ou *2* para sair.';
}

async function showCategories(s: Session): Promise<string> {
  const products = await loadProducts();
  const categories = [...new Set(products.map((p: any) => p.category))].sort();
  s.categories = categories;
  s.state = State.SELECT_CATEGORY;

  let text = '📋 *CARDÁPIO* — Categorias:\n\n';
  categories.forEach((cat, i) => {
    const count = products.filter((p: any) => p.category === cat).length;
    text += `*${i + 1}.* ${cat} (${count})\n`;
  });
  text += '\n_Digite o número da categoria:_';
  return text;
}

async function onSelectCategory(msg: string, s: Session): Promise<string> {
  const idx = parseInt(msg, 10) - 1;
  if (isNaN(idx) || !s.categories || idx < 0 || idx >= s.categories.length) {
    return `Opção inválida. Digite um número de 1 a ${s.categories?.length || '?'}.`;
  }

  const category = s.categories[idx];
  s.pendingCategory = category;
  const products = await loadProducts();
  const filtered = products
    .filter((p: any) => p.category === category)
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
  s.categoryProducts = filtered;
  s.state = State.SELECT_PRODUCT;

  let text = `🍕 *${category}*:\n\n`;
  filtered.forEach((p: any, i: number) => {
    text += `*${i + 1}.* ${p.name} — ${brl(parseFloat(p.price))}\n`;
    if (p.description) text += `   _${p.description}_\n`;
  });
  text += `\n*0.* ⬅️ Voltar às categorias\n`;
  text += '\n_Digite o número do produto:_';
  return text;
}

async function onSelectProduct(msg: string, s: Session): Promise<string> {
  if (msg === '0') return showCategories(s);

  const idx = parseInt(msg, 10) - 1;
  const prods = s.categoryProducts || [];
  if (isNaN(idx) || idx < 0 || idx >= prods.length) {
    return `Opção inválida. Digite um número de 1 a ${prods.length} ou *0* para voltar.`;
  }

  const product = prods[idx];
  s.pendingProductId = product.id;
  s.pendingProductName = product.name;
  s.pendingProductPrice = parseFloat(product.price);

  if (isPizza(s.pendingCategory || '')) {
    s.state = State.SELECT_SIZE;
    return `✅ *${product.name}* — ${brl(s.pendingProductPrice)}\n\n` +
      'Qual o tamanho?\n\n' +
      '1️⃣ Normal\n' +
      '2️⃣ Brotinho (35% off)\n\n' +
      '_Digite 1 ou 2:_';
  }

  s.pendingSize = 'normal';
  s.state = State.SELECT_QUANTITY;
  return `✅ *${product.name}* — ${brl(s.pendingProductPrice)}\n\nQuantas unidades?\n_Digite a quantidade:_`;
}

function onSelectSize(msg: string, s: Session): string {
  if (msg === '1') s.pendingSize = 'normal';
  else if (msg === '2') s.pendingSize = 'brotinho';
  else return 'Digite *1* para Normal ou *2* para Brotinho.';

  s.state = State.ASK_HALF;
  return 'Deseja pizza *meio a meio*? 🍕\n\n' +
    '1️⃣ Não, inteira\n' +
    '2️⃣ Sim, meio a meio\n\n' +
    '_Digite 1 ou 2:_';
}

function onAskHalf(msg: string, s: Session): string {
  if (msg === '1') {
    s.state = State.SELECT_QUANTITY;
    const price = calcUnitPrice(s.pendingProductPrice!, undefined, s.pendingSize!);
    const label = s.pendingSize === 'brotinho' ? ' (Brotinho)' : '';
    return `✅ *${s.pendingProductName}*${label} — ${brl(price)}\n\nQuantas unidades?\n_Digite a quantidade:_`;
  }
  if (msg === '2') {
    s.state = State.SELECT_HALF_PRODUCT;
    const prods = s.categoryProducts || [];
    let text = '🍕 Escolha o sabor da *outra metade*:\n\n';
    prods.forEach((p: any, i: number) => {
      text += `*${i + 1}.* ${p.name} — ${brl(parseFloat(p.price))}\n`;
    });
    text += '\n_Digite o número do sabor:_';
    return text;
  }
  return 'Digite *1* para inteira ou *2* para meio a meio.';
}

async function onSelectHalfProduct(msg: string, s: Session): Promise<string> {
  const prods = s.categoryProducts || [];
  const idx = parseInt(msg, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= prods.length) {
    return `Opção inválida. Digite um número de 1 a ${prods.length}.`;
  }

  const half = prods[idx];
  s.pendingHalfId = half.id;
  s.pendingHalfName = half.name;
  s.pendingHalfPrice = parseFloat(half.price);

  const price = calcUnitPrice(s.pendingProductPrice!, s.pendingHalfPrice, s.pendingSize!);
  const label = s.pendingSize === 'brotinho' ? ' (Brotinho)' : '';
  s.state = State.SELECT_QUANTITY;
  return `✅ *${s.pendingProductName} / ${s.pendingHalfName}*${label} — ${brl(price)}\n\nQuantas unidades?\n_Digite a quantidade:_`;
}

function onSelectQuantity(msg: string, s: Session): string {
  const qty = parseInt(msg, 10);
  if (isNaN(qty) || qty < 1 || qty > 50) {
    return 'Digite uma quantidade válida (1 a 50):';
  }

  const unitPrice = calcUnitPrice(s.pendingProductPrice!, s.pendingHalfPrice, s.pendingSize!);

  s.cart.push({
    productId: s.pendingProductId!,
    productName: s.pendingProductName!,
    quantity: qty,
    size: s.pendingSize!,
    halfProductId: s.pendingHalfId,
    halfProductName: s.pendingHalfName,
    unitPrice,
  });

  // clear pending
  s.pendingProductId = s.pendingProductName = s.pendingCategory = undefined as any;
  s.pendingProductPrice = s.pendingHalfPrice = undefined;
  s.pendingSize = undefined;
  s.pendingHalfId = s.pendingHalfName = undefined;

  const item = s.cart[s.cart.length - 1];
  let desc = item.productName;
  if (item.halfProductName) desc += ` / ${item.halfProductName}`;
  if (item.size === 'brotinho') desc += ' (Brotinho)';
  const sub = item.unitPrice * item.quantity;

  s.state = State.MORE_ITEMS;
  return `✅ Adicionado: *${qty}x ${desc}* — ${brl(sub)}\n\n` +
    'Deseja adicionar mais alguma coisa?\n\n' +
    '1️⃣ Sim, quero mais\n' +
    '2️⃣ Não, finalizar pedido\n\n' +
    '_Digite 1 ou 2:_';
}

async function onMoreItems(msg: string, s: Session): Promise<string> {
  if (msg === '1') return showCategories(s);
  if (msg === '2') {
    if (s.deliveryAddress) {
      s.state = State.ASK_ADDRESS;
      return `📍 Entregar no mesmo endereço?\n*${s.deliveryAddress}*\n\n` +
        '1️⃣ Sim\n' +
        '2️⃣ Não, outro endereço\n' +
        '3️⃣ Vou retirar no local\n\n' +
        '_Digite a opção:_';
    }
    s.state = State.ASK_ADDRESS;
    return '📍 Qual o *endereço de entrega*?\n\nOu digite *retirar* se for buscar no local.';
  }
  return 'Digite *1* para adicionar mais ou *2* para finalizar.';
}

function onAskAddress(msg: string, s: Session): string {
  // If a saved address exists we showed 1/2/3 options
  if (s.deliveryAddress && s.deliveryAddress !== '') {
    if (msg === '1') {
      /* keep current address */
    } else if (msg === '3') {
      s.deliveryAddress = 'RETIRADA NO LOCAL';
    } else if (msg === '2') {
      s.deliveryAddress = undefined;
      return '📍 Digite o novo endereço de entrega:';
    } else {
      return 'Digite *1*, *2* ou *3*.';
    }
  } else {
    // Free-text mode
    if (msg.toLowerCase() === 'retirar' || msg.toLowerCase() === 'retirada') {
      s.deliveryAddress = 'RETIRADA NO LOCAL';
    } else if (msg.length < 5) {
      return '📍 Digite um endereço válido ou *retirar* para buscar no local.';
    } else {
      s.deliveryAddress = msg;
    }
  }

  s.state = State.ASK_PAYMENT;
  return '💳 Forma de pagamento:\n\n' +
    '1️⃣ Dinheiro\n' +
    '2️⃣ Cartão (na entrega)\n' +
    '3️⃣ PIX\n\n' +
    '_Digite a opção:_';
}

function onAskPayment(msg: string, s: Session): string {
  const methods: Record<string, string> = { '1': 'Dinheiro', '2': 'Cartão', '3': 'PIX' };
  if (!methods[msg]) return 'Digite *1* (Dinheiro), *2* (Cartão) ou *3* (PIX).';

  s.paymentMethod = methods[msg];
  s.state = State.CONFIRM_ORDER;

  return buildSummary(s) + '\n\n' +
    '✅ *Confirmar pedido?*\n\n' +
    '1️⃣ Sim, confirmar\n' +
    '2️⃣ Não, cancelar\n\n' +
    '_Digite 1 ou 2:_';
}

function buildSummary(s: Session): string {
  const lines: string[] = [];
  lines.push('─────────────────');
  lines.push('📋 *RESUMO DO PEDIDO*');
  lines.push('─────────────────');
  lines.push('');

  let total = 0;
  s.cart.forEach((item, i) => {
    let desc = item.productName;
    if (item.halfProductName) desc += ` / ${item.halfProductName}`;
    if (item.size === 'brotinho') desc += ' _(Brotinho)_';
    const sub = item.unitPrice * item.quantity;
    total += sub;
    lines.push(`${i + 1}. ${item.quantity}x ${desc}`);
    lines.push(`   ${brl(sub)}`);
  });

  lines.push('');
  lines.push(`💰 *Total: ${brl(total)}*`);
  lines.push('');
  lines.push(`📍 ${s.deliveryAddress}`);
  lines.push(`💳 ${s.paymentMethod}`);
  return lines.join('\n');
}

async function onConfirmOrder(phone: string, msg: string, s: Session): Promise<string> {
  if (msg === '2') {
    resetSession(phone);
    return '❌ Pedido cancelado.\n\nDigite *oi* para um novo pedido!';
  }
  if (msg !== '1') return 'Digite *1* para confirmar ou *2* para cancelar.';

  const items: CreateOrderItemDTO[] = s.cart.map(item => ({
    productId: item.productId,
    quantity: item.quantity,
    size: item.size,
    halfProductId: item.halfProductId,
  }));

  const dto: CreateOrderDTO = {
    customerId: s.customerId!,
    items,
    paymentMethod: s.paymentMethod,
    deliveryAddress: s.deliveryAddress !== 'RETIRADA NO LOCAL' ? s.deliveryAddress : undefined,
    notes: 'Pedido via WhatsApp',
  };

  const order = await createOrder(dto);

  // Save/update address on customer profile
  if (s.deliveryAddress && s.deliveryAddress !== 'RETIRADA NO LOCAL' && s.customerId) {
    await customerRepo.updateCustomer(s.customerId, { address: s.deliveryAddress }).catch(() => {});
  }

  // Notify the web dashboard
  broadcast('new-order', {
    id: order.id,
    customerName: s.customerName,
    total: order.total,
    itemCount: s.cart.reduce((sum, i) => sum + i.quantity, 0),
  });

  resetSession(phone);

  return `🎉 *Pedido #${order.id} confirmado!*\n\n` +
    'Seu pedido foi recebido e já está sendo preparado! 👨‍🍳\n\n' +
    'Você receberá atualizações sobre o status por aqui.\n\n' +
    '_Obrigado pela preferência! 🍕_';
}
