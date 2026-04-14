import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes';
import customerRoutes from './routes/customer.routes';
import orderRoutes from './routes/order.routes';
import productRoutes from './routes/product.routes';
import dashboardRoutes from './routes/dashboard.routes';
import whatsappRoutes from './routes/whatsapp.routes';
import healthRoutes from './routes/health.routes';
import notificationRoutes from './routes/notification.routes';
import settingsRoutes from './routes/settings.routes';
import errorHandler from './middlewares/errorHandler';
import { authMiddleware } from './middlewares/auth.middleware';

const app = express();
app.use(express.json());

const allowedOrigins = [
  'http://localhost:4200',
  'https://nice-plant-0a66aee0f.2.azurestaticapps.net',
  'https://dashfoodapi-g8h5bmcjeefdf9f0.canadacentral-01.azurewebsites.net',
  process.env.SPA_ORIGIN
].filter(Boolean) as string[];

app.use(cors({ origin: allowedOrigins }));

// Public routes (no auth required)
app.use('/api/auth', authRoutes);
app.use('/health', healthRoutes);

// Protected routes (require JWT + tenant context)
app.use('/api/customers', authMiddleware, customerRoutes);
app.use('/api/orders', authMiddleware, orderRoutes);
app.use('/api/products', authMiddleware, productRoutes);
app.use('/api/dashboard', authMiddleware, dashboardRoutes);
app.use('/api/whatsapp', authMiddleware, whatsappRoutes);
app.use('/api/notifications', authMiddleware, notificationRoutes);
app.use('/api/settings',     authMiddleware, settingsRoutes);

app.use(errorHandler);

export default app;
