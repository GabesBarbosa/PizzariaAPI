import { getPool, sql } from '../database/mssqlClient';
import { getBusinessContext } from '../database/businessContext';
import { CreateCustomerDTO, UpdateCustomerDTO } from '../dtos/customer.dto';

export const getAllCustomers = async () => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const req = conn.request();
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const result = await req.query('SELECT * FROM Customers WHERE businessId = @businessId ORDER BY name');
  return result.recordset;
};

export const createCustomer = async (data: CreateCustomerDTO) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const request = conn.request();
  request.input('businessId', sql.UniqueIdentifier, businessId);
  request.input('name', sql.NVarChar(200), data.name);
  request.input('phone', sql.NVarChar(50), data.phone);
  request.input('address', sql.NVarChar(500), data.address || null);
  const result = await request.query(
    `INSERT INTO Customers (businessId, name, phone, address)
     OUTPUT inserted.*
     VALUES (@businessId, @name, @phone, @address)`
  );
  return result.recordset[0];
};

export const findCustomerById = async (id: string) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const request = conn.request();
  request.input('id', sql.UniqueIdentifier, id);
  request.input('businessId', sql.UniqueIdentifier, businessId);
  const result = await request.query(
    `SELECT * FROM Customers WHERE id = @id AND businessId = @businessId`
  );
  return result.recordset[0];
};

export const findCustomersByNameOrPhone = async (term: string) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const request = conn.request();
  const like = `%${term}%`;
  request.input('term', sql.NVarChar(200), like);
  request.input('businessId', sql.UniqueIdentifier, businessId);
  const result = await request.query(
    `SELECT * FROM Customers WHERE businessId = @businessId AND (name LIKE @term OR phone LIKE @term)`
  );
  return result.recordset;
};

export const updateCustomer = async (id: string, data: UpdateCustomerDTO) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const request = conn.request();
  request.input('id', sql.UniqueIdentifier, id);
  request.input('businessId', sql.UniqueIdentifier, businessId);
  request.input('name', sql.NVarChar(200), data.name || null);
  request.input('phone', sql.NVarChar(50), data.phone || null);
  request.input('address', sql.NVarChar(500), data.address || null);
  const result = await request.query(
    `UPDATE Customers SET
       name = COALESCE(@name, name),
       phone = COALESCE(@phone, phone),
       address = COALESCE(@address, address)
     OUTPUT inserted.*
     WHERE id = @id AND businessId = @businessId`
  );
  return result.recordset[0];
};

export const deleteCustomer = async (id: string) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const request = conn.request();
  request.input('id', sql.UniqueIdentifier, id);
  request.input('businessId', sql.UniqueIdentifier, businessId);
  // Desvincula pedidos existentes antes de deletar (preserva histórico)
  await request.query('UPDATE Orders SET customerId = NULL WHERE customerId = @id AND businessId = @businessId');
  await conn.request()
    .input('id', sql.UniqueIdentifier, id)
    .input('businessId', sql.UniqueIdentifier, businessId)
    .query('DELETE FROM Customers WHERE id = @id AND businessId = @businessId');
};
