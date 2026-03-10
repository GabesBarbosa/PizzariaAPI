import { Router } from 'express';
import * as authCtrl from '../controllers/auth.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

router.post('/login', authCtrl.login);
router.post('/register', authCtrl.register);
router.get('/me', authMiddleware, authCtrl.me);
router.put('/profile', authMiddleware, authCtrl.updateProfile);

export default router;
