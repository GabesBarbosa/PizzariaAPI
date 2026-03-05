import { getPool, sql } from '../database/mssqlClient';
import { CreateCustomerDTO, UpdateCustomerDTO } from '../dtos/customer.dto';

export const createCustomer = async (data: CreateCustomerDTO) => {
  const conn = await getPool();
  const request = conn.request();
  request.input('name', sql.NVarChar(200), data.name);
  request.input('phone', sql.NVarChar(50), data.phone);
  request.input('address', sql.NVarChar(500), data.address || null);
  const result = await request.query(
    `INSERT INTO Customers (name, phone, address)
     OUTPUT inserted.*
     VALUES (@name, @phone, @address)`
  );
  return result.recordset[0];
};

export const findCustomerById = async (id: string) => {
  const conn = await getPool();
  const request = conn.request();
  request.input('id', sql.UniqueIdentifier, id);
  const result = await request.query(`SELECT * FROM Customers WHERE id = @id`);
  return result.recordset[0];
};

export const findCustomersByNameOrPhone = async (term: string) => {
  const conn = await getPool();
  const request = conn.request();
  const like = `%${term}%`;
  request.input('term', sql.NVarChar(200), like);
  const result = await request.query(
    `SELECT * FROM Customers WHERE name LIKE @term OR phone LIKE @term`);
  return result.recordset;
};

export const updateCustomer = async (id: string, data: UpdateCustomerDTO) => {
  const conn = await pool.connect();
  const request = conn.request();
  request.input('id', sql.UniqueIdentifier, id);
  request.input('name', sql.NVarChar(200), data.name || null);
  request.input('phone', sql.NVarChar(50), data.phone || null);
  request.input('address', sql.NVarChar(500), data.address || null);
  const result = await request.query(
    `UPDATE Customers SET
       name = COALESCE(@name, name),
       phone = COALESCE(@phone, phone),
       address = COALESCE(@address, address)
     OUTPUT inserted.*
     WHERE id = @id`);
  return result.recordset[0];
};
