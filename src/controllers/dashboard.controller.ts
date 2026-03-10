import { Request, Response, NextFunction } from 'express';
import * as dashboardService from '../services/dashboard.service';

const VALID_PERIODS = ['day', 'week', 'month'];

function parsePeriod(req: Request): string {
  const p = (req.query.period as string || 'week').toLowerCase();
  return VALID_PERIODS.includes(p) ? p : 'week';
}

export const getStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await dashboardService.getDashboardStats(parsePeriod(req));
    res.json(stats);
  } catch (err) {
    next(err);
  }
};

export const getAnalytics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const analytics = await dashboardService.getAnalytics(parsePeriod(req));
    res.json(analytics);
  } catch (err) {
    next(err);
  }
};

export const getCustomerAnalytics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await dashboardService.getCustomerAnalytics(parsePeriod(req));
    res.json(data);
  } catch (err) {
    next(err);
  }
};
