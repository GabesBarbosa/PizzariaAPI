import { Router } from 'express';
import * as ctrl from '../controllers/public.controller';
import { resolvePublicBusiness } from '../middlewares/publicBusiness.middleware';
import { lookupCep } from '../services/geocoding.service';

const router = Router();

// CEP lookup não depende de business
router.get('/cep/:cep', async (req, res, next) => {
  try {
    const info = await lookupCep(req.params.cep);
    if (!info) return res.status(404).json({ message: 'CEP não encontrado.' });
    res.json(info);
  } catch (err) {
    next(err);
  }
});

// Rotas por estabelecimento (resolvem via slug → AsyncLocalStorage de businessId)
router.get('/:slug/business',      resolvePublicBusiness, ctrl.getBusiness);
router.get('/:slug/menu',          resolvePublicBusiness, ctrl.getMenu);
router.get('/:slug/top-products',  resolvePublicBusiness, ctrl.getTopProducts);
router.post('/:slug/shipping',     resolvePublicBusiness, ctrl.postShipping);
router.get('/:slug/customers',     resolvePublicBusiness, ctrl.getCustomerByToken);
router.post('/:slug/customers',    resolvePublicBusiness, ctrl.postCustomer);
router.post('/:slug/orders',       resolvePublicBusiness, ctrl.postOrder);

export default router;
