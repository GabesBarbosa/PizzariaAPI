import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { businessStorage } from '../database/businessContext';
import { getJwtSecret } from '../services/auth.service';

export interface AuthPayload {
  userId: string;
  businessId: string;
  role: string;
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  let token: string | undefined;

  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (typeof req.query.token === 'string' && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ message: 'Token não fornecido' });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as AuthPayload;

    (req as any).user = {
      userId: payload.userId,
      businessId: payload.businessId,
      role: payload.role
    };

    businessStorage.run(
      { businessId: payload.businessId, userId: payload.userId, role: payload.role },
      () => next()
    );
  } catch (err) {
    return res.status(401).json({ message: 'Token inválido ou expirado' });
  }
};
