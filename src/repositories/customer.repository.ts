import { getPool, sql } from '../database/mssqlClient';
import { CreateCustomerDTO, UpdateCustomerDTO } from '../dtos/customer.dto';

export const getAllCustomers = async () => {
  const conn = await getPool();
  const result = await conn.request().query('SELECT * FROM Customers ORDER BY name');
  return result.recordset;
};

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
  const conn = await getPool();
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

export const deleteCustomer = async (id: string) => {
  const conn = await getPool();
  const transaction = new sql.Transaction(conn);
  try {
    await transaction.begin();

    // Remove itens dos pedidos do cliente
    await new sql.Request(transaction)
      .input('cid', sql.UniqueIdentifier, id)
      .query('DELETE oi FROM OrderItems oi INNER JOIN Orders o ON oi.orderId = o.id WHERE o.customerId = @cid');

    // Remove pedidos do cliente
    await new sql.Request(transaction)
      .input('cid', sql.UniqueIdentifier, id)
      .query('DELETE FROM Orders WHERE customerId = @cid');

    // Remove o cliente
    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, id)
      .query('DELETE FROM Customers WHERE id = @id');

    await transaction.commit();
  } catch (err) {
    try { await transaction.rollback(); } catch { /* ignora */ }
    throw err;
  }
};
