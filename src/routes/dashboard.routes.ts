import { Router } from 'express';
import * as dashboardCtrl from '../controllers/dashboard.controller';

const router = Router();

router.get('/stats', dashboardCtrl.getStats);
router.get('/analytics', dashboardCtrl.getAnalytics);
router.get('/customer-analytics', dashboardCtrl.getCustomerAnalytics);
router.get('/export/orders', dashboardCtrl.exportOrdersCsv);   // ?from=2026-11-01&to=2026-11-30
router.get('/export/summary', dashboardCtrl.exportSummary);

export default router;
