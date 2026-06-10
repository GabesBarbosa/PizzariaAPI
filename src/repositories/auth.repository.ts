import { getPool } from '../database/mysqlClient';
import { v4 as uuidv4 } from 'uuid';

export const findUserByEmail = async (email: string) => {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(`
    SELECT u.*, b.name AS businessName, b.slug AS businessSlug, b.active AS businessActive
    FROM Users u
    INNER JOIN Businesses b ON u.businessId = b.id
    WHERE u.email = ?
  `, [email]);
  return rows[0];
};

export const findBusinessBySlug = async (slug: string) => {
  const pool = getPool();
  const [rows] = await pool.query<any[]>('SELECT * FROM Businesses WHERE slug = ?', [slug]);
  return rows[0];
};

export const createBusiness = async (name: string, slug: string) => {
  const pool = getPool();
  const id = uuidv4();
  await pool.query('INSERT INTO Businesses (id, name, slug) VALUES (?, ?, ?)', [id, name, slug]);
  const [rows] = await pool.query<any[]>('SELECT * FROM Businesses WHERE id = ?', [id]);
  return rows[0];
};

export const createUser = async (businessId: string, name: string, email: string, passwordHash: string) => {
  const pool = getPool();
  const id = uuidv4();
  await pool.query(
    'INSERT INTO Users (id, businessId, name, email, passwordHash) VALUES (?, ?, ?, ?, ?)',
    [id, businessId, name, email, passwordHash]
  );
  const [rows] = await pool.query<any[]>(
    'SELECT id, businessId, name, email, role FROM Users WHERE id = ?',
    [id]
  );
  return rows[0];
};

export const findUserById = async (id: string) => {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(`
    SELECT u.id, u.name, u.email, u.role, u.businessId, u.passwordHash,
           b.name AS businessName, b.slug AS businessSlug
    FROM Users u
    INNER JOIN Businesses b ON u.businessId = b.id
    WHERE u.id = ?
  `, [id]);
  return rows[0];
};

export const updateUser = async (id: string, data: { name?: string; email?: string; passwordHash?: string }) => {
  const pool = getPool();
  await pool.query(
    `UPDATE Users SET
       name = COALESCE(?, name),
       email = COALESCE(?, email),
       passwordHash = COALESCE(?, passwordHash)
     WHERE id = ?`,
    [data.name ?? null, data.email ?? null, data.passwordHash ?? null, id]
  );
  const [rows] = await pool.query<any[]>(
    'SELECT id, name, email, role FROM Users WHERE id = ?',
    [id]
  );
  return rows[0];
};
