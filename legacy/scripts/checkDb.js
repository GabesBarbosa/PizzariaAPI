require('dotenv').config();
const sql = require('mssql');

const hosts = [process.env.DB_HOST || 'localhost', 'host.docker.internal'];
const port = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433;
const user = process.env.DB_USER || 'sa';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || 'Pizzaria';

async function tryConnect(host) {
  const config = {
    server: host,
    port,
    user,
    password,
    database,
    options: {
      encrypt: false,
      trustServerCertificate: true
    },
    connectionTimeout: 10000,
    requestTimeout: 10000
  };

  console.log(`Trying ${host}:${port} -> DB=${database} as ${user}`);
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query('SELECT SUSER_SNAME() AS current_user, @@VERSION AS version');
    console.log('Connected OK:', result.recordset[0]);
    await pool.close();
    return true;
  } catch (err) {
    console.error(`Failed on ${host}:`, err && err.message ? err.message : err);
    return false;
  }
}

(async () => {
  for (const h of hosts) {
    await tryConnect(h);
  }
  process.exit(0);
})();
