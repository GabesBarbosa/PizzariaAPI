-- Adiciona coluna de imagem base64 na tabela Products
-- Execute no banco: dashfoodDB

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'Products' AND COLUMN_NAME = 'imageBase64'
)
  ALTER TABLE Products ADD imageBase64 NVARCHAR(MAX) NULL;

PRINT 'Coluna imageBase64 adicionada (ou já existia).';
