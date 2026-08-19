/**
 * Chatbot Hamburgueria
 *
 * Fluxo:
 *  1. Oi → boas-vindas + cadastro (se novo) OU menu direto (se cadastrado)
 *  2. Menu → escolhe categoria → escolhe produto
 *  3. Adicionais do produto escolhido (variações do BD)
 *  4. "Quer adicionar mais alguma coisa?" → sim volta ao menu, não segue
 *  5. Endereço de entrega
 *  6. Forma de pagamento
 *  7. Recibo completo para confirmação
 */

import * as customerRepo from '../repositories/customer.repository';
import * as productRepo   from '../repositories/product.repository';
import { createOrder }    from '../repositories/order.repository';
import {
  getDeliveryFee,
  getChatbotConfig,
  type PaymentOption,
  type ChatbotConfig,
} from '../repositories/settings.repository';
import { getBusinessContext } from '../database/businessContext';
import { CreateOrderItemDTO } from '../dtos/order.dto';
import { broadcast }          from './notification.service';
import logger                 from '../utils/logger';

/* ─── Tipos ─────────────────────────────────────────────────────── */

type State =
  | 'INIT'
  | 'REPEAT_OFFER'
  | 'AWAIT_NAME'
  | 'AWAIT_PHONE'
  | 'AWAIT_ADDRESS'
  | 'SELECT_CAT'
  | 'SELECT_PRODUCT'
  | 'SELECT_EXTRAS'
  | 'ASK_MORE'
  | 'AWAIT_DELIVERY_CHOICE'
  | 'AWAIT_CUSTOM_ADDRESS'
  | 'AWAIT_PAYMENT'
  | 'AWAIT_TROCO'
  | 'CONFIRMING';

interface Extra {
  variationId: string;
  name: string;
  price: number;
}

interface CartItem {
  productId: string;
  productName: string;
  basePrice: number;
  extras: Extra[];
  unitPrice: number; // basePrice + soma dos extras
}

interface ItemBuilder {
  product: any;
  variations: any[];
}

interface HSession {
  state: State;
  customerId?: string;
  customerName?: string;
  tempName?: string;
  tempPhone?: string;
  savedAddress?: string;
  deliveryAddress?: string;
  paymentMethod?: string;
  troco?: number;
  cart: CartItem[];
  currentCategory?: string;
  itemBuilder?: ItemBuilder;
  lastActivity: number;
}

/* ─── Cache ──────────────────────────────────────────────────────── */

const SESSION_TIMEOUT_MS   = 30 * 60 * 1000;
const PRODUCT_CACHE_TTL    =  5 * 60 * 1000;
const CONFIG_CACHE_TTL     =  2 * 60 * 1000;
const VARIATIONS_CACHE_TTL =  5 * 60 * 1000;

const sessions    = new Map<string, HSession>();
const lastOrders  = new Map<string, CartItem[]>();

const productsCacheMap   = new Map<string, { products: any[];   cacheTime: number }>();
const configCacheMap     = new Map<string, { config: ChatbotConfig; cacheTime: number }>();
const variationsCacheMap = new Map<string, { variations: any[]; cacheTime: number }>();

/* ─── Helpers ────────────────────────────────────────────────────── */

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function extractPhone(chatId: string) {
  // JID do Baileys: "5511910731832:7@s.whatsapp.net" — strip device ID e server
  const clean = chatId.split('@')[0].split(':')[0];
  const d = clean.replace(/\D/g, '');
  return d.startsWith('55') ? d.slice(2) : d;
}

function sessionKey(businessId: string, phone: string) {
  return `${businessId}:${phone}`;
}

function getSession(businessId: string, phone: string): HSession {
  const key = sessionKey(businessId, phone);
  let s = sessions.get(key);
  if (s && Date.now() - s.lastActivity > SESSION_TIMEOUT_MS) {
    sessions.delete(key);
    s = undefined;
  }
  if (!s) {
    s = { state: 'INIT', cart: [], lastActivity: Date.now() };
    sessions.set(key, s);
  }
  s.lastActivity = Date.now();
  return s;
}

