export interface CreateProductDTO {
  name: string;
  description?: string;
  price: number;
  category?: string;
  imageBase64?: string | null;
  /** null = sem controle de estoque; 0 = esgotado. */
  stockQuantity?: number | null;
}

export interface UpdateProductDTO {
  name?: string;
  description?: string;
  price?: number;
  category?: string;
  imageBase64?: string | null;
  stockQuantity?: number | null;
}

/** Ajuste de estoque: define um valor absoluto ou soma/subtrai um delta. */
export interface StockAdjustmentDTO {
  stockQuantity?: number | null;
  delta?: number;
}

export interface CreateVariationDTO {
  name: string;
  type: 'size' | 'addon' | 'removal' | 'custom';
  priceModifier: number;
}

export interface UpdateVariationDTO {
  name?: string;
  type?: 'size' | 'addon' | 'removal' | 'custom';
  priceModifier?: number;
}
