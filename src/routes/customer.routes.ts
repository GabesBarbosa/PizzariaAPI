import { Router } from 'express';
import * as customerCtrl from '../controllers/customer.controller';

const router = Router();

router.post('/', customerCtrl.createCustomer);
router.get('/', customerCtrl.searchCustomers); // ?q=term
router.get('/:id', customerCtrl.getCustomer);

export default router;
