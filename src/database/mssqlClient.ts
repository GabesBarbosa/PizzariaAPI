import sql from 'mssql';

function parseConnectionString(cs: string): sql.config {
  const parts: Record<string, string> = {};
  cs.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim().toLowerCase();
    const val = pair.slice(idx + 1).trim();
    parts[key] = val;
  });

  const server = parts['server'] || parts['data source'] || '';
  // strip "tcp:" prefix and extract host/port
  const serverClean = server.replace(/^tcp:/i, '');
  const [host, portStr] = serverClean.split(',');

  return {
    server: host.trim(),
    port: portStr ? parseInt(portStr.trim(), 10) : 1433,
    user: parts['user id'] || parts['uid'] || '',
    password: parts['password'] || parts['pwd'] || '',
    database: parts['database'] || parts['initial catalog'] || '',
    requestTimeout: 60000,
    connectionTimeout: 60000,
    options: {
      encrypt: (parts['encrypt'] || 'true').toLowerCase() !== 'false',
      trustServerCertificate: (parts['trustservercertificate'] || 'false').toLowerCase() === 'true',
    },
  };
}

const rawUrl = process.env.DATABASE_URL || '';
console.log('[DB] DATABASE_URL present:', rawUrl.length > 0, '| server:', rawUrl.split(';').find(p => /^server=/i.test(p.trim())) || 'NOT FOUND');
const config = parseConnectionString(rawUrl);

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
