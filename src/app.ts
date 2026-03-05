import express from 'express';
import customerRoutes from './routes/customer.routes';
import orderRoutes from './routes/order.routes';
import errorHandler from './middlewares/errorHandler';

const app = express();
app.use(express.json());

app.use('/api/customers', customerRoutes);
app.use('/api/orders', orderRoutes);

app.use(errorHandler);

export default app;
