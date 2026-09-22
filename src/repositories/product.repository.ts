import mysql from 'mysql2/promise';
import { getPool } from '../database/mysqlClient';
import { getBusinessContext } from '../database/businessContext';
import { CreateProductDTO, UpdateProductDTO, CreateVariationDTO, UpdateVariationDTO } from '../dtos/product.dto';
import { v4 as uuidv4 } from 'uuid';
import { OutOfStockError } from '../utils/errors';

export const getAllProducts = async () => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    'SELECT * FROM Products WHERE businessId = ? ORDER BY createdAt DESC',
    [businessId]
  );
  return rows;
};

export const getProductById = async (id: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    'SELECT * FROM Products WHERE id = ? AND businessId = ?',
    [id, businessId]
  );
  return rows[0];
};

export const createProduct = async (data: CreateProductDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const id = uuidv4();
  await pool.query(
    'INSERT INTO Products (id, businessId, name, description, price, category, imageBase64, stockQuantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, businessId, data.name, data.description || null, data.price, data.category || 'geral',
     data.imageBase64 ?? null, data.stockQuantity ?? null]
  );
  const [rows] = await pool.query<any[]>('SELECT * FROM Products WHERE id = ?', [id]);
  return rows[0];
};

export const updateProduct = async (id: string, data: UpdateProductDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const sets: string[] = [
    'name        = COALESCE(?, name)',
    'description = ?',
    'price       = COALESCE(?, price)',
    'category    = COALESCE(?, category)',
  ];
  const params: any[] = [data.name || null, data.description ?? null, data.price || null, data.category || null];

  // Campos anuláveis: só entram no UPDATE quando a chave veio no payload.
  if (data.imageBase64 !== undefined) {
    sets.push('imageBase64 = ?');
    params.push(data.imageBase64 ?? null);
  }
  if (data.stockQuantity !== undefined) {
    sets.push('stockQuantity = ?');
    params.push(normalizeStock(data.stockQuantity));
  }

  await pool.query(
    `UPDATE Products SET ${sets.join(', ')} WHERE id = ? AND businessId = ?`,
    [...params, id, businessId]
  );
  const [rows] = await pool.query<any[]>('SELECT * FROM Products WHERE id = ?', [id]);
  return rows[0];
};

export const deleteProduct = async (id: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  await pool.query('UPDATE OrderItems SET productId = NULL WHERE productId = ?', [id]);
  await pool.query('DELETE FROM Products WHERE id = ? AND businessId = ?', [id, businessId]);
};

// ---- Stock ----
//
// Regra: stockQuantity NULL significa "sem controle de estoque" — o produto nunca
// esgota. Qualquer valor numérico é controlado e nunca fica negativo.

/** Normaliza a quantidade recebida do cliente: null/'' = sem controle, resto = inteiro >= 0. */
function normalizeStock(value: number | null | undefined): number | null {
  if (value === null || value === undefined || (value as any) === '') return null;
  const n = Math.floor(Number(value));
  if (Number.isNaN(n)) return null;
  return Math.max(0, n);
}

/** Define a quantidade absoluta em estoque (null desliga o controle para o produto). */
export const setStock = async (id: string, stockQuantity: number | null) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  await pool.query(
    'UPDATE Products SET stockQuantity = ? WHERE id = ? AND businessId = ?',
    [normalizeStock(stockQuantity), id, businessId]
  );
  const [rows] = await pool.query<any[]>('SELECT * FROM Products WHERE id = ?', [id]);
  return rows[0];
};

/** Soma um delta ao estoque (entrada de mercadoria, correção). Sem efeito se não controlado. */
export const adjustStock = async (id: string, delta: number) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  await pool.query(
    `UPDATE Products SET stockQuantity = GREATEST(0, stockQuantity + ?)
     WHERE id = ? AND businessId = ? AND stockQuantity IS NOT NULL`,
    [Math.floor(delta), id, businessId]
  );
  const [rows] = await pool.query<any[]>('SELECT * FROM Products WHERE id = ?', [id]);
  return rows[0];
};

/**
 * Dá baixa no estoque dentro da transação do pedido.
 * O UPDATE condicional garante atomicidade: dois pedidos simultâneos não furam o estoque.
 * Lança OutOfStockError quando o produto é controlado e não há saldo.
 */
export const decrementStock = async (
  conn: mysql.PoolConnection,
  productId: string,
  quantity: number
): Promise<void> => {
  const [res] = await conn.query(
    `UPDATE Products SET stockQuantity = stockQuantity - ?
     WHERE id = ? AND stockQuantity IS NOT NULL AND stockQuantity >= ?`,
    [quantity, productId, quantity]
  );

  if ((res as any).affectedRows > 0) return;

  // Nada atualizado: ou o produto não controla estoque (ok), ou o saldo é insuficiente.
  const [rows] = await conn.query<any[]>(
    'SELECT name, stockQuantity FROM Products WHERE id = ?', [productId]
  );
  const product = rows[0];
  if (product && product.stockQuantity !== null) {
    throw new OutOfStockError(product.name, productId, Number(product.stockQuantity));
  }
};

/** Devolve unidades ao estoque (cancelamento, exclusão ou edição de pedido). */
export const incrementStock = async (
  conn: mysql.PoolConnection,
  productId: string,
  quantity: number
): Promise<void> => {
  await conn.query(
    `UPDATE Products SET stockQuantity = stockQuantity + ?
     WHERE id = ? AND stockQuantity IS NOT NULL`,
    [quantity, productId]
  );
};

/** Produtos controlados que chegaram ao fim (0) ou estão abaixo do limite informado. */
export const getLowStockProducts = async (threshold: number) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT * FROM Products
     WHERE businessId = ? AND stockQuantity IS NOT NULL AND stockQuantity <= ?
     ORDER BY stockQuantity ASC, name ASC`,
    [businessId, threshold]
  );
  return rows;
};

// ---- Variations ----

export const getVariationsByProduct = async (productId: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    'SELECT * FROM ProductVariations WHERE productId = ? AND businessId = ? ORDER BY createdAt ASC',
    [productId, businessId]
  );
  return rows;
};

/** Todas as variações do negócio, pra anexar aos produtos do cardápio numa única query. */
export const getAllVariationsForBusiness = async () => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    'SELECT * FROM ProductVariations WHERE businessId = ? ORDER BY createdAt ASC',
    [businessId]
  );
  return rows;
};

export const createVariation = async (productId: string, data: CreateVariationDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const id = uuidv4();
  await pool.query(
    'INSERT INTO ProductVariations (id, productId, businessId, name, type, priceModifier) VALUES (?, ?, ?, ?, ?, ?)',
    [id, productId, businessId, data.name, data.type, data.priceModifier]
  );
  const [rows] = await pool.query<any[]>('SELECT * FROM ProductVariations WHERE id = ?', [id]);
  return rows[0];
};

export const updateVariation = async (variationId: string, data: UpdateVariationDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  await pool.query(
    `UPDATE ProductVariations SET
       name          = COALESCE(?, name),
       type          = COALESCE(?, type),
       priceModifier = COALESCE(?, priceModifier)
     WHERE id = ? AND businessId = ?`,
    [data.name || null, data.type || null, data.priceModifier ?? null, variationId, businessId]
  );
  const [rows] = await pool.query<any[]>('SELECT * FROM ProductVariations WHERE id = ?', [variationId]);
  return rows[0];
};

export const deleteVariation = async (variationId: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  await pool.query(
    'DELETE FROM ProductVariations WHERE id = ? AND businessId = ?',
    [variationId, businessId]
  );
};
