import { Request, Response, NextFunction } from 'express';
import { businessStorage } from '../database/businessContext';
import { findBusinessBySlug, type PublicBusinessInfo } from '../repositories/settings.repository';

export interface PublicRequest extends Request {
  business?: PublicBusinessInfo;
}

/**
 * Resolve o estabelecimento pelo `:slug` na rota, popula o AsyncLocalStorage
 * de negócio e deixa as rotas públicas reutilizarem os repositórios existentes
 * sem precisar de JWT.
 */
export const resolvePublicBusiness = async (
  req: PublicRequest,
  res: Response,
  next: NextFunction,
) => {
  const slug = (req.params.slug || '').trim().toLowerCase();
  if (!slug) {
    return res.status(400).json({ message: 'Slug não informado.' });
  }

  const business = await findBusinessBySlug(slug);
  if (!business) {
    return res.status(404).json({ message: 'Estabelecimento não encontrado.' });
  }

  req.business = business;

  businessStorage.run(
    { businessId: business.id, userId: 'public-shop', role: 'public' },
    () => next(),
  );
};
