import { Router } from 'express';
import * as whatsappCtrl from '../controllers/whatsapp.controller';

const router = Router();

router.get('/status', whatsappCtrl.getStatus);
router.post('/send', whatsappCtrl.sendMessage);
router.post('/send-bulk', whatsappCtrl.sendBulk);
router.post('/send-all', whatsappCtrl.sendToAllCustomers);

export default router;
