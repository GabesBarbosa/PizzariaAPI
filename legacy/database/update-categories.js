const sql = require('mssql');
require('dotenv').config();

const config = {
  server: 'localhost',
  port: 1433,
  user: 'sa',
  password: process.env.DB_PASSWORD,
  database: 'Pizzaria',
  options: { encrypt: false, trustServerCertificate: true }
};

async function run() {
  const pool = await sql.connect(config);
  await pool.request().query("UPDATE Products SET category = 'pizza' WHERE name IN ('Margherita', 'Pepperoni')");
  await pool.request().query("UPDATE Products SET category = 'bebida' WHERE name = 'Coca-Cola 350ml'");
  console.log('Updated categories for existing products');
  await pool.close();
}

run().catch(err => { console.error(err.message); process.exit(1); });
