import { getPool } from '../database/mysqlClient';
import { getBusinessContext } from '../database/businessContext';
import { CreateCustomerDTO, UpdateCustomerDTO } from '../dtos/customer.dto';
import { v4 as uuidv4 } from 'uuid';

export const getAllCustomers = async () => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    'SELECT * FROM Customers WHERE businessId = ? ORDER BY name',
    [businessId]
  );
  return rows;
};

export const createCustomer = async (data: CreateCustomerDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const id = uuidv4();
  await pool.query(
    `INSERT INTO Customers (id, businessId, name, phone, address, cep, street, \`number\`, complement, neighborhood, city, uf, latitude, longitude)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, businessId, data.name, data.phone, data.address || null,
     data.cep ?? null, data.street ?? null, data.number ?? null,
     data.complement ?? null, data.neighborhood ?? null,
     data.city ?? null, data.uf ?? null,
     data.latitude ?? null, data.longitude ?? null]
  );
  const [rows] = await pool.query<any[]>('SELECT * FROM Customers WHERE id = ?', [id]);
  return rows[0];
};

export const findCustomerById = async (id: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    'SELECT * FROM Customers WHERE id = ? AND businessId = ?',
    [id, businessId]
  );
  return rows[0];
};

export const findCustomerByPhone = async (phone: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    'SELECT * FROM Customers WHERE businessId = ? AND phone = ? LIMIT 1',
    [businessId, phone]
  );
  return rows[0];
};

export const findCustomersByNameOrPhone = async (term: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const like = `%${term}%`;
  const [rows] = await pool.query<any[]>(
    'SELECT * FROM Customers WHERE businessId = ? AND (name LIKE ? OR phone LIKE ?)',
    [businessId, like, like]
  );
  return rows;
};

export const updateCustomer = async (id: string, data: UpdateCustomerDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  await pool.query(
    `UPDATE Customers SET
       name         = COALESCE(?, name),
       phone        = COALESCE(?, phone),
       address      = COALESCE(?, address),
       cep          = COALESCE(?, cep),
       street       = COALESCE(?, street),
       \`number\`   = COALESCE(?, \`number\`),
       complement   = COALESCE(?, complement),
       neighborhood = COALESCE(?, neighborhood),
       city         = COALESCE(?, city),
       uf           = COALESCE(?, uf),
       latitude     = COALESCE(?, latitude),
       longitude    = COALESCE(?, longitude)
     WHERE id = ? AND businessId = ?`,
    [data.name ?? null, data.phone ?? null, data.address ?? null,
     data.cep ?? null, data.street ?? null, data.number ?? null,
     data.complement ?? null, data.neighborhood ?? null,
     data.city ?? null, data.uf ?? null,
     data.latitude ?? null, data.longitude ?? null,
     id, businessId]
  );
  const [rows] = await pool.query<any[]>('SELECT * FROM Customers WHERE id = ?', [id]);
  return rows[0];
};

export const upsertCustomerByPhone = async (data: CreateCustomerDTO) => {
  const existing = await findCustomerByPhone(data.phone);
  if (existing) {
    return await updateCustomer(existing.id, data);
  }
  return await createCustomer(data);
};

export const deleteCustomer = async (id: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  await pool.query(
    'UPDATE Orders SET customerId = NULL WHERE customerId = ? AND businessId = ?',
    [id, businessId]
  );
  await pool.query(
    'DELETE FROM Customers WHERE id = ? AND businessId = ?',
    [id, businessId]
  );
};
