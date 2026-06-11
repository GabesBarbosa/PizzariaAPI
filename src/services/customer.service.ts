import * as customerRepo from '../repositories/customer.repository';
import { CreateCustomerDTO, UpdateCustomerDTO } from '../dtos/customer.dto';

export const createCustomer = async (data: CreateCustomerDTO) => {
  if (data.phone) {
    return customerRepo.upsertCustomerByPhone(data);
  }
  return customerRepo.createCustomer(data);
};

export const searchCustomers = async (term: string) => {
  return customerRepo.findCustomersByNameOrPhone(term);
};

export const getCustomerById = async (id: string) => {
  return customerRepo.findCustomerById(id);
};

export const updateCustomer = async (id: string, data: UpdateCustomerDTO) => {
  return customerRepo.updateCustomer(id, data);
};

export const deleteCustomer = async (id: string) => {
  return customerRepo.deleteCustomer(id);
};
