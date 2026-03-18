/**
 * Full migration script for Azure SQL Database.
 *
 * Prerequisites:
 *   - Create both databases manually in the Azure Portal BEFORE running this script:
 *       1. PizzariaMaster
 *       2. The value of DB_NAME in your .env (e.g. "pizzaria")
 *
 * Usage:
 *   npx ts-node --transpile-only src/scripts/migrate-azure.ts
 *
 * What this does:
 *   1. Creates all tables in PizzariaMaster (Tenants + Users)
 *   2. Creates all tables in the tenant database (Customers, Products, Orders, OrderItems)
 *   3. Seeds the initial tenant + admin user if they don't exist
 */
import dotenv from 'dotenv';
dotenv.config();

import sql from 'mssql';
import bcrypt from 'bcryptjs';

const base: sql.config = {
  server: process.env.DB_HOST || '',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433,
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

// ─── 1. PizzariaMaster ────────────────────────────────────────────────────────

async function migrateMaster() {
  console.log('\n[1/2] Connecting to PizzariaMaster...');
  const pool = new sql.ConnectionPool({ ...base, database: 'PizzariaMaster' });
  await pool.connect();
  console.log('      Connected.');

  try {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Tenants'
      )
      CREATE TABLE Tenants (
        id         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        name       NVARCHAR(200)    NOT NULL,
        slug       NVARCHAR(100)    NOT NULL UNIQUE,
        dbName     NVARCHAR(128)    NOT NULL UNIQUE,
        active     BIT              NOT NULL DEFAULT 1,
        createdAt  DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME()
      );
    `);
    console.log('      [OK] Tenants');

    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Users'
      )
      CREATE TABLE Users (
        id           UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        tenantId     UNIQUEIDENTIFIER NOT NULL,
        name         NVARCHAR(200)    NOT NULL,
        email        NVARCHAR(200)    NOT NULL UNIQUE,
        passwordHash NVARCHAR(500)    NOT NULL,
        role         NVARCHAR(50)     NOT NULL DEFAULT 'admin',
        active       BIT              NOT NULL DEFAULT 1,
        createdAt    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_Users_Tenants FOREIGN KEY (tenantId) REFERENCES Tenants(id)
      );
    `);
    console.log('      [OK] Users');

    await seedMaster(pool);
  } finally {
    await pool.close();
  }
}

async function seedMaster(pool: sql.ConnectionPool) {
  const tenantDbName = process.env.DB_NAME || 'pizzaria';

  const existing = await pool.request()
    .input('slug', sql.NVarChar(100), 'larissa')
    .query('SELECT id FROM Tenants WHERE slug = @slug');

  if (existing.recordset.length > 0) {
    console.log('      [SKIP] Tenant "larissa" already exists.');
    return;
  }

  console.log('      Seeding tenant...');
  const tenantResult = await pool.request()
    .input('name',   sql.NVarChar(200), 'Pizzaria da Larissa')
    .input('slug',   sql.NVarChar(100), 'larissa')
    .input('dbName', sql.NVarChar(128), tenantDbName)
    .query(`
      INSERT INTO Tenants (name, slug, dbName)
      OUTPUT inserted.id
      VALUES (@name, @slug, @dbName)
    `);

  const tenantId = tenantResult.recordset[0].id;
  const passwordHash = await bcrypt.hash('123456', 10);

  await pool.request()
    .input('tenantId',     sql.UniqueIdentifier, tenantId)
    .input('name',         sql.NVarChar(200),    'Larissa')
    .input('email',        sql.NVarChar(200),    'larissa@pizzaria.com')
    .input('passwordHash', sql.NVarChar(500),    passwordHash)
    .query(`
      INSERT INTO Users (tenantId, name, email, passwordHash, role)
      VALUES (@tenantId, @name, @email, @passwordHash, 'admin')
    `);

  console.log('      [OK] Tenant + admin user seeded');
  console.log('           Login : larissa@pizzaria.com');
  console.log('           Senha : 123456');
}

// ─── 2. Tenant database ───────────────────────────────────────────────────────

