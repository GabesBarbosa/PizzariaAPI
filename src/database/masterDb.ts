import sql from 'mssql';

/**
 * Manages a dedicated connection pool for the master database (PizzariaMaster).
 * Used only for authentication and tenant resolution.
 */

const masterConfig: sql.config = {
  server: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433,
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  database: 'PizzariaMaster',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    instanceName: process.env.DB_INSTANCE || undefined
  }
};

const masterPool = new sql.ConnectionPool(masterConfig);
let masterConnectPromise: Promise<sql.ConnectionPool> | null = null;

export const getMasterPool = async (): Promise<sql.ConnectionPool> => {
  if (!masterConnectPromise) {
    masterConnectPromise = masterPool.connect().then(() => masterPool).catch((err) => {
      masterConnectPromise = null;
      const e: any = new Error('Failed to connect to PizzariaMaster database');
      e.original = err;
      throw e;
    });
  }
  return masterConnectPromise;
};

export { sql };
