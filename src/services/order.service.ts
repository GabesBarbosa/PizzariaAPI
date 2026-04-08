import * as orderRepo from '../repositories/order.repository';
import * as customerRepo from '../repositories/customer.repository';
import { sendTextMessage } from './whatsapp.service';
import { getBusinessContext } from '../database/businessContext';
import { CreateOrderDTO } from '../dtos/order.dto';
import logger from '../utils/logger';
import { broadcast } from './notification.service';

export const createOrder = async (data: CreateOrderDTO) => {
  const customer = await customerRepo.findCustomerById(data.customerId);
  if (!customer) throw new Error('Cliente não encontrado');
  const order = await orderRepo.createOrder(data);

  try {
    broadcast('new-order', {
      id: order.id,
      customerName: customer.name,
      total: order.total,
      itemCount: order.items ? order.items.reduce((s: number, it: any) => s + it.quantity, 0) : 0,
      channel: data.channel || 'web',
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

  notifyCustomerStatusChange(orderId, status).catch((err) => {
    logger.warn(`[WhatsApp] Falha ao notificar pedido ${orderId}: ${err.message}`);
  });

  return updated;
};

async function notifyCustomerStatusChange(orderId: number, status: string): Promise<void> {
  const statusMessages: Record<string, string> = {
    PREPARING: '👨‍🍳 Seu pedido está sendo *preparado*! Em breve estará pronto.',
    OUT_FOR_DELIVERY: '🛵 Seu pedido *saiu para entrega*! Fique atento!',
    DELIVERED: '✅ Seu pedido foi *entregue*! Obrigado pela preferência!',
  };

  const msg = statusMessages[status];
  if (!msg) return;

  const order = await orderRepo.findOrderById(orderId);
  if (!order?.customerId) {
    logger.warn(`[WhatsApp] Pedido #${orderId} sem customerId — sem notificação.`);
    return;
  }

  const customer = await customerRepo.findCustomerById(order.customerId);
  if (!customer?.phone) return;

  let text = `🍽️ *Pedido #${orderId}*\n\n${msg}`;

  if (status === 'DELIVERED') {
    text += '\n\n' + buildReceiptText(order, customer.name);
  }

  const ctx = getBusinessContext();
  if (!ctx) return;
  await sendTextMessage(ctx.businessId, customer.phone, text);
  logger.info(`[WhatsApp] Notificação enviada: pedido #${orderId} → ${customer.phone}`);
}

function formatBrl(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function buildReceiptText(order: any, customerName: string): string {
  const lines: string[] = [];
  lines.push('─────────────────');
  lines.push('📋 *NOTA DO PEDIDO*');
  lines.push('─────────────────');
  lines.push('');

  const date = order.createdAt ? new Date(order.createdAt).toLocaleString('pt-BR') : '';
  if (date) lines.push(`📅 ${date}`);
  lines.push(`👤 ${customerName}`);
  if (order.deliveryAddress) lines.push(`📍 ${order.deliveryAddress}`);
  if (order.paymentMethod) {
    const paymentLabels: Record<string, string> = {
      CASH: 'Dinheiro', CREDIT: 'Crédito', DEBIT: 'Débito', PIX: 'PIX'
    };
    lines.push(`💳 ${paymentLabels[order.paymentMethod] || order.paymentMethod}`);
  }
  if (order.notes) lines.push(`📝 ${order.notes}`);

  lines.push('');
  lines.push('─────────────────');

  if (order.items?.length) {
    for (const item of order.items) {
      const name = item.productName || 'Produto';
      const qty = item.quantity;
      const price = parseFloat(item.finalPrice) || 0;
      lines.push(`${qty}x ${name}  ${formatBrl(qty * price)}`);
      if (item.variations?.length) {
        for (const v of item.variations) {
          lines.push(`   + ${v.variationName}`);
        }
      }
    }
  }

  if (order.deliveryFee && parseFloat(order.deliveryFee) > 0) {
    lines.push(`🚚 Taxa de entrega  ${formatBrl(parseFloat(order.deliveryFee))}`);
  }

  lines.push('─────────────────');
  lines.push(`*TOTAL: ${formatBrl(parseFloat(order.total))}*`);
  lines.push('─────────────────');
  lines.push('');
  lines.push('Obrigado pela preferência! ❤️');

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
