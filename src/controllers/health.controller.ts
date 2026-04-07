import { Request, Response, NextFunction } from 'express';
import { getPool } from '../database/mssqlClient';

export const health = async (req: Request, res: Response, next: NextFunction) => {
  const results: any = {
    env: {
      DB_HOST: process.env.DB_HOST || '(not set)',
      DB_PORT: process.env.DB_PORT || '(not set)',
      DB_USER: process.env.DB_USER || '(not set)',
      DB_NAME: process.env.DB_NAME || '(not set)',
    },
    db: { status: 'pending' },
  };

  const t0 = Date.now();
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1 AS ok');
    results.db = { status: 'connected', ms: Date.now() - t0 };
  } catch (err: any) {
    results.db = {
      status: 'failed',
      ms: Date.now() - t0,
      error: err.message,
      detail: err.original?.message,
    };
  }

  const statusCode = results.db.status === 'connected' ? 200 : 503;
  return res.status(statusCode).json(results);
};
