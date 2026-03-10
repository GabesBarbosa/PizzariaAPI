import { Request, Response, NextFunction } from 'express';
import { getPool, sql } from '../database/mssqlClient';

export const health = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT 1 AS ok');
    if (result && result.recordset && result.recordset.length) {
      return res.json({ status: 'ok', db: 'connected' });
    }
    return res.status(500).json({ status: 'ok', db: 'unknown' });
  } catch (err: any) {
    return res.status(503).json({ status: 'error', db: 'unreachable', detail: err.message || err.toString() });
  }
};
