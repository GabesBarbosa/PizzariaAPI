/**
 * Script to seed the RestaurantHub database with the initial business.
 *
 * Usage: node -r ts-node/register src/scripts/seed-master.ts
 *   or:  npx ts-node src/scripts/seed-master.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import sql from 'mssql';
import bcrypt from 'bcryptjs';

const config: sql.config = {
  server: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433,
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  database: 'master',
  options: { encrypt: false, trustServerCertificate: true }
};

async function run() {
  const pool = new sql.ConnectionPool(config);
  await pool.connect();

  // 1. Create RestaurantHub if not exists
  console.log('Creating RestaurantHub database...');
  await pool.request().query(`
    IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'RestaurantHub')
    CREATE DATABASE RestaurantHub
  `);
  await pool.close();

  // 2. Connect to RestaurantHub and create tables + seed
  const hubConfig: sql.config = { ...config, database: 'RestaurantHub' };
  const hubPool = new sql.ConnectionPool(hubConfig);
  await hubPool.connect();

  console.log('Creating tables...');
  await hubPool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Businesses')
    CREATE TABLE Businesses (
      id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
      name NVARCHAR(200) NOT NULL,
      slug NVARCHAR(100) NOT NULL UNIQUE,
      active BIT NOT NULL DEFAULT 1,
      createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );

    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Users')
    CREATE TABLE Users (
      id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
      businessId UNIQUEIDENTIFIER NOT NULL,
      name NVARCHAR(200) NOT NULL,
      email NVARCHAR(200) NOT NULL UNIQUE,
      passwordHash NVARCHAR(500) NOT NULL,
      role NVARCHAR(50) NOT NULL DEFAULT 'admin',
      active BIT NOT NULL DEFAULT 1,
      createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_Users_Businesses FOREIGN KEY (businessId) REFERENCES Businesses(id)
    );
  `);

  // 3. Check if business already exists
  const existing = await hubPool.request()
    .input('slug', sql.NVarChar(100), 'larissa')
    .query('SELECT id FROM Businesses WHERE slug = @slug');

  if (existing.recordset.length > 0) {
    console.log('Business "larissa" already exists. Skipping seed.');
    await hubPool.close();
    return;
  }

  // 4. Create initial business
  console.log('Creating initial business...');
  const businessSlug = 'larissa';
  const businessName = 'Pizzaria da Larissa';
  const businessResult = await hubPool.request()
    .input('name', sql.NVarChar(200), businessName)
    .input('slug', sql.NVarChar(100), businessSlug)
    .query(`
      INSERT INTO Businesses (name, slug)
      OUTPUT inserted.id
      VALUES (@name, @slug)
    `);

  const businessId = businessResult.recordset[0].id;

  // 5. Create admin user
  console.log('Creating admin user...');
  const passwordHash = await bcrypt.hash('123456', 10);

  await hubPool.request()
    .input('businessId', sql.UniqueIdentifier, businessId)
    .input('name', sql.NVarChar(200), 'Larissa')
    .input('email', sql.NVarChar(200), 'larissa@pizzaria.com')
    .input('passwordHash', sql.NVarChar(500), passwordHash)
    .query(`
      INSERT INTO Users (businessId, name, email, passwordHash, role)
      VALUES (@businessId, @name, @email, @passwordHash, 'admin')
    `);

  console.log('');
  console.log('=== Seed concluído! ===');
  console.log('Login: larissa@pizzaria.com');
  console.log('Senha: 123456');
  console.log('');

  await hubPool.close();
}

run().catch(err => {
  console.error('Erro no seed:', err);
  process.exit(1);
});
