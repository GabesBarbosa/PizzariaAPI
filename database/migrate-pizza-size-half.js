const sql = require('mssql');
const config = {
  server: 'localhost', port: 1433, user: 'sa', password: 'Larissa7@',
  database: 'Pizzaria', options: { encrypt: false, trustServerCertificate: true }
};
async function run() {
  const pool = await sql.connect(config);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('OrderItems') AND name = 'size')
      ALTER TABLE OrderItems ADD size NVARCHAR(20) NOT NULL DEFAULT 'normal';
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('OrderItems') AND name = 'halfProductId')
      ALTER TABLE OrderItems ADD halfProductId UNIQUEIDENTIFIER NULL;
  `);
  console.log('Migration OK: size + halfProductId added to OrderItems');
  await pool.close();
}
run().catch(e => { console.error(e.message); process.exit(1); });
