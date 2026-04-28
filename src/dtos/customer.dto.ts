export interface CustomerAddressDTO {
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  uf?: string;
  latitude?: number;
  longitude?: number;
}

export interface CreateCustomerDTO extends CustomerAddressDTO {
  name: string;
  phone: string;
  address?: string;
}

export interface UpdateCustomerDTO extends CustomerAddressDTO {
  name?: string;
  phone?: string;
  address?: string;
}
