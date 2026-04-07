import { getPool, sql } from '../database/mssqlClient';

export const findUserByEmail = async (email: string) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('email', sql.NVarChar(200), email);
  const result = await req.query(`
    SELECT u.*, b.name AS businessName, b.slug AS businessSlug, b.active AS businessActive
    FROM Users u
    INNER JOIN Businesses b ON u.businessId = b.id
    WHERE u.email = @email
  `);
  return result.recordset[0];
};

export const findBusinessBySlug = async (slug: string) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('slug', sql.NVarChar(100), slug);
  const result = await req.query('SELECT * FROM Businesses WHERE slug = @slug');
  return result.recordset[0];
};

export const createBusiness = async (name: string, slug: string) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('name', sql.NVarChar(200), name);
  req.input('slug', sql.NVarChar(100), slug);
  const result = await req.query(
    `INSERT INTO Businesses (name, slug)
     OUTPUT inserted.*
     VALUES (@name, @slug)`
  );
  return result.recordset[0];
};

export const createUser = async (businessId: string, name: string, email: string, passwordHash: string) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('businessId', sql.UniqueIdentifier, businessId);
  req.input('name', sql.NVarChar(200), name);
  req.input('email', sql.NVarChar(200), email);
  req.input('passwordHash', sql.NVarChar(500), passwordHash);
  const result = await req.query(
    `INSERT INTO Users (businessId, name, email, passwordHash)
     OUTPUT inserted.id, inserted.businessId, inserted.name, inserted.email, inserted.role
     VALUES (@businessId, @name, @email, @passwordHash)`
  );
  return result.recordset[0];
};

export const findUserById = async (id: string) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('id', sql.UniqueIdentifier, id);
  const result = await req.query(`
    SELECT u.id, u.name, u.email, u.role, u.businessId, u.passwordHash,
           b.name AS businessName, b.slug AS businessSlug
    FROM Users u
    INNER JOIN Businesses b ON u.businessId = b.id
    WHERE u.id = @id
  `);
  return result.recordset[0];
};

export const updateUser = async (id: string, data: { name?: string; email?: string; passwordHash?: string }) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('id', sql.UniqueIdentifier, id);
  req.input('name', sql.NVarChar(200), data.name || null);
  req.input('email', sql.NVarChar(200), data.email || null);
  req.input('passwordHash', sql.NVarChar(500), data.passwordHash || null);
  const result = await req.query(
    `UPDATE Users SET
       name = COALESCE(@name, name),
       email = COALESCE(@email, email),
       passwordHash = COALESCE(@passwordHash, passwordHash)
     OUTPUT inserted.id, inserted.name, inserted.email, inserted.role
     WHERE id = @id`
  );
  return result.recordset[0];
};
