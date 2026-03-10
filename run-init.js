const sql = require('mssql');
const fs = require('fs');

const sqlText = fs.readFileSync('database/init.sql', 'utf8');

const host = process.env.DB_HOST || 'db';
const port = parseInt(process.env.DB_PORT || '1433', 10);
const user = process.env.DB_USER || 'sa';
const password = process.env.DB_PASSWORD || '';
const targetDb = process.env.DB_NAME || 'Pizzaria';

const masterCfg = {
  server: host,
  port: port,
  user: user,
  password: password,
  database: 'master',
  options: { encrypt: false, trustServerCertificate: true }
};

const targetCfg = { ...masterCfg, database: targetDb };

(async () => {
  try {
    // Connect to master to ensure target database exists
    const masterPool = await sql.connect(masterCfg);
    console.log('Connected to master, ensuring database exists...');
    await masterPool.request().query(`IF DB_ID('${targetDb}') IS NULL CREATE DATABASE [${targetDb}]`);
    await masterPool.close();

    // Connect to target DB and run init.sql
    const pool = await sql.connect(targetCfg);
    console.log(`Connected to ${targetDb}, running init.sql...`);
    await pool.request().batch(sqlText);
    console.log('init.sql executed successfully');
    await sql.close();
    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err && (err.message || err));
    process.exit(1);
  }
})();
