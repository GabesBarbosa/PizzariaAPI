import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

export const getPool = (): mysql.Pool => {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQLHOST,
      port: parseInt(process.env.MYSQLPORT || '3306', 10),
      user: process.env.MYSQLUSER,
      password: process.env.MYSQLPASSWORD,
      database: process.env.MYSQLDATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      timezone: '+00:00',
      ssl: { rejectUnauthorized: false },
    });
    console.log('[DB] MySQL pool created | host:', process.env.MYSQLHOST);
  }
  return pool;
};
