import { getPool } from '../database/mysqlClient';
import { getBusinessContext } from '../database/businessContext';
import { CreateCustomerDTO, UpdateCustomerDTO } from '../dtos/customer.dto';
import { v4 as uuidv4 } from 'uuid';

/**
 * Normaliza um telefone brasileiro pro formato salvo no banco: só DDD + número, sem +55.
 * O comprimento (>11) é o que evita cortar por engano o DDD 55 (Santa Maria/RS) de quem
 * não tem código de país no número — sem essa checagem, "55991234567" (DDD 55, 11 dígitos)
 * vira "991234567" (perde o DDD). É a mesma função usada em toda a base — não duplicar.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
}

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
  const phone = data.phone ? normalizePhone(data.phone) : data.phone;
  await pool.query(
    `INSERT INTO Customers (id, businessId, name, phone, address, cep, street, \`number\`, complement, neighborhood, city, uf, latitude, longitude)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, businessId, data.name, phone, data.address || null,
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
  const normalized = normalizePhone(phone);
  const [rows] = await pool.query<any[]>(
    'SELECT * FROM Customers WHERE businessId = ? AND REGEXP_REPLACE(phone, "[^0-9]", "") = ? LIMIT 1',
    [businessId, normalized]
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
  const phone = data.phone ? normalizePhone(data.phone) : data.phone;
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
    [data.name ?? null, phone ?? null, data.address ?? null,
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
