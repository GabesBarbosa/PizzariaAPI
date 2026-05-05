export interface OrderItemVariationDTO {
  variationId: string;
}

export interface CreateOrderItemDTO {
  productId: string;
  quantity: number;
  size?: string;
  halfProductId?: string;
  variations?: OrderItemVariationDTO[];
}

export interface CreateOrderDTO {
  customerId: string | null;
  items: CreateOrderItemDTO[];
  paymentMethod?: string;
  deliveryAddress?: string;
  notes?: string;
  deliveryFee?: number;
  channel?: string;
  tableNumber?: number;
}
