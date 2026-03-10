import { Router } from 'express';
import * as orderCtrl from '../controllers/order.controller';

const router = Router();

router.get('/', orderCtrl.listOrders);
router.post('/', orderCtrl.createOrder);
router.get('/customer/:customerId', orderCtrl.getOrdersByCustomer);
router.get('/:id', orderCtrl.getOrder);
router.put('/:id', orderCtrl.updateOrder);
router.delete('/:id', orderCtrl.deleteOrder);
router.patch('/:id/status', orderCtrl.updateOrderStatus);

export default router;
