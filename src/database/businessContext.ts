import { AsyncLocalStorage } from 'async_hooks';

export interface BusinessContext {
  businessId: string;
  userId: string;
  role: string;
}

export const businessStorage = new AsyncLocalStorage<BusinessContext>();

export const getBusinessContext = (): BusinessContext | undefined => {
  return businessStorage.getStore();
};
