import sql from 'mssql';

// Build connection config from env (kept simple)
const poolConfig: sql.config = {
  server: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'Pizzaria',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// Create pool but DO NOT call .connect() immediately to avoid startup crash when DB is unreachable.
const pool = new sql.ConnectionPool(poolConfig);
let poolConnectPromise: Promise<sql.ConnectionPool> | null = null;

export const getPool = async (): Promise<sql.ConnectionPool> => {
  if (!poolConnectPromise) {
    poolConnectPromise = pool.connect().then(() => pool).catch((err) => {
      // clear cached promise on failure so next attempt can retry
      poolConnectPromise = null;
      throw err;
    });
  }
  return poolConnectPromise;
};

export { sql };
export default pool;
