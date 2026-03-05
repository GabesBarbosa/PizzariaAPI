import prisma from '../database/prismaClient';
import { CreateCustomerDTO, UpdateCustomerDTO } from '../dtos/customer.dto';

export const createCustomer = async (data: CreateCustomerDTO) => {
  return prisma.customer.create({ data });
};

export const findCustomerById = async (id: string) => {
  return prisma.customer.findUnique({ where: { id } });
};

export const findCustomersByNameOrPhone = async (term: string) => {
  return prisma.customer.findMany({
    where: {
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } }
      ]
    }
  });
};

export const updateCustomer = async (id: string, data: UpdateCustomerDTO) => {
  return prisma.customer.update({ where: { id }, data });
};