async function loadProducts(businessId: string) {
  const now = Date.now();
  const c = productsCacheMap.get(businessId);
  if (c && now - c.cacheTime < PRODUCT_CACHE_TTL) return c.products;
  // Esgotados ficam fora do cardápio do bot — não há como o cliente pedir o que não tem.
  const products = (await productRepo.getAllProducts()).filter(inStock);
  productsCacheMap.set(businessId, { products, cacheTime: now });
  return products;
}

async function loadConfig(businessId: string) {
  const now = Date.now();
  const c = configCacheMap.get(businessId);
  if (c && now - c.cacheTime < CONFIG_CACHE_TTL) return c.config;
  const config = await getChatbotConfig();
  configCacheMap.set(businessId, { config, cacheTime: now });
  return config;
}

async function loadVariations(productId: string) {
  const now = Date.now();
  const c = variationsCacheMap.get(productId);
  if (c && now - c.cacheTime < VARIATIONS_CACHE_TTL) return c.variations;
  const variations = await productRepo.getVariationsByProduct(productId);
  variationsCacheMap.set(productId, { variations, cacheTime: now });
  return variations;
}

/** stockQuantity NULL = produto sem controle de estoque; 0 = esgotado. */
function inStock(p: any): boolean {
  return p.stockQuantity === null || p.stockQuantity === undefined || Number(p.stockQuantity) > 0;
}

function getCategories(products: any[]) {
  return [...new Set(products.map((p: any) => p.category as string))].sort();
}

function itemTotal(item: CartItem) {
  return item.basePrice + item.extras.reduce((s, e) => s + e.price, 0);
}

/* ─── Mensagens ─────────────────────────────────────────────────── */

function msgMenu(products: any[], businessName: string): string {
  const cats = getCategories(products);
  let msg = `🍔 *CARDÁPIO — ${businessName}*\n`;
  msg += '─────────────────────\n\n';
  for (const cat of cats) {
    msg += `*${cat.toUpperCase()}*\n\n`;
    for (const p of products.filter((x: any) => x.category === cat)) {
      msg += `• *${p.name}* — ${brl(parseFloat(p.price))}`;
      if (p.description) msg += `\n   _${p.description}_`;
      msg += '\n\n';
    }
  }
  msg += '─────────────────────\n';
  msg += '*Escolha uma categoria:*\n\n';
  cats.forEach((cat, i) => { msg += `*${i + 1}.* ${cat}\n`; });
  return msg;
}

function msgCatMenu(products: any[]): string {
  const cats = getCategories(products);
  let msg = '📂 *Categorias:*\n\n';
  cats.forEach((cat, i) => { msg += `*${i + 1}.* ${cat}\n`; });
  return msg;
}

function msgProductMenu(products: any[], category: string): string {
  const items = products.filter((p: any) => p.category === category);
  let msg = `📋 *${category}:*\n\n`;
  items.forEach((p, i) => {
    msg += `*${i + 1}.* ${p.name} — ${brl(parseFloat(p.price))}`;
    if (p.description) msg += `\n   _${p.description}_`;
    msg += '\n';
  });
  msg += '\n_Digite o número ou *voltar*._';
  return msg;
}

function msgExtrasMenu(variations: any[]): string {
  let msg = '➕ *Adicionais disponíveis:*\n\n';
  variations.forEach((v, i) => {
    const price = parseFloat(v.priceModifier ?? 0);
    msg += `*${i + 1}.* ${v.name}`;
    if (price > 0) msg += ` — +${brl(price)}`;
    msg += '\n';
  });
  msg += `*${variations.length + 1}.* Sem adicional\n\n`;
  msg += '_Digite o número (ou vários separados por vírgula):_';
  return msg;
}

function msgCartLine(item: CartItem): string {
  let line = `• *${item.productName}* — ${brl(item.basePrice)}`;
  if (item.extras.length > 0) {
    line += `\n  ➕ ${item.extras.map(e => e.name).join(', ')} (+${brl(item.extras.reduce((s, e) => s + e.price, 0))})`;
  }
  line += `\n  💰 ${brl(itemTotal(item))}`;
  return line;
}

