import { getMasterPool, sql } from '../database/masterDb';

export const findUserByEmail = async (email: string) => {
  const conn = await getMasterPool();
  const req = conn.request();
  req.input('email', sql.NVarChar(200), email);
  const result = await req.query(`
    SELECT u.*, t.dbName, t.name AS tenantName, t.slug AS tenantSlug, t.active AS tenantActive
    FROM Users u
    INNER JOIN Tenants t ON u.tenantId = t.id
    WHERE u.email = @email
  `);
  return result.recordset[0];
};

export const findTenantBySlug = async (slug: string) => {
  const conn = await getMasterPool();
  const req = conn.request();
  req.input('slug', sql.NVarChar(100), slug);
  const result = await req.query('SELECT * FROM Tenants WHERE slug = @slug');
  return result.recordset[0];
};

export const createTenant = async (name: string, slug: string, dbName: string) => {
  const conn = await getMasterPool();
  const req = conn.request();
  req.input('name', sql.NVarChar(200), name);
  req.input('slug', sql.NVarChar(100), slug);
  req.input('dbName', sql.NVarChar(128), dbName);
  const result = await req.query(
    `INSERT INTO Tenants (name, slug, dbName)
     OUTPUT inserted.*
     VALUES (@name, @slug, @dbName)`
  );
  return result.recordset[0];
};

export const createUser = async (tenantId: string, name: string, email: string, passwordHash: string) => {
  const conn = await getMasterPool();
  const req = conn.request();
  req.input('tenantId', sql.UniqueIdentifier, tenantId);
  req.input('name', sql.NVarChar(200), name);
  req.input('email', sql.NVarChar(200), email);
  req.input('passwordHash', sql.NVarChar(500), passwordHash);
  const result = await req.query(
    `INSERT INTO Users (tenantId, name, email, passwordHash)
     OUTPUT inserted.id, inserted.tenantId, inserted.name, inserted.email, inserted.role
     VALUES (@tenantId, @name, @email, @passwordHash)`
  );
  return result.recordset[0];
};

export const findUserById = async (id: string) => {
  const conn = await getMasterPool();
  const req = conn.request();
  req.input('id', sql.UniqueIdentifier, id);
  const result = await req.query(`
    SELECT u.id, u.name, u.email, u.role, u.tenantId, u.passwordHash,
           t.name AS tenantName, t.slug AS tenantSlug, t.dbName
    FROM Users u
    INNER JOIN Tenants t ON u.tenantId = t.id
    WHERE u.id = @id
  `);
  return result.recordset[0];
};

export const updateUser = async (id: string, data: { name?: string; email?: string; passwordHash?: string }) => {
  const conn = await getMasterPool();
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
