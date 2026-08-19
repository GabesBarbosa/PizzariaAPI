import { Router } from 'express';
import * as productCtrl from '../controllers/product.controller';

const router = Router();

router.get('/', productCtrl.listProducts);
router.get('/estoque-baixo', productCtrl.listLowStock);
router.get('/:id', productCtrl.getProduct);
router.post('/', productCtrl.createProduct);
router.put('/:id', productCtrl.updateProduct);
router.delete('/:id', productCtrl.deleteProduct);

// Estoque
router.patch('/:id/stock', productCtrl.updateStock);

// Variations
router.get('/:id/variations', productCtrl.listVariations);
router.post('/:id/variations', productCtrl.createVariation);
router.put('/:id/variations/:vid', productCtrl.updateVariation);
router.delete('/:id/variations/:vid', productCtrl.deleteVariation);

export default router;
