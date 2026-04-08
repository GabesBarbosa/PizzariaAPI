import { getPool, sql } from '../database/mssqlClient';
import { getBusinessContext } from '../database/businessContext';
import logger from '../utils/logger';

const DEFAULT_DELIVERY_FEE = 5;

// Promise-lock: todas as chamadas concorrentes aguardam a mesma migração
let migrationLock: Promise<void> | null = null;
let migrationDone = false;

async function ensureSettingsTable(conn: any): Promise<void> {
  // Já migrou nesta execução — retorna imediatamente
  if (migrationDone) return;

  // Já há uma migração em curso — aguarda ela terminar
  if (migrationLock) {
    await migrationLock;
    return;
  }

  migrationLock = (async () => {
    try {
      // Cria tabela com businessId se não existir
      await conn.request().query(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Settings')
        BEGIN
          CREATE TABLE Settings (
            businessId  UNIQUEIDENTIFIER NOT NULL,
            [key]       NVARCHAR(100)    NOT NULL,
            value       NVARCHAR(500)    NOT NULL,
            updatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
            PRIMARY KEY (businessId, [key])
          );
        END
      `);

      // Migração: se a tabela existe mas sem a coluna businessId
      const colExists = await conn.request().query(`
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'Settings' AND COLUMN_NAME = 'businessId'
      `);
      if (colExists.recordset.length === 0) {
        logger.warn('[Settings] Migrando tabela Settings para schema multi-tenant...');

        const pkResult = await conn.request().query(`
          SELECT kc.name AS constraintName
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          JOIN sys.key_constraints kc ON kc.name = tc.CONSTRAINT_NAME
          WHERE tc.TABLE_NAME = 'Settings' AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        `);

        await conn.request().query(`
          ALTER TABLE Settings ADD businessId UNIQUEIDENTIFIER NULL;
          UPDATE Settings SET businessId = '00000000-0000-0000-0000-000000000000';
          ALTER TABLE Settings ALTER COLUMN businessId UNIQUEIDENTIFIER NOT NULL;
        `);

        if (pkResult.recordset.length > 0) {
          const pkName = pkResult.recordset[0].constraintName;
          await conn.request().query(`ALTER TABLE Settings DROP CONSTRAINT [${pkName}]`);
        }

        await conn.request().query(`ALTER TABLE Settings ADD PRIMARY KEY (businessId, [key])`);
        logger.warn('[Settings] Migração concluída.');
      }

      migrationDone = true;
    } finally {
      migrationLock = null;
    }
  })();

  await migrationLock;
}

export const getSetting = async (key: string): Promise<string | null> => {
  const { businessId } = getBusinessContext()!;
  try {
    const conn = await getPool();
    const result = await conn.request()
      .input('businessId', sql.UniqueIdentifier, businessId)
      .input('key', sql.NVarChar(100), key)
      .query('SELECT value FROM Settings WHERE businessId = @businessId AND [key] = @key');
    return result.recordset[0]?.value ?? null;
  } catch (err: any) {
    if (err.message?.includes("Invalid object name 'Settings'") || err.message?.includes('Invalid column name')) {
      logger.warn('[Settings] Tabela Settings ausente ou desatualizada — criando/migrando...');
      const conn = await getPool();
      await ensureSettingsTable(conn);
      const result = await conn.request()
        .input('businessId', sql.UniqueIdentifier, businessId)
        .input('key', sql.NVarChar(100), key)
        .query('SELECT value FROM Settings WHERE businessId = @businessId AND [key] = @key');
      return result.recordset[0]?.value ?? null;
    }
    throw err;
  }
};

export const setSetting = async (key: string, value: string): Promise<void> => {
  const { businessId } = getBusinessContext()!;
  try {
    const conn = await getPool();
    await conn.request()
      .input('businessId', sql.UniqueIdentifier, businessId)
      .input('key',   sql.NVarChar(100), key)
      .input('value', sql.NVarChar(500), value)
      .query(`
        MERGE Settings AS target
        USING (SELECT @businessId AS businessId, @key AS [key], @value AS value) AS source
          ON target.businessId = source.businessId AND target.[key] = source.[key]
        WHEN MATCHED    THEN UPDATE SET value = source.value, updatedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (businessId, [key], value) VALUES (source.businessId, source.[key], source.value);
      `);
  } catch (err: any) {
    if (err.message?.includes("Invalid object name 'Settings'") || err.message?.includes('Invalid column name')) {
      logger.warn('[Settings] Tabela Settings ausente ou desatualizada — criando/migrando...');
      const conn = await getPool();
      await ensureSettingsTable(conn);
      await setSetting(key, value);
    } else {
      throw err;
    }
  }
};

export type ChatbotMode = 'ai' | 'triggers';
export type BusinessType = 'pizzaria' | 'hamburgueria' | 'generic';

export const setSettingForBusiness = async (businessId: string, key: string, value: string): Promise<void> => {
  const conn = await getPool();
  await conn.request()
    .input('businessId', sql.UniqueIdentifier, businessId)
    .input('key', sql.NVarChar(100), key)
    .input('value', sql.NVarChar(500), value)
    .query(`
      MERGE Settings AS target
      USING (SELECT @businessId AS businessId, @key AS [key], @value AS value) AS source
        ON target.businessId = source.businessId AND target.[key] = source.[key]
      WHEN MATCHED    THEN UPDATE SET value = source.value, updatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (businessId, [key], value) VALUES (source.businessId, source.[key], source.value);
    `);
};

export const getBusinessType = async (): Promise<BusinessType> => {
  try {
    const v = await getSetting('businessType');
    if (v === 'pizzaria') return 'pizzaria';
    if (v === 'generic')  return 'generic';
    return 'hamburgueria'; // default quando não configurado
  } catch {
    return 'hamburgueria';
  }
};

export const setBusinessType = async (type: BusinessType): Promise<void> => {
  await setSetting('businessType', type);
};

export const getChatbotMode = async (): Promise<ChatbotMode> => {
  try {
    const v = await getSetting('chatbotMode');
    return (v === 'ai' ? 'ai' : 'triggers') as ChatbotMode;
  } catch {
    return 'triggers';
  }
};

export const getChatbotEnabled = async (): Promise<boolean> => {
  try {
    const v = await getSetting('chatbotEnabled');
    return v !== 'false'; // default: enabled
  } catch {
    return true;
  }
};

export const setChatbotEnabled = async (enabled: boolean): Promise<void> => {
  await setSetting('chatbotEnabled', enabled ? 'true' : 'false');
};

export const getDeliveryFee = async (): Promise<number> => {
  try {
    const v = await getSetting('deliveryFee');
    return v !== null ? parseFloat(v) : DEFAULT_DELIVERY_FEE;
  } catch (err: any) {
    logger.warn(`[Settings] getDeliveryFee falhou: ${err.message} — usando padrão ${DEFAULT_DELIVERY_FEE}`);
    return DEFAULT_DELIVERY_FEE;
  }
};

/* ─── Chatbot Config dinâmica por business ─── */

export interface CrustOption {
  label: string;
  price: number;
}

export interface SizeOption {
  label: string;
  maxFlavors: number;
  multiplier: number;
}

export interface PaymentOption {
  key: string;
  label: string;
}

export interface ChatbotConfig {
  businessName: string;
  crustOptions: CrustOption[];
  sizeOptions: Record<string, SizeOption>;
  paymentMethods: PaymentOption[];
}

const DEFAULT_CRUST_OPTIONS: CrustOption[] = [
  { label: 'Catupiry Original', price: 8.00 },
  { label: 'Cheddar',           price: 8.00 },
  { label: 'Chocolate',         price: 8.00 },
];

const DEFAULT_SIZE_OPTIONS: Record<string, SizeOption> = {
  normal:   { label: 'Normal',   maxFlavors: 2, multiplier: 1.00 },
  brotinho: { label: 'Pequeno',  maxFlavors: 1, multiplier: 0.65 },
};

const DEFAULT_PAYMENT_METHODS: PaymentOption[] = [
  { key: 'PIX',    label: 'PIX' },
  { key: 'CREDIT', label: 'Cartão (levar maquininha)' },
  { key: 'CASH',   label: 'Dinheiro' },
];

export const getBusinessName = async (): Promise<string> => {
  const { businessId } = getBusinessContext()!;
  try {
    const conn = await getPool();
    const result = await conn.request()
      .input('id', sql.UniqueIdentifier, businessId)
      .query('SELECT name FROM Businesses WHERE id = @id');
    return result.recordset[0]?.name ?? 'Nosso Delivery';
  } catch (err: any) {
    logger.warn(`[Settings] getBusinessName falhou: ${err.message}`);
    return 'Nosso Delivery';
  }
};

export const getCrustOptions = async (): Promise<CrustOption[]> => {
  try {
    const v = await getSetting('crustOptions');
    if (v) return JSON.parse(v) as CrustOption[];
  } catch { /* usa default */ }
  return DEFAULT_CRUST_OPTIONS;
};

export const setCrustOptions = async (options: CrustOption[]): Promise<void> => {
  await setSetting('crustOptions', JSON.stringify(options));
};

export const getSizeOptions = async (): Promise<Record<string, SizeOption>> => {
  try {
    const v = await getSetting('sizeOptions');
    if (v) return JSON.parse(v) as Record<string, SizeOption>;
  } catch { /* usa default */ }
  return DEFAULT_SIZE_OPTIONS;
};

export const setSizeOptions = async (options: Record<string, SizeOption>): Promise<void> => {
  await setSetting('sizeOptions', JSON.stringify(options));
};

export const getPaymentMethods = async (): Promise<PaymentOption[]> => {
  try {
    const v = await getSetting('paymentMethods');
    if (v) return JSON.parse(v) as PaymentOption[];
  } catch { /* usa default */ }
  return DEFAULT_PAYMENT_METHODS;
};

export const setPaymentMethods = async (options: PaymentOption[]): Promise<void> => {
  await setSetting('paymentMethods', JSON.stringify(options));
};

export const getChatbotConfig = async (): Promise<ChatbotConfig> => {
  const [businessName, crustOptions, sizeOptions, paymentMethods] = await Promise.all([
    getBusinessName(),
    getCrustOptions(),
    getSizeOptions(),
    getPaymentMethods(),
  ]);
  return { businessName, crustOptions, sizeOptions, paymentMethods };
};
