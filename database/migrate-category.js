const sql = require('mssql');

const config = {
  server: 'localhost',
  port: 1433,
  user: 'sa',
  password: 'Larissa7@',
  database: 'Pizzaria',
  options: { encrypt: false, trustServerCertificate: true }
};

async function run() {
  const pool = await sql.connect(config);
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('Products') AND name = 'category'
    )
    ALTER TABLE Products ADD category NVARCHAR(50) NOT NULL DEFAULT 'outro'
  `);
  console.log('Migration OK: category column added to Products');
  await pool.close();
}

run().catch(err => { console.error(err.message); process.exit(1); });
