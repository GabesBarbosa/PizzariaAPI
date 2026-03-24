/**
 * Chatbot hardcoded v2 — fluxo guiado: tamanho → sabor(es) → borda → entrega
 * Sem IA, sem gastar tokens.
 */

import * as customerRepo from '../repositories/customer.repository';
import * as productRepo from '../repositories/product.repository';
import { createOrder } from '../repositories/order.repository';
import { getDeliveryFee } from '../repositories/settings.repository';
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

type PizzaSize = 'normal' | 'brotinho';

interface CartPizza {
  size: PizzaSize;
  product1Id: string;
  product1Name: string;
  product2Id?: string;
  product2Name?: string;
  crust?: string;
  crustPrice: number;
  pizzaNotes?: string;
  unitPrice: number;       // preço calculado para exibição (inclui borda)
}

interface PizzaBuilder {
  size: PizzaSize;
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

const SIZE_LABELS: Record<PizzaSize, string> = {
  normal:   'Pizza Normal',
  brotinho: 'Brotinho',
};

const SIZE_MAX_FLAVORS: Record<PizzaSize, number> = {
  normal:   2,
  brotinho: 1,
};

const SIZE_MULTIPLIERS: Record<PizzaSize, number> = {
  normal:   1.00,
  brotinho: 0.65,
};

const CRUST_OPTIONS = [
  { label: 'Catupiry Original', price: 8.00 },
  { label: 'Cheddar',           price: 8.00 },
  { label: 'Chocolate',         price: 8.00 },
];

/* ─── Estado em memória ─────────────────────────────────────────── */

const sessions   = new Map<string, HSession>();
const lastOrders = new Map<string, CartPizza[]>(); // persiste entre sessões
let productsCache: any[] | null = null;
let cacheTime = 0;

/* ─── Helpers ───────────────────────────────────────────────────── */

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

function getCategories(products: any[]): string[] {
  return [...new Set(products.map((p: any) => p.category as string))].sort();
}

function calcPizzaPrice(size: PizzaSize, p1Price: number, p2Price = 0, crustPrice = 0): number {
  const base = Math.max(p1Price, p2Price);
  return Math.round((base * SIZE_MULTIPLIERS[size] + crustPrice) * 100) / 100;
}

/* ─── Mensagens ─────────────────────────────────────────────────── */

function msgSizeMenu(): string {
  return (
    '🍕 *Qual o tamanho?*\n\n' +
    '*1.* Normal — até 2 sabores\n' +
    '*2.* Brotinho (individual) — 1 sabor'
  );
}

function msgCategoryMenu(products: any[], step: number): string {
  const label = step === 1 ? '1º Sabor' : step === 2 ? '2º Sabor' : '3º Sabor';
  const cats  = getCategories(products);
  let msg = `🍕 *Categoria do ${label}:*\n\n`;
  cats.forEach((cat, i) => { msg += `*${i + 1}.* ${cat}\n`; });
  return msg;
}

function msgFlavorMenu(products: any[], category: string, step: number): string {
  const label = step === 1 ? '1º Sabor' : step === 2 ? '2º Sabor' : '3º Sabor';
  const items = products.filter((p: any) => p.category === category);
  let msg = `🍕 *${label} — ${category}:*\n\n`;
  items.forEach((p, i) => {
    msg += `*${i + 1}.* ${p.name}`;
    if (p.description) msg += ` — _${p.description}_`;
    msg += '\n';
  });
  msg += '\n_Digite o número ou *voltar* para trocar a categoria._';
  return msg;
}

function msgCrustMenu(): string {
  let msg = '🧀 *Deseja borda recheada?*\n\n';
  CRUST_OPTIONS.forEach((c, i) => { msg += `*${i + 1}.* ${c.label} — ${brl(c.price)}\n`; });
  msg += `*${CRUST_OPTIONS.length + 1}.* Sem borda`;
  return msg;
}

function msgCartSummary(cart: CartPizza[], deliveryFee: number, isPickup: boolean): string {
  let msg   = '📋 *SEU PEDIDO ATÉ AGORA*\n━━━━━━━━━━━━━━━━━━━━\n\n';
  let total = 0;
  cart.forEach((pizza, i) => {
    total += pizza.unitPrice;
    const flavors = pizza.product2Name
      ? `Meio ${pizza.product1Name} / Meio ${pizza.product2Name}`
      : pizza.product1Name;
    msg += `*${i + 1}.* ${SIZE_LABELS[pizza.size]}\n`;
    msg += `   🍕 ${flavors}\n`;
    if (pizza.crust)      msg += `   🧀 Borda: ${pizza.crust}\n`;
    if (pizza.pizzaNotes) msg += `   📝 ${pizza.pizzaNotes}\n`;
    msg += `   💰 ${brl(pizza.unitPrice)}\n\n`;
  });
  const fee = isPickup ? 0 : deliveryFee;
  if (fee > 0) msg += `🚚 Entrega: ${brl(fee)}\n`;
  msg += `*TOTAL: ${brl(total + fee)}*\n\n`;
  msg += '━━━━━━━━━━━━━━━━━━━━\n';
  msg += '*1.* Adicionar outra pizza\n';
  msg += '*2.* Finalizar pedido';
  return msg;
}

/* ─── Ponto de entrada ──────────────────────────────────────────── */

export async function handleHardcodedMessage(phone: string, body: string): Promise<string> {
  const session    = getSession(phone);
  const cleanPhone = extractPhone(phone);
  const text       = body.trim().toLowerCase();

  /* ── Comandos globais ── */
  if (/^(cancelar|sair|recomeçar|recomecar|cancel)$/.test(text)) {
    sessions.delete(phone);
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
  if (/^(carrinho|ver carrinho)$/.test(text) && session.cart.length > 0) {
    const [, deliveryFee] = await Promise.all([loadProducts(), getDeliveryFee()]);
    return msgCartSummary(session.cart, deliveryFee, false);
  }

  const [products, deliveryFee] = await Promise.all([loadProducts(), getDeliveryFee()]);

  switch (session.state) {

    /* ── INIT ──────────────────────────────────────────────────── */
    case 'INIT': {
      const found = await customerRepo.findCustomersByNameOrPhone(cleanPhone);
      if (found.length > 0) {
        session.customerId   = found[0].id;
        session.customerName = found[0].name;
        session.savedAddress = found[0].address || undefined;

        const last = lastOrders.get(cleanPhone);
        if (last && last.length > 0) {
          const flavorDesc = last[0].product2Name
            ? `Meio ${last[0].product1Name} / Meio ${last[0].product2Name}`
            : last[0].product1Name;
          session.state = 'REPEAT_OFFER';
          return (
            `Olá, *${found[0].name}*! 👋 Saudades de você! 🍕\n\n` +
            `🔄 *Repetir seu último pedido?*\n` +
            `_${SIZE_LABELS[last[0].size]} — ${flavorDesc}_\n\n` +
            '*1.* Sim, quero o mesmo!\n' +
            '*2.* Quero fazer um novo pedido'
          );
        }
        session.state = 'SELECT_SIZE';
        return `Olá, *${found[0].name}*! 👋 Que bom ter você de volta! 🍕\n\n` + msgSizeMenu();
      }
      session.state = 'AWAIT_NAME';
      return 'Olá! 👋 Seja bem-vindo(a) à *Pizzatec* 🍕\n\nQual é o seu nome?';
    }

    /* ── REPEAT_OFFER ──────────────────────────────────────────── */
    case 'REPEAT_OFFER': {
      if (text === '1') {
        const last = lastOrders.get(cleanPhone)!;
        session.cart  = last.map(p => ({ ...p }));
        session.state = 'CART_REVIEW';
        return msgCartSummary(session.cart, deliveryFee, false);
      }
      session.state = 'SELECT_SIZE';
      return msgSizeMenu();
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
        session.state        = 'SELECT_SIZE';
        logger.info(`[Chatbot] Cliente CRIADO: id=${customer.id}, nome=${session.customerName}`);
        return `✅ *Cadastro realizado, ${session.customerName}!* Vamos montar seu pedido:\n\n` + msgSizeMenu();
      } catch (err: any) {
        logger.error(`[Chatbot Hardcoded] Erro ao criar cliente: ${err.message}`);
        return '❌ Erro ao salvar cadastro. Tente novamente.';
      }
    }

    /* ── SELECT_SIZE ───────────────────────────────────────────── */
    case 'SELECT_SIZE': {
      const sizeMap: Record<string, PizzaSize> = {
        '1': 'normal', '2': 'brotinho',
      };
      const size = sizeMap[text];
      if (!size) return '⚠️ Escolha o tamanho:\n\n' + msgSizeMenu();

      session.builder = { size, maxFlavors: 1, flavorStep: 1 };

      if (size === 'brotinho') {
        // Brotinho: sempre 1 sabor, vai direto para categoria
        session.state = 'SELECT_CAT';
        return msgCategoryMenu(products, 1);
      }

      session.state = 'SELECT_SPLIT';
      return (
        `*Pizza Normal* selecionada! 👍\n\n` +
        `🍕 Como será?\n\n` +
        `*1.* Sabor único\n` +
        `*2.* Meio a meio (2 sabores)`
      );
    }

    /* ── SELECT_SPLIT ──────────────────────────────────────────── */
    case 'SELECT_SPLIT': {
      const b   = session.builder!;
      const max = SIZE_MAX_FLAVORS[b.size];

      if (text === '1') {
        b.maxFlavors = 1;
      } else if (text === '2') {
        b.maxFlavors = 2;
      } else {
        return '⚠️ Escolha *1* (sabor único) ou *2* (meio a meio).';
      }

      session.state = 'SELECT_CAT';
      return msgCategoryMenu(products, 1);
    }

    /* ── SELECT_CAT ────────────────────────────────────────────── */
    case 'SELECT_CAT': {
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

      if (b.flavorStep === 1) b.product1 = chosen;
      else                    b.product2 = chosen;

      const confirmMsg = `✅ *${chosen.name}* escolhido!\n\n`;

      // Próximo sabor?
      if (b.flavorStep < b.maxFlavors) {
        b.flavorStep = (b.flavorStep + 1) as 1 | 2;
        session.state = 'SELECT_CAT';
        return confirmMsg + msgCategoryMenu(products, b.flavorStep);
      }

      // Todos os sabores escolhidos → borda
      session.state = 'SELECT_CRUST';
      return confirmMsg + msgCrustMenu();
    }

    /* ── SELECT_CRUST ──────────────────────────────────────────── */
    case 'SELECT_CRUST': {
      const b      = session.builder!;
      const noIdx  = CRUST_OPTIONS.length + 1;
      const choice = parseInt(text, 10);

      let crust: string | undefined;
      let crustPrice = 0;

      if (choice >= 1 && choice <= CRUST_OPTIONS.length) {
        crust      = CRUST_OPTIONS[choice - 1].label;
        crustPrice = CRUST_OPTIONS[choice - 1].price;
      } else if (choice === noIdx) {
        // sem borda
      } else {
        return '⚠️ Opção inválida.\n\n' + msgCrustMenu();
      }

      b.crust = crust;
      session.state = 'AWAIT_NOTES';
      return (
        (crust ? `✅ *Borda ${crust}* adicionada!\n\n` : '') +
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
      const crustOpt   = b.crust ? CRUST_OPTIONS.find(c => c.label === b.crust) : undefined;
      const crustPrice = crustOpt?.price ?? 0;
      const unitPrice  = calcPizzaPrice(b.size, p1Price, p2Price, crustPrice);

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
      return msgCartSummary(session.cart, deliveryFee, false);
    }

    /* ── CART_REVIEW ───────────────────────────────────────────── */
    case 'CART_REVIEW': {
      if (text === '1') {
        // Adicionar mais uma pizza
        session.builder = undefined;
        session.state   = 'SELECT_SIZE';
        return msgSizeMenu();
      }
      if (text === '2') {
        // Finalizar
        session.state = 'AWAIT_DELIVERY_CHOICE';
        let msg = '📍 *Forma de entrega:*\n\n';
        if (session.savedAddress) {
          msg += `*1.* Entregar em: _${session.savedAddress}_\n`;
        }
        msg += `*${session.savedAddress ? '2' : '1'}.* Retirar no local (sem taxa)\n`;
        msg += `*${session.savedAddress ? '3' : '2'}.* Outro endereço`;
        return msg;
      }
      return '⚠️ Digite *1* para adicionar outra pizza ou *2* para finalizar.';
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
      return goToPayment(session, deliveryFee);
    }

    /* ── AWAIT_CUSTOM_ADDRESS ──────────────────────────────────── */
    case 'AWAIT_CUSTOM_ADDRESS': {
      if (body.trim().length < 5) return '⚠️ Por favor, informe o endereço completo (rua, número e bairro).';
      session.deliveryAddress = body.trim();
      return goToPayment(session, deliveryFee);
    }

    /* ── AWAIT_PAYMENT ─────────────────────────────────────────── */
    case 'AWAIT_PAYMENT': {
      const payMap: Record<string, string> = { '1': 'PIX', '2': 'CREDIT', '3': 'CASH' };
      const payment = payMap[text];
      if (!payment) return '⚠️ Escolha: *1* (PIX) · *2* (Cartão na entrega) · *3* (Dinheiro)';

      session.paymentMethod = payment;

      if (payment === 'CASH') {
        session.state = 'AWAIT_TROCO';
        return '💵 Precisa de troco? Se sim, para quanto? (ex: *50*)  Se não, digite *não*.';
      }

      session.state = 'CONFIRMING';
      return buildConfirmation(session, deliveryFee);
    }

    /* ── AWAIT_TROCO ───────────────────────────────────────────── */
    case 'AWAIT_TROCO': {
      if (!/^(n[ãa]o|nao|no|-)$/i.test(text)) {
        const val = parseFloat(text.replace(',', '.'));
        if (!isNaN(val) && val > 0) session.troco = val;
      }
      session.state = 'CONFIRMING';
      return buildConfirmation(session, deliveryFee);
    }

    /* ── CONFIRMING ────────────────────────────────────────────── */
    case 'CONFIRMING': {
      if (/^(sim|s|yes|confirmar|confirmo)$/.test(text)) {
        try {
          const isPickup     = session.deliveryAddress === 'RETIRADA NO LOCAL';
          const fee          = isPickup ? 0 : deliveryFee;
          const totalCrust   = session.cart.reduce((s, p) => s + p.crustPrice, 0);
          const totalFee     = fee + totalCrust; // borda somada à taxa

          const items: CreateOrderItemDTO[] = session.cart.map(pizza => ({
            productId:     pizza.product1Id,
            quantity:      1,
            size:          pizza.size,
            halfProductId: pizza.product2Id,
          }));

          const noteParts: string[] = [];
          session.cart.forEach((pizza, i) => {
            if (pizza.pizzaNotes) noteParts.push(`Pizza ${i + 1} — obs: ${pizza.pizzaNotes}`);
            if (pizza.crust)      noteParts.push(`Pizza ${i + 1} — borda: ${pizza.crust}`);
          });
          if (session.troco) noteParts.push(`Troco para: ${brl(session.troco)}`);
          const notes = noteParts.join(' | ') || 'Pedido via WhatsApp';

          const paymentLabels: Record<string, string> = {
            PIX: 'PIX', CREDIT: 'Cartão', CASH: 'Dinheiro'
          };

          const order = await createOrder({
            customerId:      session.customerId!,
            items,
            paymentMethod:   paymentLabels[session.paymentMethod!] || session.paymentMethod,
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

          // Salva para "repetir último pedido"
          lastOrders.set(cleanPhone, session.cart.map(p => ({ ...p })));
          sessions.delete(phone);

          return (
            `✅ *Pedido #${order.id} confirmado!*\n\n` +
            `🍕 Já estamos preparando! Obrigado, *${session.customerName}*! 😊❤️`
          );
        } catch (err: any) {
          logger.error(`[Chatbot Hardcoded] Erro ao criar pedido: ${err.message}`);
          return '❌ Erro ao registrar o pedido. Tente novamente ou ligue para nós.';
        }
      }
      if (/^(n[ãa]o|nao|no|cancelar)$/.test(text)) {
        sessions.delete(phone);
        return '❌ Pedido cancelado. Quando quiser, é só chamar! 😊';
      }
      return 'Digite *sim* para confirmar ou *não* para cancelar.';
    }

    default:
      sessions.delete(phone);
      return 'Olá! Para começar, é só mandar uma mensagem 😊';
  }
}

/* ─── Helpers internos ──────────────────────────────────────────── */

function goToPayment(session: HSession, deliveryFee: number): string {
  session.state     = 'AWAIT_PAYMENT';
  const isPickup    = session.deliveryAddress === 'RETIRADA NO LOCAL';
  const fee         = isPickup ? 0 : deliveryFee;
  const totalCrust  = session.cart.reduce((s, p) => s + p.crustPrice, 0);
  const subtotal    = session.cart.reduce((s, p) => s + p.unitPrice, 0);
  // unitPrice já inclui borda, então subtraímos para evitar dupla contagem no display
  const displayFee  = fee; // borda já está em unitPrice de cada pizza
  const grandTotal  = subtotal + displayFee;

  return (
    `📍 ${isPickup ? 'Retirada no local' : session.deliveryAddress}\n` +
    (fee > 0 ? `🚚 Entrega: ${brl(fee)}\n` : '') +
    `💰 *Total: ${brl(grandTotal)}*\n\n` +
    '💳 *Forma de pagamento:*\n*1.* PIX\n*2.* Cartão (levar maquininha)\n*3.* Dinheiro'
  );
}

const PAYMENT_LABELS: Record<string, string> = { PIX: 'PIX', CREDIT: 'Cartão na entrega', CASH: 'Dinheiro' };

function buildConfirmation(session: HSession, deliveryFee: number): string {
  const isPickup   = session.deliveryAddress === 'RETIRADA NO LOCAL';
  const fee        = isPickup ? 0 : deliveryFee;
  const subtotal   = session.cart.reduce((s, p) => s + p.unitPrice, 0);
  const grandTotal = subtotal + fee;

  let msg = '📋 *CONFIRMAÇÃO DO PEDIDO*\n━━━━━━━━━━━━━━━━━━━━\n\n';
  session.cart.forEach((pizza, i) => {
    const flavorsConf = pizza.product2Name
      ? `Meio ${pizza.product1Name} / Meio ${pizza.product2Name}`
      : pizza.product1Name;
    msg += `*${i + 1}.* ${SIZE_LABELS[pizza.size]} — ${flavorsConf}`;
    if (pizza.crust)      msg += ` | Borda ${pizza.crust}`;
    if (pizza.pizzaNotes) msg += ` | _${pizza.pizzaNotes}_`;
    msg += `  ${brl(pizza.unitPrice)}\n`;
  });
  msg += '\n';
  if (fee > 0) msg += `🚚 Entrega: ${brl(fee)}\n`;
  msg += `💰 *TOTAL: ${brl(grandTotal)}*\n`;
  msg += `📍 ${isPickup ? 'Retirada no local' : session.deliveryAddress}\n`;
  msg += `💳 ${PAYMENT_LABELS[session.paymentMethod!] || session.paymentMethod}`;
  if (session.troco) msg += `\n💵 Troco para: ${brl(session.troco)}`;
  msg += '\n\nConfirmar? *sim* · *não*';
  return msg;
}
