import { Request, Response, NextFunction } from 'express';
import { getDeliveryFee, setSetting } from '../repositories/settings.repository';

export const getSettings = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const deliveryFee = await getDeliveryFee();
    res.json({ deliveryFee });
  } catch (err) {
    next(err);
  }
};

export const updateDeliveryFee = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fee = parseFloat(req.body.deliveryFee);
    if (isNaN(fee) || fee < 0) {
      res.status(400).json({ message: 'Valor inválido para taxa de entrega.' });
      return;
    }
    await setSetting('deliveryFee', fee.toFixed(2));
    res.json({ deliveryFee: fee });
  } catch (err) {
    next(err);
  }
};
