-- Adiciona coluna de imagem base64 na tabela Products
-- Já incluída no init_mysql.sql — só rode se precisar adicionar em banco existente (sem essa coluna)

ALTER TABLE Products ADD COLUMN imageBase64 LONGTEXT NULL;
