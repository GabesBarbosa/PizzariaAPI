import { Router } from 'express';
import * as orderCtrl from '../controllers/order.controller';

const router = Router();

router.post('/', orderCtrl.createOrder);
router.get('/customer/:customerId', orderCtrl.getOrdersByCustomer);
router.patch('/:id/status', orderCtrl.updateOrderStatus);

export default router;
