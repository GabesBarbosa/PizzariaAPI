import sql from 'mssql';
import { getTenantDb } from './tenantContext';

/**
 * Multi-tenant pool manager.
 * Maintains a Map of connection pools, one per tenant database.
 * getPool() reads the tenant DB from AsyncLocalStorage (set by auth middleware).
 * Falls back to DB_NAME env var for backward compatibility / auth routes.
 */

const baseConfig = {
  server: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433,
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  requestTimeout: 60000,
  connectionTimeout: 60000,
  options: {
    encrypt: true,
    trustServerCertificate: false,
    instanceName: process.env.DB_INSTANCE || undefined,
    connectTimeout: 60000
  }
};

const pools = new Map<string, Promise<sql.ConnectionPool>>();

export const getPool = async (dbName?: string): Promise<sql.ConnectionPool> => {
  const database = dbName || getTenantDb() || process.env.DB_NAME || 'Pizzaria';

  if (!pools.has(database)) {
    const pool = new sql.ConnectionPool({ ...baseConfig, database });
    const connectPromise = pool.connect().then(() => pool).catch((err) => {
      pools.delete(database);
      const e: any = new Error(`Failed to connect to database "${database}"`);
      e.original = err;
      throw e;
    });
    pools.set(database, connectPromise);
  }

  return pools.get(database)!;
};

export { sql };
