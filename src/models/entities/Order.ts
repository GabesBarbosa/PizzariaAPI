import { OrderItemVariation } from './OrderItemVariation';

export interface OrderItem {
  id: string;
  orderId: number;
  productId: string;
  quantity: number;
  unitPrice: number;
  finalPrice: number;
  variations?: OrderItemVariation[];
}

export interface Order {
  id: number;
  businessId: string;
  customerId: string;
  items: OrderItem[];
  total: number;
  status: string;
  paymentMethod?: string;
  deliveryAddress?: string;
  notes?: string;
  deliveryFee: number;
  channel: string;
  createdAt?: Date;
  deliveredAt?: Date;
}
