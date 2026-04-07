import { getPool, sql } from '../database/mssqlClient';
import logger from '../utils/logger';

const DEFAULT_DELIVERY_FEE = 5;

async function ensureSettingsTable(conn: any): Promise<void> {
  await conn.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Settings')
    BEGIN
      CREATE TABLE Settings (
        [key]     NVARCHAR(100) NOT NULL PRIMARY KEY,
        value     NVARCHAR(500) NOT NULL,
        updatedAt DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
      );
      INSERT INTO Settings ([key], value) VALUES ('deliveryFee', '${DEFAULT_DELIVERY_FEE}');
    END
  `);
}

export const getSetting = async (key: string): Promise<string | null> => {
  try {
    const conn = await getPool();
    const result = await conn.request()
      .input('key', sql.NVarChar(100), key)
      .query('SELECT value FROM Settings WHERE [key] = @key');
    return result.recordset[0]?.value ?? null;
  } catch (err: any) {
    if (err.message?.includes("Invalid object name 'Settings'")) {
      logger.warn('[Settings] Tabela Settings não existe — criando automaticamente...');
      const conn = await getPool();
      await ensureSettingsTable(conn);
      const result = await conn.request()
        .input('key', sql.NVarChar(100), key)
        .query('SELECT value FROM Settings WHERE [key] = @key');
      return result.recordset[0]?.value ?? null;
    }
    throw err;
  }
};

export const setSetting = async (key: string, value: string): Promise<void> => {
  try {
    const conn = await getPool();
    await conn.request()
      .input('key',   sql.NVarChar(100), key)
      .input('value', sql.NVarChar(500), value)
      .query(`
        MERGE Settings AS target
        USING (SELECT @key AS [key], @value AS value) AS source
          ON target.[key] = source.[key]
        WHEN MATCHED    THEN UPDATE SET value = source.value, updatedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT ([key], value) VALUES (source.[key], source.value);
      `);
  } catch (err: any) {
    if (err.message?.includes("Invalid object name 'Settings'")) {
      logger.warn('[Settings] Tabela Settings não existe — criando automaticamente...');
      const conn = await getPool();
      await ensureSettingsTable(conn);
      await setSetting(key, value);
    } else {
      throw err;
    }
  }
};

export type ChatbotMode = 'ai' | 'triggers';

export const getChatbotMode = async (): Promise<ChatbotMode> => {
  try {
    const v = await getSetting('chatbotMode');
    return (v === 'ai' ? 'ai' : 'triggers') as ChatbotMode;
  } catch {
    return 'triggers';
  }
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
