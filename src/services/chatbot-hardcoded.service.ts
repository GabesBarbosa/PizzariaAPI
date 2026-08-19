/**
 * Chatbot hardcoded v3 — fluxo guiado dinâmico por business
 * Cada negócio puxa suas configs (nome, bordas, tamanhos, pagamentos) do banco.
 */

import * as customerRepo from '../repositories/customer.repository';
import * as productRepo from '../repositories/product.repository';
import { createOrder } from '../repositories/order.repository';
import {
  getDeliveryFee,
  getChatbotConfig,
  type CrustOption,
  type SizeOption,
  type PaymentOption,
  type ChatbotConfig,
} from '../repositories/settings.repository';
import { getBusinessContext } from '../database/businessContext';
import { CreateOrderItemDTO } from '../dtos/order.dto';
import { broadcast } from './notification.service';
import logger from '../utils/logger';

/* ─── Tipos ─────────────────────────────────────────────────────── */

type State =
  | 'INIT'
  | 'REPEAT_OFFER'
  | 'AWAIT_NAME'
  | 'AWAIT_ADDRESS'
  | 'SELECT_SIZE'
  | 'SELECT_SPLIT'
  | 'SELECT_CAT'
  | 'SELECT_FLAVOR'
  | 'SELECT_CRUST'
  | 'AWAIT_NOTES'
  | 'CART_REVIEW'
  | 'AWAIT_DELIVERY_CHOICE'
  | 'AWAIT_CUSTOM_ADDRESS'
  | 'AWAIT_PAYMENT'
  | 'AWAIT_TROCO'
  | 'CONFIRMING';

interface CartPizza {
  size: string;
  product1Id: string;
  product1Name: string;
  product2Id?: string;
  product2Name?: string;
  crust?: string;
  crustPrice: number;
  pizzaNotes?: string;
  unitPrice: number;
}

interface PizzaBuilder {
  size: string;
  maxFlavors: number;
  flavorStep: 1 | 2;
  product1?: any;
  product2?: any;
  crust?: string;
  currentCategory?: string;
}

interface HSession {
  state: State;
  customerId?: string;
  customerName?: string;
  tempName?: string;
  savedAddress?: string;
  deliveryAddress?: string;
  paymentMethod?: string;
  troco?: number;
  cart: CartPizza[];
  builder?: PizzaBuilder;
  lastActivity: number;
}

/* ─── Constantes ─────────────────────────────────────────────────── */

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const PRODUCT_CACHE_TTL  =  5 * 60 * 1000;
const CONFIG_CACHE_TTL   =  2 * 60 * 1000;

/* ─── Estado em memória (escopado por businessId) ────────────────── */

const sessions   = new Map<string, HSession>();
const lastOrders = new Map<string, CartPizza[]>();

interface ProductCache { products: any[]; cacheTime: number; }
const productsCacheMap = new Map<string, ProductCache>();

interface ConfigCache { config: ChatbotConfig; cacheTime: number; }
const configCacheMap = new Map<string, ConfigCache>();

/* ─── Helpers ───────────────────────────────────────────────────── */

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function extractPhone(chatId: string): string {
  // JID do Baileys: "5511910731832:7@s.whatsapp.net" — strip device ID e server
  const clean = chatId.split('@')[0].split(':')[0];
  const d = clean.replace(/\D/g, '');
  return d.startsWith('55') ? d.slice(2) : d;
}

