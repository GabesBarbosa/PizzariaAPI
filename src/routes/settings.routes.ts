import { Router } from 'express';
import * as settingsCtrl from '../controllers/settings.controller';

const router = Router();

router.get('/',                  settingsCtrl.getSettings);
router.put('/delivery-fee',      settingsCtrl.updateDeliveryFee);
router.put('/chatbot-mode',      settingsCtrl.updateChatbotMode);
router.put('/business-type',     settingsCtrl.updateBusinessType);
router.put('/crust-options',     settingsCtrl.updateCrustOptions);
router.put('/size-options',      settingsCtrl.updateSizeOptions);
router.put('/payment-methods',   settingsCtrl.updatePaymentMethods);
router.put('/chatbot-enabled',   settingsCtrl.updateChatbotEnabled);
router.get('/business-origin',   settingsCtrl.getOrigin);
router.put('/business-origin',   settingsCtrl.updateOrigin);
router.get('/delivery-zones',    settingsCtrl.getZones);
router.put('/delivery-zones',    settingsCtrl.updateZones);
router.get('/tables',            settingsCtrl.getTables);
router.put('/tables',            settingsCtrl.updateTables);

export default router;
