import sql from 'mssql';

const config: sql.config = {
  server: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433,
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'RestaurantHub',
  requestTimeout: 60000,
  connectionTimeout: 60000,
  options: {
    encrypt: true,
    trustServerCertificate: false,
    connectTimeout: 60000
  }
};

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export const getPool = async (): Promise<sql.ConnectionPool> => {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(config);
    poolPromise = pool.connect().then(() => pool).catch((err: any) => {
      poolPromise = null;
      const e: any = new Error('Failed to connect to database');
      e.original = err;
      throw e;
    });
  }
  return poolPromise;
};

export { sql };
