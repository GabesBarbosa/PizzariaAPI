import { getPool, sql } from '../database/mssqlClient';
import { CreateProductDTO, UpdateProductDTO } from '../dtos/product.dto';
import { v4 as uuidv4 } from 'uuid';

export const getAllProducts = async () => {
  const pool = await getPool();
  const req = pool.request();
  const res = await req.query('SELECT * FROM Products ORDER BY createdAt DESC');
  return res.recordset;
};

export const getProductById = async (id: string) => {
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, id);
  const res = await req.query('SELECT * FROM Products WHERE id = @id');
  return res.recordset[0];
};

export const createProduct = async (data: CreateProductDTO) => {
  const pool = await getPool();
  const id = uuidv4();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, id);
  req.input('name', sql.NVarChar(200), data.name);
  req.input('description', sql.NVarChar(1000), data.description || null);
  req.input('price', sql.Decimal(10,2), data.price);
  req.input('category', sql.NVarChar(50), data.category || 'outro');
  await req.query(
    `INSERT INTO Products (id, name, description, price, category) VALUES (@id, @name, @description, @price, @category)`
  );
  return { id, ...data, category: data.category || 'outro' };
};

export const updateProduct = async (id: string, data: UpdateProductDTO) => {
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, id);
  req.input('name', sql.NVarChar(200), data.name || null);
  req.input('description', sql.NVarChar(1000), data.description ?? null);
  req.input('price', sql.Decimal(10,2), data.price || null);
  req.input('category', sql.NVarChar(50), data.category || null);
  const res = await req.query(
    `UPDATE Products SET
       name = COALESCE(@name, name),
       description = @description,
       price = COALESCE(@price, price),
       category = COALESCE(@category, category)
     OUTPUT inserted.*
     WHERE id = @id`
  );
  return res.recordset[0];
};

export const deleteProduct = async (id: string) => {
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, id);
  await req.query('DELETE FROM Products WHERE id = @id');
};
