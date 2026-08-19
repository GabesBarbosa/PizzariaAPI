/** Erro de regra de negócio — vira HTTP 4xx no errorHandler. */
export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Produto sem estoque suficiente para atender o pedido. */
export class OutOfStockError extends HttpError {
  productId: string;
  available: number;
  constructor(productName: string, productId: string, available: number) {
    super(
      available > 0
        ? `Estoque insuficiente para "${productName}": restam apenas ${available} unidade(s).`
        : `"${productName}" está esgotado no momento.`,
      409
    );
    this.name = 'OutOfStockError';
    this.productId = productId;
    this.available = available;
  }
}
