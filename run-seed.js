const sql = require('mssql');
const bcrypt = require('bcryptjs');

const config = {
  server: process.env.DB_HOST || 'db',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  database: 'master',
  options: { encrypt: false, trustServerCertificate: true }
};

async function run() {
  const pool = new sql.ConnectionPool(config);
  await pool.connect();

  console.log('Creating PizzariaMaster database if not exists...');
  await pool.request().query(`
    IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'PizzariaMaster')
    CREATE DATABASE PizzariaMaster
  `);
  await pool.close();

  const masterCfg = { ...config, database: 'PizzariaMaster' };
  const masterPool = new sql.ConnectionPool(masterCfg);
  await masterPool.connect();

  console.log('Creating tables if not exists...');
  await masterPool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Tenants')
    CREATE TABLE Tenants (
      id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
      name NVARCHAR(200) NOT NULL,
      slug NVARCHAR(100) NOT NULL UNIQUE,
      dbName NVARCHAR(128) NOT NULL UNIQUE,
      active BIT NOT NULL DEFAULT 1,
      createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );

    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Users')
    CREATE TABLE Users (
      id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
      tenantId UNIQUEIDENTIFIER NOT NULL,
      name NVARCHAR(200) NOT NULL,
      email NVARCHAR(200) NOT NULL UNIQUE,
      passwordHash NVARCHAR(500) NOT NULL,
      role NVARCHAR(50) NOT NULL DEFAULT 'admin',
      active BIT NOT NULL DEFAULT 1,
      createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_Users_Tenants FOREIGN KEY (tenantId) REFERENCES Tenants(id)
    );
  `);

  // check existing tenant
  const existing = await masterPool.request()
    .input('slug', sql.NVarChar(100), 'larissa')
    .query('SELECT id FROM Tenants WHERE slug = @slug');

  if (existing.recordset.length > 0) {
    console.log('Tenant "larissa" already exists. Skipping seed.');
    await masterPool.close();
    return;
  }

  console.log('Creating Larissa tenant...');
  const tenantResult = await masterPool.request()
    .input('name', sql.NVarChar(200), 'Pizzaria da Larissa')
    .input('slug', sql.NVarChar(100), 'larissa')
    .input('dbName', sql.NVarChar(128), 'Pizzaria')
    .query(`
      INSERT INTO Tenants (name, slug, dbName)
      OUTPUT inserted.id
      VALUES (@name, @slug, @dbName)
    `);

  const tenantId = tenantResult.recordset[0].id;

  console.log('Creating admin user...');
  const passwordHash = await bcrypt.hash('123456', 10);

  await masterPool.request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('name', sql.NVarChar(200), 'Larissa')
    .input('email', sql.NVarChar(200), 'larissa@pizzaria.com')
    .input('passwordHash', sql.NVarChar(500), passwordHash)
    .query(`
      INSERT INTO Users (tenantId, name, email, passwordHash, role)
      VALUES (@tenantId, @name, @email, @passwordHash, 'admin')
    `);

  console.log('');
  console.log('=== Seed concluído! ===');
  console.log('Login: larissa@pizzaria.com');
  console.log('Senha: 123456');
  console.log('Banco: Pizzaria (já existente)');
  console.log('');

  await masterPool.close();
}

run().catch(err => {
  console.error('Erro no seed:', err);
  process.exit(1);
});
