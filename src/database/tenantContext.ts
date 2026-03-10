import { AsyncLocalStorage } from 'async_hooks';

interface TenantContext {
  tenantId: string;
  dbName: string;
  userId: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export const getTenantDb = (): string | undefined => {
  return tenantStorage.getStore()?.dbName;
};

export const getTenantContext = (): TenantContext | undefined => {
  return tenantStorage.getStore();
};
