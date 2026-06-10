import { Request, Response, NextFunction } from 'express';
import { getPool } from '../database/mysqlClient';

export const health = async (req: Request, res: Response, next: NextFunction) => {
  const results: any = {
    env: {
      MYSQLHOST: process.env.MYSQLHOST || '(not set)',
      MYSQLPORT: process.env.MYSQLPORT || '(not set)',
      MYSQLUSER: process.env.MYSQLUSER || '(not set)',
      MYSQLDATABASE: process.env.MYSQLDATABASE || '(not set)',
    },
    db: { status: 'pending' },
  };

  const t0 = Date.now();
  try {
    const pool = getPool();
    await pool.query('SELECT 1 AS ok');
    results.db = { status: 'connected', ms: Date.now() - t0 };
  } catch (err: any) {
    results.db = {
      status: 'failed',
      ms: Date.now() - t0,
      error: err.message,
    };
  }

  const statusCode = results.db.status === 'connected' ? 200 : 503;
  return res.status(statusCode).json(results);
};
