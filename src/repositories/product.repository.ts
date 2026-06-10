import { getPool } from '../database/mysqlClient';
import { getBusinessContext } from '../database/businessContext';
import { CreateProductDTO, UpdateProductDTO, CreateVariationDTO, UpdateVariationDTO } from '../dtos/product.dto';
import { v4 as uuidv4 } from 'uuid';

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
    'INSERT INTO Products (id, businessId, name, description, price, category, imageBase64) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, businessId, data.name, data.description || null, data.price, data.category || 'geral', data.imageBase64 ?? null]
  );
  const [rows] = await pool.query<any[]>('SELECT * FROM Products WHERE id = ?', [id]);
  return rows[0];
};

export const updateProduct = async (id: string, data: UpdateProductDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const hasImage = data.imageBase64 !== undefined;
  if (hasImage) {
    await pool.query(
      `UPDATE Products SET
         name        = COALESCE(?, name),
         description = ?,
         price       = COALESCE(?, price),
         category    = COALESCE(?, category),
         imageBase64 = ?
       WHERE id = ? AND businessId = ?`,
      [data.name || null, data.description ?? null, data.price || null,
       data.category || null, data.imageBase64 ?? null, id, businessId]
    );
  } else {
    await pool.query(
      `UPDATE Products SET
         name        = COALESCE(?, name),
         description = ?,
         price       = COALESCE(?, price),
         category    = COALESCE(?, category)
       WHERE id = ? AND businessId = ?`,
      [data.name || null, data.description ?? null, data.price || null,
       data.category || null, id, businessId]
    );
  }
  const [rows] = await pool.query<any[]>('SELECT * FROM Products WHERE id = ?', [id]);
  return rows[0];
};

export const deleteProduct = async (id: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  await pool.query('UPDATE OrderItems SET productId = NULL WHERE productId = ?', [id]);
  await pool.query('DELETE FROM Products WHERE id = ? AND businessId = ?', [id, businessId]);
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
