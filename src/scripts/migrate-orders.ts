/**
 * Migration script to add new order columns:
 * - paymentMethod, deliveryAddress, notes, deliveryFee
 *
 * Usage: npx ts-node --transpile-only src/scripts/migrate-orders.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import sql from 'mssql';

const config: sql.config = {
  server: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433,
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'Pizzaria',
  options: { encrypt: false, trustServerCertificate: true }
};

async function run() {
  const pool = new sql.ConnectionPool(config);
  await pool.connect();

  try {
    console.log('Adding new columns to Orders table...');
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Orders' AND COLUMN_NAME = 'paymentMethod')
        ALTER TABLE Orders ADD paymentMethod NVARCHAR(50) NULL;

      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Orders' AND COLUMN_NAME = 'deliveryAddress')
        ALTER TABLE Orders ADD deliveryAddress NVARCHAR(500) NULL;

      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Orders' AND COLUMN_NAME = 'notes')
        ALTER TABLE Orders ADD notes NVARCHAR(1000) NULL;

      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Orders' AND COLUMN_NAME = 'deliveryFee')
        ALTER TABLE Orders ADD deliveryFee DECIMAL(10,2) NULL DEFAULT 0;
    `);
    console.log('Migration completed successfully!');
  } finally {
    await pool.close();
  }
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
