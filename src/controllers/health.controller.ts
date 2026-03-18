import { Request, Response, NextFunction } from 'express';
import { getPool, sql } from '../database/mssqlClient';
import { getMasterPool } from '../database/masterDb';

export const health = async (req: Request, res: Response, next: NextFunction) => {
  const results: any = {
    env: {
      DB_HOST: process.env.DB_HOST || '(not set)',
      DB_PORT: process.env.DB_PORT || '(not set)',
      DB_USER: process.env.DB_USER || '(not set)',
      DB_NAME: process.env.DB_NAME || '(not set)',
      DB_INSTANCE: process.env.DB_INSTANCE || '(not set)',
    },
    master: { status: 'pending' },
    tenant: { status: 'pending' },
  };

  // Test master DB
  const t0 = Date.now();
  try {
    const pool = await getMasterPool();
    const r = await pool.request().query('SELECT 1 AS ok');
    results.master = { status: 'connected', ms: Date.now() - t0 };
  } catch (err: any) {
    results.master = {
      status: 'failed',
      ms: Date.now() - t0,
      error: err.message,
      detail: err.original?.message,
    };
  }

  // Test tenant DB
  const t1 = Date.now();
  try {
    const pool = await getPool();
    const r = await pool.request().query('SELECT 1 AS ok');
    results.tenant = { status: 'connected', ms: Date.now() - t1 };
  } catch (err: any) {
    results.tenant = {
      status: 'failed',
      ms: Date.now() - t1,
      error: err.message,
      detail: err.original?.message,
    };
  }

  const statusCode = results.master.status === 'connected' ? 200 : 503;
  return res.status(statusCode).json(results);
};
