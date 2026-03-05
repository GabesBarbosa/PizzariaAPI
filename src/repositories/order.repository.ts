import prisma from '../database/prismaClient';
import { CreateOrderDTO, CreateOrderItemDTO } from '../dtos/order.dto';

export const createOrder = async (data: CreateOrderDTO) => {
  // calculate total and create nested items
  const itemsForCreate = await Promise.all(
    data.items.map(async (it) => {
      const product = await prisma.product.findUnique({ where: { id: it.productId } });
      if (!product) throw new Error('Produto não encontrado: ' + it.productId);
      return {
        product: { connect: { id: it.productId } },
        quantity: it.quantity,
        price: product.price
      };
    })
  );

  const total = itemsForCreate.reduce((sum, it) => sum + it.price * it.quantity, 0);

  return prisma.order.create({
    data: {
      customer: { connect: { id: data.customerId } },
      total,
      items: { create: itemsForCreate }
    },
    include: { items: true }
  });
};

export const findOrdersByCustomer = async (customerId: string) => {
  return prisma.order.findMany({ where: { customerId }, include: { items: true } });
};

export const updateOrderStatus = async (orderId: string, status: string) => {
  return prisma.order.update({ where: { id: orderId }, data: { status } });
};
