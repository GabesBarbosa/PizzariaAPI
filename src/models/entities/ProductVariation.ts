export interface ProductVariation {
  id: string;
  productId: string;
  businessId: string;
  name: string;
  type: 'size' | 'addon' | 'removal' | 'custom';
  priceModifier: number;
  createdAt?: Date;
}
