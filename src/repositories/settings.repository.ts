import { getPool, sql } from '../database/mssqlClient';

export const getSetting = async (key: string): Promise<string | null> => {
  const conn = await getPool();
  const result = await conn.request()
    .input('key', sql.NVarChar(100), key)
    .query('SELECT value FROM Settings WHERE [key] = @key');
  return result.recordset[0]?.value ?? null;
};

export const setSetting = async (key: string, value: string): Promise<void> => {
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
};

export const getDeliveryFee = async (): Promise<number> => {
  const v = await getSetting('deliveryFee');
  return v !== null ? parseFloat(v) : 0;
};
