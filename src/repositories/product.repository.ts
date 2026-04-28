import { getPool, sql } from '../database/mssqlClient';
import { getBusinessContext } from '../database/businessContext';
import { CreateProductDTO, UpdateProductDTO, CreateVariationDTO, UpdateVariationDTO } from '../dtos/product.dto';
import { v4 as uuidv4 } from 'uuid';

export const getAllProducts = async () => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const req = pool.request();
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const res = await req.query(
    'SELECT * FROM Products WHERE businessId = @businessId ORDER BY createdAt DESC'
  );
  return res.recordset;
};

export const getProductById = async (id: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, id);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const res = await req.query(
    'SELECT * FROM Products WHERE id = @id AND businessId = @businessId'
  );
  return res.recordset[0];
};

export const createProduct = async (data: CreateProductDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const id = uuidv4();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, id);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  req.input('name', sql.NVarChar(200), data.name);
  req.input('description', sql.NVarChar(1000), data.description || null);
  req.input('price', sql.Decimal(10, 2), data.price);
  req.input('category', sql.NVarChar(50), data.category || 'geral');
  req.input('imageBase64', sql.NVarChar(sql.MAX), data.imageBase64 ?? null);
  const res = await req.query(
    `INSERT INTO Products (id, businessId, name, description, price, category, imageBase64)
     OUTPUT inserted.*
     VALUES (@id, @businessId, @name, @description, @price, @category, @imageBase64)`
  );
  return res.recordset[0];
};

export const updateProduct = async (id: string, data: UpdateProductDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, id);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  req.input('name', sql.NVarChar(200), data.name || null);
  req.input('description', sql.NVarChar(1000), data.description ?? null);
  req.input('price', sql.Decimal(10, 2), data.price || null);
  req.input('category', sql.NVarChar(50), data.category || null);
  req.input('imageBase64', sql.NVarChar(sql.MAX), data.imageBase64 !== undefined ? (data.imageBase64 ?? null) : undefined as any);
  const hasImage = data.imageBase64 !== undefined;
  const res = await req.query(
    `UPDATE Products SET
       name = COALESCE(@name, name),
       description = @description,
       price = COALESCE(@price, price),
       category = COALESCE(@category, category)
       ${hasImage ? ', imageBase64 = @imageBase64' : ''}
     OUTPUT inserted.*
     WHERE id = @id AND businessId = @businessId`
  );
  return res.recordset[0];
};

export const deleteProduct = async (id: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, id);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  await req.query('DELETE FROM Products WHERE id = @id AND businessId = @businessId');
};

// ---- Variations ----

export const getVariationsByProduct = async (productId: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const req = pool.request();
  req.input('productId', sql.UniqueIdentifier, productId);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const res = await req.query(
    `SELECT * FROM ProductVariations
     WHERE productId = @productId AND businessId = @businessId
     ORDER BY createdAt ASC`
  );
  return res.recordset;
};

export const createVariation = async (productId: string, data: CreateVariationDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const id = uuidv4();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, id);
  req.input('productId', sql.UniqueIdentifier, productId);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  req.input('name', sql.NVarChar(100), data.name);
  req.input('type', sql.NVarChar(50), data.type);
  req.input('priceModifier', sql.Decimal(10, 2), data.priceModifier);
  const res = await req.query(
    `INSERT INTO ProductVariations (id, productId, businessId, name, type, priceModifier)
     OUTPUT inserted.*
     VALUES (@id, @productId, @businessId, @name, @type, @priceModifier)`
  );
  return res.recordset[0];
};

export const updateVariation = async (variationId: string, data: UpdateVariationDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, variationId);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  req.input('name', sql.NVarChar(100), data.name || null);
  req.input('type', sql.NVarChar(50), data.type || null);
  req.input('priceModifier', sql.Decimal(10, 2), data.priceModifier ?? null);
  const res = await req.query(
    `UPDATE ProductVariations SET
       name = COALESCE(@name, name),
       type = COALESCE(@type, type),
       priceModifier = COALESCE(@priceModifier, priceModifier)
     OUTPUT inserted.*
     WHERE id = @id AND businessId = @businessId`
  );
  return res.recordset[0];
};

export const deleteVariation = async (variationId: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, variationId);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  await req.query(
    'DELETE FROM ProductVariations WHERE id = @id AND businessId = @businessId'
  );
};
