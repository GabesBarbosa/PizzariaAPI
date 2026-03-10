import { Router } from 'express';
import * as productCtrl from '../controllers/product.controller';

const router = Router();

router.get('/', productCtrl.listProducts);
router.get('/:id', productCtrl.getProduct);
router.post('/', productCtrl.createProduct);
router.put('/:id', productCtrl.updateProduct);
router.delete('/:id', productCtrl.deleteProduct);

export default router;
