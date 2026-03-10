import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'E-mail e senha são obrigatórios' });
    }
    const result = await authService.login({ email, password });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, password, tenantName, tenantSlug } = req.body;
    if (!name || !email || !password || !tenantName || !tenantSlug) {
      return res.status(400).json({ message: 'Todos os campos são obrigatórios' });
    }
    // Validate slug format
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(tenantSlug) || tenantSlug.length < 3) {
      return res.status(400).json({ message: 'Slug inválido. Use letras minúsculas, números e hífens (mín. 3 caracteres)' });
    }
    const result = await authService.register({ name, email, password, tenantName, tenantSlug });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const me = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json((req as any).user);
  } catch (err) {
    next(err);
  }
};

export const updateProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { name, email, currentPassword, newPassword } = req.body;
    const result = await authService.updateProfile(userId, { name, email, currentPassword, newPassword });
    res.json(result);
  } catch (err) {
    next(err);
  }
};
