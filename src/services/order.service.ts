import * as orderRepo from '../repositories/order.repository';
import * as customerRepo from '../repositories/customer.repository';
import { sendTextMessage } from './whatsapp.service';
import { CreateOrderDTO } from '../dtos/order.dto';
import logger from '../utils/logger';
import { broadcast } from './notification.service';

export const createOrder = async (data: CreateOrderDTO) => {
  // ensure customer exists
  const customer = await customerRepo.findCustomerById(data.customerId);
  if (!customer) throw new Error('Cliente não encontrado');
  const order = await orderRepo.createOrder(data);

  // Broadcast new-order to SSE clients so UI updates in real-time
  try {
    broadcast('new-order', {
      id: order.id,
      customerName: customer.name,
      total: order.total,
      itemCount: order.items ? order.items.reduce((s: number, it: any) => s + it.quantity, 0) : 0,
    });
  } catch (err) {
    logger.warn('[Notification] failed to broadcast new-order: ' + (err as Error).message);
  }

  return order;
};

export const getAllOrders = async () => {
  return orderRepo.findAllOrders();
};

export const getOrdersForCustomer = async (customerId: string) => {
  return orderRepo.findOrdersByCustomer(customerId);
};

export const setOrderStatus = async (orderId: number, status: string) => {
  const updated = await orderRepo.updateOrderStatus(orderId, status);
  if (!updated) return updated;

  // Send WhatsApp notification (fire-and-forget)
  notifyCustomerStatusChange(orderId, status).catch((err) => {
    logger.warn(`[WhatsApp] Falha ao notificar pedido ${orderId}: ${err.message}`);
  });

  return updated;
};

async function notifyCustomerStatusChange(orderId: number, status: string): Promise<void> {
  const statusMessages: Record<string, string> = {
    PREPARING: '👨‍🍳 Seu pedido está sendo *preparado*! Em breve estará pronto.',
    OUT_FOR_DELIVERY: '🛵 Seu pedido *saiu para entrega*! Fique atento!',
    DELIVERED: '✅ Seu pedido foi *entregue*! Obrigado pela preferência! 🍕',
  };

  const msg = statusMessages[status];
  if (!msg) {
    logger.info(`[WhatsApp] Status "${status}" não tem mensagem configurada — sem notificação.`);
    return;
  }

  const order = await orderRepo.findOrderById(orderId);
  if (!order?.customerId) {
    logger.warn(`[WhatsApp] Pedido #${orderId} sem customerId — sem notificação.`);
    return;
  }

  const customer = await customerRepo.findCustomerById(order.customerId);
  if (!customer?.phone) {
    logger.warn(`[WhatsApp] Cliente do pedido #${orderId} sem telefone cadastrado — sem notificação.`);
    return;
  }

  logger.info(`[WhatsApp] Notificando pedido #${orderId} status="${status}" → ${customer.phone}`);

  const orderShortId = String(orderId);
  let text = `🍕 *Pizzatec*\n\nPedido *#${orderShortId}*\n\n${msg}`;

  // For DELIVERED, append the receipt with loyalty card
  if (status === 'DELIVERED') {
    const customerOrders = await orderRepo.findOrdersByCustomer(order.customerId);
    const orderCount = customerOrders.length;
    text += '\n\n' + buildReceiptText(order, customer.name, orderCount);
  }

  await sendTextMessage(customer.phone, text);
  logger.info(`[WhatsApp] Notificação enviada: pedido #${orderId} → ${customer.phone}`);
}

function formatBrl(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function buildReceiptText(order: any, customerName: string, orderCount: number): string {
  const lines: string[] = [];
  lines.push('─────────────────');
  lines.push('📋 *NOTA DO PEDIDO*');
  lines.push('─────────────────');
  lines.push('');

  const date = order.createdAt ? new Date(order.createdAt).toLocaleString('pt-BR') : '';
  if (date) lines.push(`📅 ${date}`);
  lines.push(`👤 ${customerName}`);

  if (order.deliveryAddress) {
    lines.push(`📍 ${order.deliveryAddress}`);
  }
  if (order.paymentMethod) {
    const paymentLabels: Record<string, string> = {
      CASH: 'Dinheiro', CREDIT: 'Crédito', DEBIT: 'Débito', PIX: 'PIX'
    };
    lines.push(`💳 ${paymentLabels[order.paymentMethod] || order.paymentMethod}`);
  }
  if (order.notes) {
    lines.push(`📝 ${order.notes}`);
  }

  lines.push('');
  lines.push('─────────────────');

  // Items
  if (order.items?.length) {
    for (const item of order.items) {
      const name = item.productName || 'Produto';
      const qty = item.quantity;
      const price = parseFloat(item.price) || 0;
      const lineTotal = qty * price;
      lines.push(`${qty}x ${name}  ${formatBrl(lineTotal)}`);
    }
  }

  if (order.deliveryFee && parseFloat(order.deliveryFee) > 0) {
    lines.push(`🚚 Taxa de entrega  ${formatBrl(parseFloat(order.deliveryFee))}`);
  }

  lines.push('─────────────────');
  lines.push(`*TOTAL: ${formatBrl(parseFloat(order.total))}*`);
  lines.push('─────────────────');
  lines.push('');

  // Loyalty card
  const stampsCount = orderCount % 10;
  const isFull = stampsCount === 0 && orderCount > 0;
  const filled = isFull ? 10 : stampsCount;

  lines.push('🏆 *Cartão Fidelidade*');
  let stamps = '';
  for (let i = 0; i < 10; i++) {
    stamps += i < filled ? '🍕' : '⚪';
  }
  lines.push(stamps);

  if (isFull) {
    lines.push('🎉 *PARABÉNS! GANHOU 1 PIZZA GRÁTIS!* 🎉');
  } else {
    lines.push(`${filled}/10 pedidos — Faltam ${10 - filled}!`);
  }

  lines.push('');
  lines.push('Obrigado pela preferência! 🍕❤️');

  return lines.join('\n');
}

export const getOrderById = async (orderId: number) => {
  return orderRepo.findOrderById(orderId);
};

export const deleteOrder = async (orderId: number) => {
  return orderRepo.deleteOrder(orderId);
};

export const updateOrder = async (orderId: number, data: CreateOrderDTO) => {
  return orderRepo.updateOrder(orderId, data);
};
