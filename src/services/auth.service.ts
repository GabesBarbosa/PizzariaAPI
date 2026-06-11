import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as authRepo from '../repositories/auth.repository';
import { setSettingForBusiness } from '../repositories/settings.repository';
import { LoginDTO, RegisterDTO } from '../dtos/auth.dto';

const JWT_SECRET = process.env.JWT_SECRET || 'restaurant-secret-change-me';
const JWT_EXPIRES = '24h';

export const login = async (data: LoginDTO) => {
  const user = await authRepo.findUserByEmail(data.email);
  if (!user) throw Object.assign(new Error('E-mail ou senha inválidos'), { status: 401 });
  if (!user.active) throw Object.assign(new Error('Usuário desativado'), { status: 403 });
  if (!user.businessActive) throw Object.assign(new Error('Estabelecimento desativado'), { status: 403 });

  const valid = await bcrypt.compare(data.password, user.passwordHash);
  if (!valid) throw Object.assign(new Error('E-mail ou senha inválidos'), { status: 401 });

  const token = jwt.sign(
    { userId: user.id, businessId: user.businessId, role: user.role },
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
      businessName: user.businessName,
      businessSlug: user.businessSlug
    }
  };
};

const generateSlug = async (name: string): Promise<string> => {
  const base = name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);

  let slug = base;
  let attempt = 0;
  while (await authRepo.findBusinessBySlug(slug)) {
    attempt++;
    slug = `${base}-${attempt}`;
  }
  return slug;
};

export const register = async (data: RegisterDTO) => {
  const existingUser = await authRepo.findUserByEmail(data.email);
  if (existingUser) throw Object.assign(new Error('E-mail já cadastrado'), { status: 409 });

  const businessSlug = await generateSlug(data.businessName);
  const business = await authRepo.createBusiness(data.businessName, businessSlug);

  if (data.businessType) {
    await setSettingForBusiness(business.id, 'businessType', data.businessType);
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const user = await authRepo.createUser(business.id, data.name, data.email, passwordHash);

  const token = jwt.sign(
    { userId: user.id, businessId: business.id, role: user.role },
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
      businessName: data.businessName,
      businessSlug: businessSlug
    }
  };
};

export const updateProfile = async (userId: string, data: { name?: string; email?: string; businessName?: string; currentPassword?: string; newPassword?: string }) => {
  const user = await authRepo.findUserById(userId);
  if (!user) throw Object.assign(new Error('Usuário não encontrado'), { status: 404 });

  if (data.newPassword) {
    if (!data.currentPassword) throw Object.assign(new Error('Senha atual é obrigatória'), { status: 400 });
    const valid = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!valid) throw Object.assign(new Error('Senha atual incorreta'), { status: 400 });
  }

  if (data.email && data.email !== user.email) {
    const existing = await authRepo.findUserByEmail(data.email);
    if (existing) throw Object.assign(new Error('E-mail já está em uso'), { status: 409 });
  }

  const updateData: { name?: string; email?: string; passwordHash?: string } = {};
  if (data.name) updateData.name = data.name;
  if (data.email) updateData.email = data.email;
  if (data.newPassword) updateData.passwordHash = await bcrypt.hash(data.newPassword, 10);

  const updated = await authRepo.updateUser(userId, updateData);

  const newBusinessName = data.businessName?.trim() || user.businessName;
  if (data.businessName?.trim() && data.businessName.trim() !== user.businessName) {
    await authRepo.updateBusiness(user.businessId, data.businessName.trim());
  }

  const token = jwt.sign(
    { userId: updated.id, businessId: user.businessId, role: updated.role },
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
      businessName: newBusinessName,
      businessSlug: user.businessSlug
    }
  };
};

export const getJwtSecret = () => JWT_SECRET;
