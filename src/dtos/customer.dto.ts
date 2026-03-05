export interface CreateCustomerDTO {
  name: string;
  phone: string;
  address?: string;
}

export interface UpdateCustomerDTO {
  name?: string;
  phone?: string;
  address?: string;
}