function sessionKey(businessId: string, phone: string): string {
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

async function loadProducts(businessId: string): Promise<any[]> {
  const now = Date.now();
  const cached = productsCacheMap.get(businessId);
  if (!cached || now - cached.cacheTime > PRODUCT_CACHE_TTL) {
    // Esgotados ficam fora do cardápio do bot — não há como o cliente pedir o que não tem.
    const products = (await productRepo.getAllProducts()).filter(inStock);
    productsCacheMap.set(businessId, { products, cacheTime: now });
    return products;
  }
  return cached.products;
}

async function loadConfig(businessId: string): Promise<ChatbotConfig> {
  const now = Date.now();
  const cached = configCacheMap.get(businessId);
  if (!cached || now - cached.cacheTime > CONFIG_CACHE_TTL) {
    const config = await getChatbotConfig();
    configCacheMap.set(businessId, { config, cacheTime: now });
    return config;
  }
  return cached.config;
}

/** stockQuantity NULL = produto sem controle de estoque; 0 = esgotado. */
function inStock(p: any): boolean {
  return p.stockQuantity === null || p.stockQuantity === undefined || Number(p.stockQuantity) > 0;
}

function getCategories(products: any[]): string[] {
  return [...new Set(products.map((p: any) => p.category as string))].sort();
}

function calcPizzaPrice(
  sizeKey: string,
  sizeOptions: Record<string, SizeOption>,
  p1Price: number,
  p2Price = 0,
  crustPrice = 0,
): number {
  const multiplier = sizeOptions[sizeKey]?.multiplier ?? 1;
  const base = Math.max(p1Price, p2Price);
  return Math.round((base * multiplier + crustPrice) * 100) / 100;
}

/* ─── Mensagens (dinâmicas) ────────────────────────────────────── */

function msgSizeMenu(sizeOptions: Record<string, SizeOption>): string {
  const keys = Object.keys(sizeOptions);
  let msg = '📏 *Qual o tamanho?*\n\n';
  keys.forEach((key, i) => {
    const opt = sizeOptions[key];
    msg += `*${i + 1}.* ${opt.label}\n`;
  });
  return msg;
}

function msgCategoryMenu(products: any[], step: number): string {
  const cats = getCategories(products);
  const header = step === 2 ? '📂 *Categoria do 2º item:*' : '📂 *Escolha a categoria:*';
  let msg = header + '\n\n';
  cats.forEach((cat, i) => { msg += `*${i + 1}.* ${cat}\n`; });
  return msg;
}

function msgFlavorMenu(products: any[], category: string, step: number): string {
  const header = step === 2 ? `📋 *2º item — ${category}:*` : `📋 *${category}:*`;
  const items = products.filter((p: any) => p.category === category);
  let msg = header + '\n\n';
  items.forEach((p, i) => {
    msg += `*${i + 1}.* ${p.name}`;
    if (p.description) msg += ` — _${p.description}_`;
    msg += '\n';
  });
  msg += '\n_Digite o número ou *voltar* para trocar a categoria._';
  return msg;
}

function msgMenuWithCategories(products: any[], sizeOptions: Record<string, SizeOption>): string {
  const categories = getCategories(products);
  const sizeKeys = Object.keys(sizeOptions);
  let msg = '📋 *CARDÁPIO*\n';
  msg += '─────────────────────\n\n';
  for (const cat of categories) {
    msg += `*${cat.toUpperCase()}*\n\n`;
    for (const p of products.filter((x: any) => x.category === cat)) {
      const price = parseFloat(p.price);
      msg += `• *${p.name}*`;
      if (p.description) msg += ` — _${p.description}_`;
      msg += '\n';
      if (sizeKeys.length <= 1) {
        const mult = sizeKeys.length === 1 ? (sizeOptions[sizeKeys[0]].multiplier ?? 1) : 1;
        msg += `   ${brl(Math.round(price * mult * 100) / 100)}\n`;
      } else {
        const prices = sizeKeys.map(k => `${sizeOptions[k].label}: ${brl(Math.round(price * (sizeOptions[k].multiplier ?? 1) * 100) / 100)}`).join(' | ');
        msg += `   ${prices}\n`;
      }
      msg += '\n';
    }
  }
  msg += '─────────────────────\n';
  msg += '*Para pedir, escolha uma categoria:*\n\n';
  categories.forEach((cat, i) => { msg += `*${i + 1}.* ${cat}\n`; });
  return msg;
}

function msgCrustMenu(crustOptions: CrustOption[]): string {
  let msg = '✨ *Deseja algum adicional?*\n\n';
  crustOptions.forEach((c, i) => { msg += `*${i + 1}.* ${c.label} — ${brl(c.price)}\n`; });
  msg += `*${crustOptions.length + 1}.* Sem adicional`;
  return msg;
}

function msgCartSummary(
  cart: CartPizza[],
  deliveryFee: number,
  isPickup: boolean,
  sizeOptions: Record<string, SizeOption>,
): string {
  let msg   = '📋 *SEU PEDIDO ATÉ AGORA*\n━━━━━━━━━━━━━━━━━━━━\n\n';
  let total = 0;
  cart.forEach((pizza, i) => {
    total += pizza.unitPrice;
    const flavors = pizza.product2Name
      ? `Meio ${pizza.product1Name} / Meio ${pizza.product2Name}`
      : pizza.product1Name;
    const sizeLabel = sizeOptions[pizza.size]?.label ?? pizza.size;
    msg += `*${i + 1}.* ${sizeLabel} — ${flavors}\n`;
    if (pizza.crust)      msg += `   ✨ Adicional: ${pizza.crust}\n`;
    if (pizza.pizzaNotes) msg += `   📝 ${pizza.pizzaNotes}\n`;
    msg += `   💰 ${brl(pizza.unitPrice)}\n\n`;
  });
  const fee = isPickup ? 0 : deliveryFee;
  if (fee > 0) msg += `🚚 Entrega: ${brl(fee)}\n`;
  msg += `*TOTAL: ${brl(total + fee)}*\n\n`;
  msg += '━━━━━━━━━━━━━━━━━━━━\n';
  msg += '*1.* Adicionar outro item\n';
  msg += '*2.* Finalizar pedido';
  return msg;
}

function msgPaymentMenu(paymentMethods: PaymentOption[]): string {
  let msg = '💳 *Forma de pagamento:*\n';
  paymentMethods.forEach((pm, i) => { msg += `*${i + 1}.* ${pm.label}\n`; });
  return msg;
}

/* ─── Ponto de entrada ──────────────────────────────────────────── */

export async function handleHardcodedMessage(phone: string, body: string): Promise<string> {
  const { businessId } = getBusinessContext()!;
  const session    = getSession(businessId, phone);
  const cleanPhone = extractPhone(phone);
  const text       = body.trim().toLowerCase();
  const key        = sessionKey(businessId, phone);

  /* ── Comandos globais ── */
  if (/^(cancelar|sair|recomeçar|recomecar|cancel)$/.test(text)) {
    sessions.delete(key);
    return '❌ Pedido cancelado. Quando quiser, é só chamar! 😊';
  }
  if (/^(ajuda|help|\?)$/.test(text)) {
    return (
      '🆘 *Comandos:*\n\n' +
      '• *cancelar* — reiniciar\n' +
      '• *carrinho* — ver pedido atual\n' +
      '• *voltar* — passo anterior'
    );
  }

  const [products, deliveryFee, config] = await Promise.all([
    loadProducts(businessId),
    getDeliveryFee(),
    loadConfig(businessId),
  ]);

  const { businessName, crustOptions, sizeOptions, paymentMethods } = config;
  const sizeKeys = Object.keys(sizeOptions);

  if (/^(carrinho|ver carrinho)$/.test(text) && session.cart.length > 0) {
    return msgCartSummary(session.cart, deliveryFee, false, sizeOptions);
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
        if (last && last.length > 0) {
          const flavorDesc = last[0].product2Name
            ? `Meio ${last[0].product1Name} / Meio ${last[0].product2Name}`
            : last[0].product1Name;
          const sizeLabel = sizeOptions[last[0].size]?.label ?? last[0].size;
          session.state = 'REPEAT_OFFER';
          return (
            `Olá, *${found[0].name}*! 👋 Saudades de você! 🍕\n\n` +
            `🔄 *Repetir seu último pedido?*\n` +
            `_${sizeLabel} — ${flavorDesc}_\n\n` +
            '*1.* Sim, quero o mesmo!\n' +
            '*2.* Quero fazer um novo pedido'
          );
        }
        session.state = 'SELECT_CAT';
        return `Olá, *${found[0].name}*! 👋 Que bom ter você de volta!\n\n` + msgMenuWithCategories(products, sizeOptions);
      }
      session.state = 'AWAIT_NAME';
      return `Olá! 👋 Seja bem-vindo(a) à *${businessName}*!\n\nQual é o seu nome?`;
    }

    /* ── REPEAT_OFFER ──────────────────────────────────────────── */
    case 'REPEAT_OFFER': {
      if (text === '1') {
        const last = lastOrders.get(key)!;
        session.cart  = last.map(p => ({ ...p }));
        session.state = 'CART_REVIEW';
        return msgCartSummary(session.cart, deliveryFee, false, sizeOptions);
      }
      session.state = 'SELECT_CAT';
      return msgMenuWithCategories(products, sizeOptions);
    }

    /* ── AWAIT_NAME ────────────────────────────────────────────── */
    case 'AWAIT_NAME': {
      if (body.trim().length < 2) return '⚠️ Por favor, informe seu nome.';
      session.tempName = body.trim();
      session.state    = 'AWAIT_ADDRESS';
      return `Prazer, *${session.tempName}*! 😊\n\n*Qual é o seu endereço de entrega?*\n_(Rua, número e bairro)_`;
    }

    /* ── AWAIT_ADDRESS ─────────────────────────────────────────── */
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
        session.state        = 'SELECT_CAT';
        logger.info(`[Chatbot] Cliente CRIADO: id=${customer.id}, nome=${session.customerName}`);
        return `✅ *Cadastro realizado, ${session.customerName}!* Aqui está nosso cardápio:\n\n` + msgMenuWithCategories(products, sizeOptions);
      } catch (err: any) {
        logger.error(`[Chatbot Hardcoded] Erro ao criar cliente: ${err.message}`);
        return '❌ Erro ao salvar cadastro. Tente novamente.';
      }
    }

    /* ── SELECT_SIZE ───────────────────────────────────────────── */
    case 'SELECT_SIZE': {
      const b   = session.builder!;
      const idx = parseInt(text, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= sizeKeys.length) {
        return '⚠️ Escolha o tamanho:\n\n' + msgSizeMenu(sizeOptions);
      }
      const sizeKey = sizeKeys[idx];
      const sizeOpt = sizeOptions[sizeKey];
      b.size       = sizeKey;
      b.maxFlavors = sizeOpt.maxFlavors ?? 1;

      const confirmMsg = `📏 *${sizeOpt.label}* selecionado!\n\n`;

      if (b.maxFlavors > 1) {
        session.state = 'SELECT_SPLIT';
        return confirmMsg + '🔀 *Deseja adicionar um 2º sabor?*\n\n*1.* Sim\n*2.* Não';
      }
      if (crustOptions.length > 0) {
        session.state = 'SELECT_CRUST';
        return confirmMsg + msgCrustMenu(crustOptions);
      }
      session.state = 'AWAIT_NOTES';
      return confirmMsg + '📝 Alguma observação?\n\n_Digite ou *pular* para continuar._';
    }

    /* ── SELECT_SPLIT ──────────────────────────────────────────── */
    case 'SELECT_SPLIT': {
      const b = session.builder!;

      if (text === '1') {
        b.flavorStep = 2;
        session.state = 'SELECT_CAT';
        return msgCategoryMenu(products, 2);
      }
      if (text === '2') {
        if (crustOptions.length > 0) {
          session.state = 'SELECT_CRUST';
          return msgCrustMenu(crustOptions);
        }
        session.state = 'AWAIT_NOTES';
        return '📝 Alguma observação?\n\n_Digite ou *pular* para continuar._';
      }
      return '⚠️ Digite *1* para sim ou *2* para não.';
    }

    /* ── SELECT_CAT ────────────────────────────────────────────── */
    case 'SELECT_CAT': {
      if (!session.builder) {
        session.builder = { size: '', maxFlavors: 1, flavorStep: 1 };
      }
      const b    = session.builder!;
      const cats = getCategories(products);
      const idx  = parseInt(text, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= cats.length) {
        return '⚠️ Categoria inválida.\n\n' + msgCategoryMenu(products, b.flavorStep);
      }
      b.currentCategory = cats[idx];
      session.state     = 'SELECT_FLAVOR';
      return msgFlavorMenu(products, b.currentCategory, b.flavorStep);
    }

    /* ── SELECT_FLAVOR ─────────────────────────────────────────── */
    case 'SELECT_FLAVOR': {
      const b = session.builder!;

      if (text === 'voltar') {
        session.state = 'SELECT_CAT';
        return msgCategoryMenu(products, b.flavorStep);
      }

      const items = products.filter((p: any) => p.category === b.currentCategory);
      const idx   = parseInt(text, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= items.length) {
        return '⚠️ Opção inválida.\n\n' + msgFlavorMenu(products, b.currentCategory!, b.flavorStep);
      }

      const chosen = items[idx];
      const confirmMsg = `✅ *${chosen.name}* escolhido!\n\n`;

      if (b.flavorStep === 1) {
        b.product1 = chosen;
        if (sizeKeys.length > 1) {
          // Múltiplos tamanhos: perguntar ao cliente
          session.state = 'SELECT_SIZE';
          return confirmMsg + msgSizeMenu(sizeOptions);
        }
        // 0 ou 1 tamanho: auto-selecionar sem perguntar
        b.size       = sizeKeys[0] ?? '';
        b.maxFlavors = sizeKeys.length === 1 ? (sizeOptions[sizeKeys[0]].maxFlavors ?? 1) : 1;
        if (b.maxFlavors > 1) {
          session.state = 'SELECT_SPLIT';
          return confirmMsg + '🔀 *Deseja adicionar um 2º sabor?*\n\n*1.* Sim\n*2.* Não';
        }
      } else {
        // flavorStep === 2: segundo sabor
        b.product2 = chosen;
      }

      if (crustOptions.length > 0) {
        session.state = 'SELECT_CRUST';
        return confirmMsg + msgCrustMenu(crustOptions);
      }
      session.state = 'AWAIT_NOTES';
      return confirmMsg + '📝 Alguma observação?\n\n_Digite ou *pular* para continuar._';
    }

    /* ── SELECT_CRUST ──────────────────────────────────────────── */
    case 'SELECT_CRUST': {
      const b      = session.builder!;
      const noIdx  = crustOptions.length + 1;
      const choice = parseInt(text, 10);

      let crust: string | undefined;
      let crustPrice = 0;

      if (choice >= 1 && choice <= crustOptions.length) {
        crust      = crustOptions[choice - 1].label;
        crustPrice = crustOptions[choice - 1].price;
      } else if (choice === noIdx) {
        // sem borda
      } else {
        return '⚠️ Opção inválida.\n\n' + msgCrustMenu(crustOptions);
      }

      b.crust = crust;
      session.state = 'AWAIT_NOTES';
      return (
        (crust ? `✅ *${crust}* adicionado!\n\n` : '') +
        '📝 Alguma observação? (ex: sem cebola, bem passada...)\n\n' +
        '_Digite a observação ou *pular* para continuar._'
      );
    }

    /* ── AWAIT_NOTES ───────────────────────────────────────────── */
    case 'AWAIT_NOTES': {
      const b          = session.builder!;
      const pizzaNotes = /^(pular|nao|não|nada|ok|-)$/i.test(text) ? undefined : body.trim();

      const p1Price    = parseFloat(b.product1!.price);
      const p2Price    = b.product2 ? parseFloat(b.product2.price) : 0;
      const crustOpt   = b.crust ? crustOptions.find((c: CrustOption) => c.label === b.crust) : undefined;
      const crustPrice = crustOpt?.price ?? 0;
      const unitPrice  = calcPizzaPrice(b.size, sizeOptions, p1Price, p2Price, crustPrice);

      const pizza: CartPizza = {
        size:         b.size,
        product1Id:   b.product1!.id,
        product1Name: b.product1!.name,
        product2Id:   b.product2?.id,
        product2Name: b.product2?.name,
        crust:        b.crust,
        crustPrice,
        pizzaNotes,
        unitPrice,
      };

      session.cart.push(pizza);
      session.builder  = undefined;
      session.state    = 'CART_REVIEW';
      return msgCartSummary(session.cart, deliveryFee, false, sizeOptions);
    }

    /* ── CART_REVIEW ───────────────────────────────────────────── */
    case 'CART_REVIEW': {
      if (text === '1') {
        session.builder = undefined;
        session.state   = 'SELECT_CAT';
        return msgMenuWithCategories(products, sizeOptions);
      }
      if (text === '2') {
        session.state = 'AWAIT_DELIVERY_CHOICE';
        let msg = '📍 *Forma de entrega:*\n\n';
        if (session.savedAddress) {
          msg += `*1.* Entregar em: _${session.savedAddress}_\n`;
        }
        msg += `*${session.savedAddress ? '2' : '1'}.* Retirar no local (sem taxa)\n`;
        msg += `*${session.savedAddress ? '3' : '2'}.* Outro endereço`;
        return msg;
      }
      return '⚠️ Digite *1* para adicionar outro item ou *2* para finalizar.';
    }

    /* ── AWAIT_DELIVERY_CHOICE ─────────────────────────────────── */
    case 'AWAIT_DELIVERY_CHOICE': {
      const hasSaved  = !!session.savedAddress;
      const optPickup = hasSaved ? '2' : '1';
      const optOther  = hasSaved ? '3' : '2';

      if (text === '1' && hasSaved) {
        session.deliveryAddress = session.savedAddress;
      } else if (text === optPickup) {
        session.deliveryAddress = 'RETIRADA NO LOCAL';
      } else if (text === optOther) {
        session.state = 'AWAIT_CUSTOM_ADDRESS';
        return '📍 Digite seu endereço de entrega (rua, número e bairro):';
      } else {
        const opts = hasSaved ? '*1*, *2* ou *3*' : '*1* ou *2*';
        return `⚠️ Escolha ${opts}.`;
      }
      return goToPayment(session, deliveryFee, paymentMethods);
    }

    /* ── AWAIT_CUSTOM_ADDRESS ──────────────────────────────────── */
    case 'AWAIT_CUSTOM_ADDRESS': {
      if (body.trim().length < 5) return '⚠️ Por favor, informe o endereço completo (rua, número e bairro).';
      session.deliveryAddress = body.trim();
      return goToPayment(session, deliveryFee, paymentMethods);
    }

    /* ── AWAIT_PAYMENT ─────────────────────────────────────────── */
    case 'AWAIT_PAYMENT': {
      const idx = parseInt(text, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= paymentMethods.length) {
        return '⚠️ Escolha:\n' + msgPaymentMenu(paymentMethods);
      }

      const chosen = paymentMethods[idx];
      session.paymentMethod = chosen.key;

      if (chosen.key === 'CASH') {
        session.state = 'AWAIT_TROCO';
        return '💵 Precisa de troco? Se sim, para quanto? (ex: *50*)  Se não, digite *não*.';
      }

      session.state = 'CONFIRMING';
      return buildConfirmation(session, deliveryFee, sizeOptions, paymentMethods);
    }

    /* ── AWAIT_TROCO ───────────────────────────────────────────── */
    case 'AWAIT_TROCO': {
      if (!/^(n[ãa]o|nao|no|-)$/i.test(text)) {
        const val = parseFloat(text.replace(',', '.'));
        if (!isNaN(val) && val > 0) session.troco = val;
      }
      session.state = 'CONFIRMING';
      return buildConfirmation(session, deliveryFee, sizeOptions, paymentMethods);
    }

    /* ── CONFIRMING ────────────────────────────────────────────── */
    case 'CONFIRMING': {
      if (/^(sim|s|yes|confirmar|confirmo)$/.test(text)) {
        try {
          const isPickup     = session.deliveryAddress === 'RETIRADA NO LOCAL';
          const fee          = isPickup ? 0 : deliveryFee;
          const totalCrust   = session.cart.reduce((s, p) => s + p.crustPrice, 0);
          const totalFee     = fee + totalCrust;

          const items: CreateOrderItemDTO[] = session.cart.map(pizza => ({
            productId:     pizza.product1Id,
            quantity:      1,
            size:          pizza.size,
            halfProductId: pizza.product2Id,
          }));

          const noteParts: string[] = [];
          session.cart.forEach((pizza, i) => {
            if (pizza.pizzaNotes) noteParts.push(`Item ${i + 1} — obs: ${pizza.pizzaNotes}`);
            if (pizza.crust)      noteParts.push(`Item ${i + 1} — adicional: ${pizza.crust}`);
          });
          if (session.troco) noteParts.push(`Troco para: ${brl(session.troco)}`);
          const notes = noteParts.join(' | ') || 'Pedido via WhatsApp';

          const payLabel = paymentMethods.find(pm => pm.key === session.paymentMethod)?.label ?? session.paymentMethod;

          const order = await createOrder({
            customerId:      session.customerId!,
            items,
            paymentMethod:   payLabel,
            deliveryAddress: !isPickup ? session.deliveryAddress : undefined,
            deliveryFee:     totalFee,
            notes,
            channel:         'whatsapp',
          });

          logger.info(`[Chatbot] Pedido CRIADO: id=${order.id}, total=${order.total}`);
          broadcast('new-order', {
            id:           order.id,
            customerName: session.customerName,
            total:        order.total,
            itemCount:    session.cart.length,
            channel:      'whatsapp',
          });

          lastOrders.set(key, session.cart.map(p => ({ ...p })));
          sessions.delete(key);

          return (
            `✅ *Pedido #${order.id} confirmado!*\n\n` +
            `🍕 Já estamos preparando! Obrigado, *${session.customerName}*! 😊❤️`
          );
        } catch (err: any) {
          logger.error(`[Chatbot Hardcoded] Erro ao criar pedido: ${err.message ?? err}`);
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

function goToPayment(
  session: HSession,
  deliveryFee: number,
  paymentMethods: PaymentOption[],
): string {
  session.state     = 'AWAIT_PAYMENT';
  const isPickup    = session.deliveryAddress === 'RETIRADA NO LOCAL';
  const fee         = isPickup ? 0 : deliveryFee;
  const subtotal    = session.cart.reduce((s, p) => s + p.unitPrice, 0);
  const grandTotal  = subtotal + fee;

  return (
    `📍 ${isPickup ? 'Retirada no local' : session.deliveryAddress}\n` +
    (fee > 0 ? `🚚 Entrega: ${brl(fee)}\n` : '') +
    `💰 *Total: ${brl(grandTotal)}*\n\n` +
    msgPaymentMenu(paymentMethods)
  );
}

function buildConfirmation(
  session: HSession,
  deliveryFee: number,
  sizeOptions: Record<string, SizeOption>,
  paymentMethods: PaymentOption[],
): string {
  const isPickup   = session.deliveryAddress === 'RETIRADA NO LOCAL';
  const fee        = isPickup ? 0 : deliveryFee;
  const subtotal   = session.cart.reduce((s, p) => s + p.unitPrice, 0);
  const grandTotal = subtotal + fee;

  let msg = '📋 *CONFIRMAÇÃO DO PEDIDO*\n━━━━━━━━━━━━━━━━━━━━\n\n';
  session.cart.forEach((pizza, i) => {
    const flavorsConf = pizza.product2Name
      ? `Meio ${pizza.product1Name} / Meio ${pizza.product2Name}`
      : pizza.product1Name;
    const sizeLabel = sizeOptions[pizza.size]?.label ?? pizza.size;
    msg += `*${i + 1}.* ${sizeLabel} — ${flavorsConf}`;
    if (pizza.crust)      msg += ` | ${pizza.crust}`;
    if (pizza.pizzaNotes) msg += ` | _${pizza.pizzaNotes}_`;
    msg += `  ${brl(pizza.unitPrice)}\n`;
  });
  msg += '\n';
  if (fee > 0) msg += `🚚 Entrega: ${brl(fee)}\n`;
  msg += `💰 *TOTAL: ${brl(grandTotal)}*\n`;
  msg += `📍 ${isPickup ? 'Retirada no local' : session.deliveryAddress}\n`;
  const payLabel = paymentMethods.find(pm => pm.key === session.paymentMethod)?.label ?? session.paymentMethod;
  msg += `💳 ${payLabel}`;
  if (session.troco) msg += `\n💵 Troco para: ${brl(session.troco)}`;
  msg += '\n\nConfirmar? *sim* · *não*';
  return msg;
}
