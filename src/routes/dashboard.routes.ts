import { Router } from 'express';
import * as dashboardCtrl from '../controllers/dashboard.controller';

const router = Router();

router.get('/stats', dashboardCtrl.getStats);
router.get('/analytics', dashboardCtrl.getAnalytics);
router.get('/customer-analytics', dashboardCtrl.getCustomerAnalytics);

export default router;