async function migrateTenant() {
  const dbName = process.env.DB_NAME || 'pizzaria';
  console.log(`\n[2/2] Connecting to tenant database "${dbName}"...`);
  const pool = new sql.ConnectionPool({ ...base, database: dbName });
  await pool.connect();
  console.log('      Connected.');

  try {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Customers'
      )
      CREATE TABLE Customers (
        id        UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        name      NVARCHAR(200)    NOT NULL,
        phone     NVARCHAR(50)     NOT NULL UNIQUE,
        address   NVARCHAR(500)    NULL,
        createdAt DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME()
      );
    `);
    console.log('      [OK] Customers');

    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Products'
      )
      CREATE TABLE Products (
        id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        name        NVARCHAR(200)    NOT NULL,
        description NVARCHAR(1000)   NULL,
        price       DECIMAL(10,2)    NOT NULL,
        category    NVARCHAR(50)     NOT NULL DEFAULT 'outro',
        createdAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME()
      );
    `);
    console.log('      [OK] Products');

    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Orders'
      )
      CREATE TABLE Orders (
        id              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        customerId      UNIQUEIDENTIFIER  NOT NULL,
        total           DECIMAL(12,2)     NOT NULL,
        status          NVARCHAR(50)      NOT NULL DEFAULT 'RECEIVED',
        paymentMethod   NVARCHAR(50)      NULL,
        deliveryAddress NVARCHAR(500)     NULL,
        notes           NVARCHAR(1000)    NULL,
        deliveryFee     DECIMAL(10,2)     NULL DEFAULT 0,
        channel         NVARCHAR(50)      NULL DEFAULT 'balcao',
        createdAt       DATETIME2         NOT NULL DEFAULT SYSUTCDATETIME(),
        deliveredAt     DATETIME2         NULL,
        CONSTRAINT FK_Orders_Customers FOREIGN KEY (customerId) REFERENCES Customers(id)
      );
    `);
    console.log('      [OK] Orders');

    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'OrderItems'
      )
      CREATE TABLE OrderItems (
        id            UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        orderId       INT              NOT NULL,
        productId     UNIQUEIDENTIFIER NOT NULL,
        halfProductId UNIQUEIDENTIFIER NULL,
        quantity      INT              NOT NULL,
        price         DECIMAL(10,2)    NOT NULL,
        size          NVARCHAR(20)     NOT NULL DEFAULT 'normal',
        CONSTRAINT FK_OrderItems_Orders   FOREIGN KEY (orderId)       REFERENCES Orders(id),
        CONSTRAINT FK_OrderItems_Products FOREIGN KEY (productId)     REFERENCES Products(id),
        CONSTRAINT FK_OrderItems_HalfProd FOREIGN KEY (halfProductId) REFERENCES Products(id)
      );
    `);
    console.log('      [OK] OrderItems');

    // Safety: add any missing columns on existing tables (idempotent)
    await pool.request().query(`
      IF COL_LENGTH('Orders', 'paymentMethod')   IS NULL ALTER TABLE Orders ADD paymentMethod   NVARCHAR(50)   NULL;
      IF COL_LENGTH('Orders', 'deliveryAddress') IS NULL ALTER TABLE Orders ADD deliveryAddress NVARCHAR(500)  NULL;
      IF COL_LENGTH('Orders', 'notes')           IS NULL ALTER TABLE Orders ADD notes           NVARCHAR(1000) NULL;
      IF COL_LENGTH('Orders', 'deliveryFee')     IS NULL ALTER TABLE Orders ADD deliveryFee     DECIMAL(10,2)  NULL DEFAULT 0;
      IF COL_LENGTH('Orders', 'channel')         IS NULL ALTER TABLE Orders ADD channel         NVARCHAR(50)   NULL DEFAULT 'balcao';
      IF COL_LENGTH('Orders', 'deliveredAt')     IS NULL ALTER TABLE Orders ADD deliveredAt     DATETIME2      NULL;
      IF COL_LENGTH('OrderItems', 'size')          IS NULL ALTER TABLE OrderItems ADD size          NVARCHAR(20)     NOT NULL DEFAULT 'normal';
      IF COL_LENGTH('OrderItems', 'halfProductId') IS NULL ALTER TABLE OrderItems ADD halfProductId UNIQUEIDENTIFIER NULL;
    `);
    console.log('      [OK] Column safety-patch applied');
  } finally {
    await pool.close();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Azure SQL Migration ===');
  console.log(`Server : ${base.server}`);
  console.log(`User   : ${base.user}`);

  await migrateMaster();
  await migrateTenant();

  console.log('\n=== Migration complete! ===\n');
}

main().catch((err) => {
  console.error('\nMigration failed:', err.message || err);
  if (err.original) console.error('Cause:', err.original.message || err.original);
  process.exit(1);
});