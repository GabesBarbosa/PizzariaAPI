export interface CreateOrderItemDTO {
  productId: string;
  quantity: number;
  size?: 'normal' | 'brotinho' | 'media' | 'grande' | 'gigante';
  halfProductId?: string;
}

export interface CreateOrderDTO {
  customerId: string;
  items: CreateOrderItemDTO[];
  paymentMethod?: string;
  deliveryAddress?: string;
  notes?: string;
  deliveryFee?: number;
  channel?: string;
}
