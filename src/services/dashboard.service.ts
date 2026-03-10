import * as dashboardRepo from '../repositories/dashboard.repository';
import * as customerDashboardRepo from '../repositories/customer-dashboard.repository';

export const getDashboardStats = async (period: string = 'week') => {
  return dashboardRepo.getStats(period);
};

export const getAnalytics = async (period: string = 'week') => {
  return dashboardRepo.getAnalytics(period);
};

export const getCustomerAnalytics = async (period: string = 'week') => {
  return customerDashboardRepo.getCustomerAnalytics(period);
};
