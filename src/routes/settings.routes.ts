import { Router } from 'express';
import * as settingsCtrl from '../controllers/settings.controller';

const router = Router();

router.get('/',            settingsCtrl.getSettings);
router.put('/delivery-fee', settingsCtrl.updateDeliveryFee);

export default router;
