import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { tenantStorage } from '../database/tenantContext';
import { getJwtSecret } from '../services/auth.service';

export interface AuthPayload {
  userId: string;
  tenantId: string;
  dbName: string;
  role: string;
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  let token: string | undefined;

  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (typeof req.query.token === 'string' && req.query.token) {
    // SSE / EventSource can't send headers, allow token via query param
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ message: 'Token não fornecido' });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as AuthPayload;

    // Attach user info to request
    (req as any).user = {
      userId: payload.userId,
      tenantId: payload.tenantId,
      dbName: payload.dbName,
      role: payload.role
    };

    // Run the rest of the request chain inside the tenant context
    tenantStorage.run(
      { tenantId: payload.tenantId, dbName: payload.dbName, userId: payload.userId },
      () => next()
    );
  } catch (err) {
    return res.status(401).json({ message: 'Token inválido ou expirado' });
  }
};