function msgAskMore(cart: CartItem[], deliveryFee: number): string {
  const subtotal = cart.reduce((s, i) => s + itemTotal(i), 0);
  let msg = '🛒 *Carrinho atual:*\n\n';
  cart.forEach(item => { msg += msgCartLine(item) + '\n\n'; });
  msg += `Subtotal: *${brl(subtotal)}*\n`;
  if (deliveryFee > 0) msg += `🚚 + taxa de entrega: ${brl(deliveryFee)}\n`;
  msg += '\n*Deseja adicionar mais alguma coisa?*\n\n*1.* Sim\n*2.* Não, finalizar pedido';
  return msg;
}

function msgReceipt(session: HSession, deliveryFee: number, paymentMethods: PaymentOption[]): string {
  const isPickup = session.deliveryAddress === 'RETIRADA NO LOCAL';
  const fee      = isPickup ? 0 : deliveryFee;
  const subtotal = session.cart.reduce((s, i) => s + itemTotal(i), 0);
  const total    = subtotal + fee;

  let msg = '🧾 *RESUMO DO PEDIDO*\n━━━━━━━━━━━━━━━━━━━━\n\n';
  session.cart.forEach((item, i) => {
    msg += `*${i + 1}.* ${item.productName} — ${brl(item.basePrice)}\n`;
    if (item.extras.length > 0) {
      msg += `   ➕ ${item.extras.map(e => e.name).join(', ')} (+${brl(item.extras.reduce((s, e) => s + e.price, 0))})\n`;
    }
    msg += `   💰 ${brl(itemTotal(item))}\n\n`;
  });
  msg += '─────────────────────\n';
  if (fee > 0) msg += `🚚 Taxa de entrega: ${brl(fee)}\n`;
  msg += `💰 *TOTAL: ${brl(total)}*\n\n`;
  msg += `📍 ${isPickup ? 'Retirada no local' : session.deliveryAddress}\n`;
  const payLabel = paymentMethods.find(pm => pm.key === session.paymentMethod)?.label ?? session.paymentMethod;
  msg += `💳 ${payLabel}`;
  if (session.troco) msg += `\n💵 Troco para: ${brl(session.troco)}`;
  msg += '\n\n━━━━━━━━━━━━━━━━━━━━\nConfirmar? *sim* · *não*';
  return msg;
}

/* ─── Ponto de entrada ──────────────────────────────────────────── */

