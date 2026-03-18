
export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: number;
  customerId: string;
  items: OrderItem[];
  total: number;
  status: string;
  createdAt?: Date;
}
