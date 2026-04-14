import sql from 'mssql';

const connectionString = process.env.DATABASE_URL || '';

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export const getPool = async (): Promise<sql.ConnectionPool> => {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(connectionString);
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
