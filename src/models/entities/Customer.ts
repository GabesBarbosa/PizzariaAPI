export interface Customer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  uf?: string;
  latitude?: number;
  longitude?: number;
  createdAt?: Date;
}
