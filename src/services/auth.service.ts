import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as authRepo from '../repositories/auth.repository';
import { LoginDTO, RegisterDTO } from '../dtos/auth.dto';
import { provisionTenantDatabase } from './tenant.service';

const JWT_SECRET = process.env.JWT_SECRET || 'pizzaria-secret-change-me';
const JWT_EXPIRES = '24h';

export const login = async (data: LoginDTO) => {
  const user = await authRepo.findUserByEmail(data.email);
  if (!user) throw Object.assign(new Error('E-mail ou senha inválidos'), { status: 401 });
  if (!user.active) throw Object.assign(new Error('Usuário desativado'), { status: 403 });
  if (!user.tenantActive) throw Object.assign(new Error('Pizzaria desativada'), { status: 403 });

  const valid = await bcrypt.compare(data.password, user.passwordHash);
  if (!valid) throw Object.assign(new Error('E-mail ou senha inválidos'), { status: 401 });

  const token = jwt.sign(
    {
      userId: user.id,
      tenantId: user.tenantId,
      dbName: user.dbName,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantName: user.tenantName,
      tenantSlug: user.tenantSlug
    }
  };
};

export const register = async (data: RegisterDTO) => {
  // Check if slug is already taken
  const existing = await authRepo.findTenantBySlug(data.tenantSlug);
  if (existing) throw Object.assign(new Error('Slug da pizzaria já está em uso'), { status: 409 });

  // Check if email already exists
  const existingUser = await authRepo.findUserByEmail(data.email);
  if (existingUser) throw Object.assign(new Error('E-mail já cadastrado'), { status: 409 });

  // Create database name from slug
  const dbName = `Pizzaria_${data.tenantSlug.replace(/[^a-zA-Z0-9_]/g, '_')}`;

  // Create tenant record
  const tenant = await authRepo.createTenant(data.tenantName, data.tenantSlug, dbName);

  // Provision tenant database (create DB + tables)
  await provisionTenantDatabase(dbName);

  // Create user
  const passwordHash = await bcrypt.hash(data.password, 10);
  const user = await authRepo.createUser(tenant.id, data.name, data.email, passwordHash);

  // Auto-login after registration
  const token = jwt.sign(
    {
      userId: user.id,
      tenantId: user.tenantId,
      dbName,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantName: data.tenantName,
      tenantSlug: data.tenantSlug
    }
  };
};

export const updateProfile = async (userId: string, data: { name?: string; email?: string; currentPassword?: string; newPassword?: string }) => {
  const user = await authRepo.findUserById(userId);
  if (!user) throw Object.assign(new Error('Usuário não encontrado'), { status: 404 });

  // If changing password, verify current one
  if (data.newPassword) {
    if (!data.currentPassword) throw Object.assign(new Error('Senha atual é obrigatória'), { status: 400 });
    const valid = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!valid) throw Object.assign(new Error('Senha atual incorreta'), { status: 400 });
  }

  // If changing email, check uniqueness
  if (data.email && data.email !== user.email) {
    const existing = await authRepo.findUserByEmail(data.email);
    if (existing) throw Object.assign(new Error('E-mail já está em uso'), { status: 409 });
  }

  const updateData: { name?: string; email?: string; passwordHash?: string } = {};
  if (data.name) updateData.name = data.name;
  if (data.email) updateData.email = data.email;
  if (data.newPassword) updateData.passwordHash = await bcrypt.hash(data.newPassword, 10);

  const updated = await authRepo.updateUser(userId, updateData);

  // Generate new token with updated info
  const token = jwt.sign(
    { userId: updated.id, tenantId: user.tenantId, dbName: user.dbName, role: updated.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );

  return {
    token,
    user: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      tenantName: user.tenantName,
      tenantSlug: user.tenantSlug
    }
  };
};

export const getJwtSecret = () => JWT_SECRET;