export async function handleHamburguerMessage(phone: string, body: string): Promise<string> {
  const { businessId } = getBusinessContext()!;
  const session    = getSession(businessId, phone);
  const cleanPhone = extractPhone(phone);
  const text       = body.trim().toLowerCase();
  const key        = sessionKey(businessId, phone);

  /* ── Comandos globais ── */
  if (/^(cancelar|sair|recomeçar|recomecar)$/.test(text)) {
    sessions.delete(key);
    return '❌ Pedido cancelado. Quando quiser, é só chamar! 😊';
  }
  if (/^(ajuda|help|\?)$/.test(text)) {
    return '🆘 *Comandos:*\n\n• *cancelar* — reiniciar\n• *voltar* — passo anterior';
  }

  const [products, deliveryFee, config] = await Promise.all([
    loadProducts(businessId),
    getDeliveryFee(),
    loadConfig(businessId),
  ]);
  const { businessName, paymentMethods } = config;

  /* ── Ver carrinho a qualquer momento ── */
  if (/^(carrinho|ver carrinho)$/.test(text) && session.cart.length > 0) {
    return msgAskMore(session.cart, deliveryFee);
  }

  switch (session.state) {

    /* ── INIT ──────────────────────────────────────────────────── */
    case 'INIT': {
      const found = await customerRepo.findCustomersByNameOrPhone(cleanPhone);
      if (found.length > 0) {
        session.customerId   = found[0].id;
        session.customerName = found[0].name;
        session.savedAddress = found[0].address || undefined;

        const last = lastOrders.get(key);
        if (last?.length) {
          session.state = 'REPEAT_OFFER';
          return (
            `Olá, *${found[0].name}*! 👋 Saudades!\n\n` +
            `🔄 *Repetir último pedido?*\n_${last.map(i => i.productName).join(', ')}_\n\n` +
            '*1.* Sim, quero o mesmo!\n*2.* Quero montar um novo pedido'
          );
        }
        session.state = 'SELECT_CAT';
        return `Olá, *${found[0].name}*! 👋 Que bom ter você de volta!\n\n` + msgMenu(products, businessName);
      }
      session.state = 'AWAIT_NAME';
      return `Olá! 👋 Seja bem-vindo(a) à *${businessName}*!\n\nQual é o seu nome?`;
    }

    /* ── REPEAT_OFFER ──────────────────────────────────────────── */
    case 'REPEAT_OFFER': {
      if (text === '1') {
        session.cart  = (lastOrders.get(key) ?? []).map(i => ({ ...i, extras: [...i.extras] }));
        session.state = 'ASK_MORE';
        return msgAskMore(session.cart, deliveryFee);
      }
      session.state = 'SELECT_CAT';
      return msgMenu(products, businessName);
    }

    /* ── AWAIT_NAME ────────────────────────────────────────────── */
    case 'AWAIT_NAME': {
      if (body.trim().length < 2) return '⚠️ Por favor, informe seu nome.';
      session.tempName = body.trim();
      session.state    = 'AWAIT_PHONE';
      return `Prazer, *${session.tempName}*! 😊\n\n📱 *Qual o seu número de celular com DDD?*\n_(Ex: 11912345678)_`;
    }

    /* ── AWAIT_PHONE ───────────────────────────────────────────── */
    case 'AWAIT_PHONE': {
      const digits = body.trim().replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 11) {
        return '⚠️ Número inválido. Informe o celular com DDD, sem espaços ou traços.\n_(Ex: 11912345678)_';
      }
      session.tempPhone = digits;
      session.state     = 'AWAIT_ADDRESS';
      return `📍 *Qual o seu endereço de entrega?*\n_(Rua, número e bairro)_`;
    }

    /* ── AWAIT_ADDRESS ─────────────────────────────────────────── */
    case 'AWAIT_ADDRESS': {
      if (body.trim().length < 5) return '⚠️ Informe o endereço completo (rua, número e bairro).';
      try {
        const customer = await customerRepo.createCustomer({
          name:    session.tempName!,
          phone:   session.tempPhone!,
          address: body.trim(),
        });
        session.customerId   = customer.id;
        session.customerName = session.tempName!;
        session.savedAddress = body.trim();
        session.state        = 'SELECT_CAT';
        logger.info(`[Chatbot Hamburgueria] Cliente criado: ${customer.id}`);
        return `✅ *Cadastro realizado, ${session.customerName}!*\n\nAqui está nosso cardápio:\n\n` + msgMenu(products, businessName);
      } catch (err: any) {
        logger.error(`[Chatbot Hamburgueria] Erro ao criar cliente: ${err.message}`);
        return '❌ Erro ao salvar cadastro. Tente novamente.';
      }
    }

    /* ── SELECT_CAT ────────────────────────────────────────────── */
    case 'SELECT_CAT': {
      const cats = getCategories(products);
      const idx  = parseInt(text, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= cats.length) {
        return '⚠️ Categoria inválida.\n\n' + msgCatMenu(products);
      }
      session.currentCategory = cats[idx];
      session.state           = 'SELECT_PRODUCT';
      return msgProductMenu(products, session.currentCategory);
    }

    /* ── SELECT_PRODUCT ────────────────────────────────────────── */
    case 'SELECT_PRODUCT': {
      if (text === 'voltar') {
        session.state = 'SELECT_CAT';
        return msgCatMenu(products);
      }
      const items = products.filter((p: any) => p.category === session.currentCategory);
      const idx   = parseInt(text, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= items.length) {
        return '⚠️ Opção inválida.\n\n' + msgProductMenu(products, session.currentCategory!);
      }
      const chosen     = items[idx];
      const variations = await loadVariations(chosen.id);

      if (variations.length > 0) {
        session.itemBuilder = { product: chosen, variations };
        session.state       = 'SELECT_EXTRAS';
        return `✅ *${chosen.name}* (${brl(parseFloat(chosen.price))})\n\n` + msgExtrasMenu(variations);
      }

      // Sem adicionais: adiciona direto ao carrinho
      session.cart.push({
        productId:   chosen.id,
        productName: chosen.name,
        basePrice:   parseFloat(chosen.price),
        extras:      [],
        unitPrice:   parseFloat(chosen.price),
      });
      session.state = 'ASK_MORE';
      return `✅ *${chosen.name}* adicionado!\n\n` + msgAskMore(session.cart, deliveryFee);
    }

    /* ── SELECT_EXTRAS ─────────────────────────────────────────── */
    case 'SELECT_EXTRAS': {
      const { product, variations } = session.itemBuilder!;
      const noIdx = variations.length + 1;

      // Parse: "pular", "não", número ou números separados por vírgula
      let selectedExtras: Extra[] = [];

      if (!/^(pular|nao|não|nada|sem adicional)$/i.test(text)) {
        const nums = text.split(/[,\s]+/).map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));

        if (nums.length === 0 || nums.some(n => n < 1 || n > noIdx)) {
          return '⚠️ Opção inválida.\n\n' + msgExtrasMenu(variations);
        }

        if (!nums.includes(noIdx)) {
          selectedExtras = nums.map(n => {
            const v = variations[n - 1];
            return { variationId: v.id, name: v.name, price: parseFloat(v.priceModifier ?? 0) };
          });
        }
      }

      const basePrice = parseFloat(product.price);
      const extrasTotal = selectedExtras.reduce((s, e) => s + e.price, 0);
      session.cart.push({
        productId:   product.id,
        productName: product.name,
        basePrice,
        extras:      selectedExtras,
        unitPrice:   basePrice + extrasTotal,
      });
      session.itemBuilder = undefined;
      session.state       = 'ASK_MORE';
      return `✅ *${product.name}* adicionado!\n\n` + msgAskMore(session.cart, deliveryFee);
    }

    /* ── ASK_MORE ──────────────────────────────────────────────── */
    case 'ASK_MORE': {
      if (text === '1') {
        session.state = 'SELECT_CAT';
        return msgCatMenu(products);
      }
      if (text === '2') {
        session.state = 'AWAIT_DELIVERY_CHOICE';
        let msg = '📍 *Endereço de entrega:*\n\n';
        if (session.savedAddress) {
          msg += `*1.* Entregar em: _${session.savedAddress}_\n`;
          msg += `*2.* Retirar no local (sem taxa)\n`;
          msg += `*3.* Outro endereço`;
        } else {
          msg += `*1.* Retirar no local (sem taxa)\n`;
          msg += `*2.* Informar endereço`;
        }
        return msg;
      }
      return '⚠️ Digite *1* para adicionar mais ou *2* para finalizar.';
    }

    /* ── AWAIT_DELIVERY_CHOICE ─────────────────────────────────── */
    case 'AWAIT_DELIVERY_CHOICE': {
      const hasSaved  = !!session.savedAddress;
      const optPickup = hasSaved ? '2' : '1';
      const optOther  = hasSaved ? '3' : '2';

      if (text === '1' && hasSaved) {
        session.deliveryAddress = session.savedAddress;
        return goToPayment(session, deliveryFee, paymentMethods);
      }
      if (text === optPickup) {
        session.deliveryAddress = 'RETIRADA NO LOCAL';
        return goToPayment(session, deliveryFee, paymentMethods);
      }
      if (text === optOther) {
        session.state = 'AWAIT_CUSTOM_ADDRESS';
        return '📍 Digite seu endereço completo (rua, número e bairro):';
      }
      return `⚠️ Escolha ${hasSaved ? '*1*, *2* ou *3*' : '*1* ou *2*'}.`;
    }

    /* ── AWAIT_CUSTOM_ADDRESS ──────────────────────────────────── */
    case 'AWAIT_CUSTOM_ADDRESS': {
      if (body.trim().length < 5) return '⚠️ Informe o endereço completo (rua, número e bairro).';
      session.deliveryAddress = body.trim();
      return goToPayment(session, deliveryFee, paymentMethods);
    }

    /* ── AWAIT_PAYMENT ─────────────────────────────────────────── */
    case 'AWAIT_PAYMENT': {
      const idx = parseInt(text, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= paymentMethods.length) {
        return '⚠️ Opção inválida.\n\n' + msgPaymentMenu(paymentMethods);
      }
      const chosen = paymentMethods[idx];
      session.paymentMethod = chosen.key;

      if (chosen.key === 'CASH') {
        session.state = 'AWAIT_TROCO';
        return '💵 Precisa de troco? Se sim, para quanto? (ex: *50*)  Se não, digite *não*.';
      }
      session.state = 'CONFIRMING';
      return msgReceipt(session, deliveryFee, paymentMethods);
    }

    /* ── AWAIT_TROCO ───────────────────────────────────────────── */
    case 'AWAIT_TROCO': {
      if (!/^(n[ãa]o|nao|no|-)$/i.test(text)) {
        const val = parseFloat(text.replace(',', '.'));
        if (!isNaN(val) && val > 0) session.troco = val;
      }
      session.state = 'CONFIRMING';
      return msgReceipt(session, deliveryFee, paymentMethods);
    }

    /* ── CONFIRMING ────────────────────────────────────────────── */
    case 'CONFIRMING': {
      if (/^(sim|s|yes|confirmar|confirmo)$/.test(text)) {
        try {
          const isPickup = session.deliveryAddress === 'RETIRADA NO LOCAL';
          const fee      = isPickup ? 0 : deliveryFee;

          const items: CreateOrderItemDTO[] = session.cart.map(item => ({
            productId: item.productId,
            quantity:  1,
            size:      'unico',
          }));

          const noteParts: string[] = [];
          session.cart.forEach((item, i) => {
            if (item.extras.length > 0) {
              noteParts.push(`Item ${i + 1} (${item.productName}): ${item.extras.map(e => e.name).join(', ')}`);
            }
          });
          if (session.troco) noteParts.push(`Troco para: ${brl(session.troco)}`);
          const notes = noteParts.join(' | ') || 'Pedido via WhatsApp';

          const payLabel = paymentMethods.find(pm => pm.key === session.paymentMethod)?.label ?? session.paymentMethod!;

          const order = await createOrder({
            customerId:      session.customerId!,
            items,
            paymentMethod:   payLabel,
            deliveryAddress: !isPickup ? session.deliveryAddress : undefined,
            deliveryFee:     fee,
            notes,
            channel:         'whatsapp',
          });

          logger.info(`[Chatbot Hamburgueria] Pedido criado: #${order.id}`);
          broadcast('new-order', {
            id:           order.id,
            customerName: session.customerName,
            total:        order.total,
            itemCount:    session.cart.length,
            channel:      'whatsapp',
          });

          lastOrders.set(key, session.cart.map(i => ({ ...i, extras: [...i.extras] })));
          sessions.delete(key);

          return (
            `✅ *Pedido #${order.id} confirmado!*\n\n` +
            `🍔 Já estamos preparando, *${session.customerName}*! 😊❤️`
          );
        } catch (err: any) {
          logger.error(`[Chatbot Hamburgueria] Erro ao criar pedido: ${err.message}`);
          return '❌ Erro ao registrar o pedido. Tente novamente ou ligue para nós.';
        }
      }
      if (/^(n[ãa]o|nao|no|cancelar)$/.test(text)) {
        sessions.delete(key);
        return '❌ Pedido cancelado. Quando quiser, é só chamar! 😊';
      }
      return 'Digite *sim* para confirmar ou *não* para cancelar.';
    }

    default:
      sessions.delete(key);
      return 'Olá! Para começar, é só mandar uma mensagem 😊';
  }
}

/* ─── Helpers internos ──────────────────────────────────────────── */

function msgPaymentMenu(paymentMethods: PaymentOption[]): string {
  let msg = '💳 *Forma de pagamento:*\n\n';
  paymentMethods.forEach((pm, i) => { msg += `*${i + 1}.* ${pm.label}\n`; });
  return msg;
}

function goToPayment(session: HSession, deliveryFee: number, paymentMethods: PaymentOption[]): string {
  session.state  = 'AWAIT_PAYMENT';
  const isPickup = session.deliveryAddress === 'RETIRADA NO LOCAL';
  const fee      = isPickup ? 0 : deliveryFee;
  const subtotal = session.cart.reduce((s, i) => s + itemTotal(i), 0);

  return (
    `📍 ${isPickup ? 'Retirada no local' : session.deliveryAddress}\n` +
    (fee > 0 ? `🚚 Entrega: ${brl(fee)}\n` : '') +
    `💰 *Total: ${brl(subtotal + fee)}*\n\n` +
    msgPaymentMenu(paymentMethods)
  );
}
