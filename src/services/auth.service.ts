import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import * as authRepo from '../repositories/auth.repository';
import { setSettingForBusiness } from '../repositories/settings.repository';
import { LoginDTO, RegisterDTO } from '../dtos/auth.dto';
import { sendEmail } from './email.service';
import { HttpError } from '../utils/errors';
import logger from '../utils/logger';

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

/* ─── Recuperação de senha por e-mail (RF05) ─── */

const RESET_MINUTES = 30;
const MIN_PASSWORD_LENGTH = 8;
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function spaOrigin(): string {
  return (process.env.SPA_ORIGIN || 'https://dashfood-rose.vercel.app').replace(/\/$/, '');
}

/**
 * Gera um link de uso único e envia por e-mail.
 * Não lança erro quando o e-mail não existe: quem chama responde sempre a mesma
 * mensagem, para não revelar quais e-mails têm conta.
 */
export const forgotPassword = async (rawEmail: string): Promise<void> => {
  const email = (rawEmail || '').trim().toLowerCase();
  if (!email) return;

  const user = await authRepo.findUserByEmail(email);
  if (!user || !user.active || !user.businessActive) return;

  const token = crypto.randomBytes(32).toString('hex');
  await authRepo.invalidateUserResets(user.id);
  await authRepo.createPasswordReset(user.id, sha256(token), RESET_MINUTES);

  const link = `${spaOrigin()}/redefinir-senha?token=${token}`;
  const text = [
    `Olá, ${user.name}!`,
    '',
    'Recebemos um pedido para redefinir a senha da sua conta no DashFood.',
    `Clique no link abaixo para criar uma nova senha (válido por ${RESET_MINUTES} minutos):`,
    '',
    link,
    '',
    'Se não foi você, ignore este e-mail. Sua senha continua a mesma.',
  ].join('\n');
  const html =
    `<p>Olá, ${escapeHtml(user.name)}!</p>` +
    `<p>Recebemos um pedido para redefinir a senha da sua conta no DashFood.</p>` +
    `<p><a href="${link}">Clique aqui para criar uma nova senha</a> (válido por ${RESET_MINUTES} minutos).</p>` +
    `<p>Se não foi você, ignore este e-mail. Sua senha continua a mesma.</p>`;

  // Sem await: a resposta sai no mesmo tempo exista ou não a conta, e uma falha
  // no envio não muda a resposta (o que revelaria que o e-mail é cadastrado).
  sendEmail(user.email, 'DashFood – Redefinição de senha', text, html).catch((err: any) => {
    logger.error(`[Auth] Não foi possível enviar o link de redefinição: ${err.message}`);
  });
};

export const resetPassword = async (token: string, newPassword: string): Promise<void> => {
  if (!token || typeof token !== 'string') throw new HttpError('Link inválido ou expirado', 400);
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(`A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`, 400);
  }

  const reset = await authRepo.findValidReset(sha256(token));
  if (!reset) throw new HttpError('Link inválido ou expirado', 400);

  // Marca antes de trocar a senha: se dois pedidos usarem o mesmo link ao mesmo tempo, só um passa.
  const claimed = await authRepo.markResetUsed(reset.id);
  if (!claimed) throw new HttpError('Link inválido ou expirado', 400);

  await authRepo.updateUser(reset.userId, { passwordHash: await bcrypt.hash(newPassword, 10) });
};

function escapeHtml(s: string): string {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export const getJwtSecret = () => JWT_SECRET;
