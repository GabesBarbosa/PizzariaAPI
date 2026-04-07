export interface OrderItemVariationDTO {
  variationId: string;
}

export interface CreateOrderItemDTO {
  productId: string;
  quantity: number;
  variations?: OrderItemVariationDTO[];
}

export interface CreateOrderDTO {
  customerId: string;
  items: CreateOrderItemDTO[];
  paymentMethod?: string;
  deliveryAddress?: string;
  notes?: string;
  deliveryFee?: number;
}
