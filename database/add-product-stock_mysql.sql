-- Adiciona controle de estoque na tabela Products
-- Já incluída no init_mysql.sql — só rode se precisar adicionar em banco existente (sem essa coluna)
--
-- Semântica:
--   stockQuantity IS NULL -> produto sem controle de estoque (sempre disponível no cardápio)
--   stockQuantity = 0     -> esgotado (aparece no cardápio marcado como "Esgotado")
--   stockQuantity > 0     -> quantidade disponível; cada pedido dá baixa automática

ALTER TABLE Products ADD COLUMN stockQuantity INT NULL;
