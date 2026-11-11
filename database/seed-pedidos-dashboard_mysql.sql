-- ============================================================
-- Seed: pedidos de teste para os gráficos do Dashboard
-- Banco: MySQL 8 (Railway)
-- Alvo: o negócio do usuário owner@owner.com
--   (para outro negócio, troque o e-mail em TODOS os comandos: Ctrl+H)
--
-- NÃO apaga nada. Usa os produtos que já estão cadastrados.
-- Cada comando é independente (sem variáveis nem tabelas temporárias),
-- então funciona em qualquer cliente, até os que abrem uma conexão por comando.
-- Pode rodar tudo de uma vez ou um comando por vez, NA ORDEM.
--
-- Cria:
--   * 15 clientes de teste (telefone começando com 5599000)
--   * ~60 dias de pedidos: fim de semana mais movimentado, picos no almoço e no
--     jantar, canais web/whatsapp/mesa/balcão, PIX/cartão/dinheiro,
--     ~7% cancelados e pedidos de hoje em andamento
--   * 1 a 3 itens por pedido, com alguns produtos virando "mais vendidos"
--
-- Todos os pedidos do seed têm notes = '[seed]'. Para remover, veja o fim do arquivo.
-- Datas gravadas em UTC, como a API grava (horário de Brasília + 3h).
-- ============================================================

-- ─── 0. Conferência: negocio não pode vir NULL e produtos precisa ser > 0 ───
SELECT u.businessId,
       (SELECT name FROM Businesses WHERE id = u.businessId) AS negocio,
       (SELECT COUNT(*) FROM Products WHERE businessId = u.businessId) AS produtos,
       (SELECT COUNT(*) FROM Customers WHERE businessId = u.businessId AND phone LIKE '5599000%') AS clientesTeste
FROM Users u WHERE u.email = 'owner@owner.com';

-- ─── 1. Clientes de teste (ignora os que já existem) ─────────
INSERT IGNORE INTO Customers (id, businessId, name, phone, cep, street, `number`, neighborhood, city, uf)
SELECT UUID(), u.businessId, c.name, c.phone, c.cep, c.street, c.num, c.bairro, 'São Paulo', 'SP'
FROM Users u
CROSS JOIN (
            SELECT 'Ana Silva'      AS name, '5599000000001' AS phone, '01310-100' AS cep, 'Av. Paulista'          AS street, '1578' AS num, 'Bela Vista'   AS bairro
  UNION ALL SELECT 'Bruno Costa',      '5599000000002', '04038-001', 'Rua Vergueiro',         '3185', 'Vila Mariana'
  UNION ALL SELECT 'Carla Mendes',     '5599000000003', '05421-001', 'Rua Oscar Freire',      '900',  'Jardins'
  UNION ALL SELECT 'Diego Rocha',      '5599000000004', '01414-001', 'Rua Augusta',           '2690', 'Consolação'
  UNION ALL SELECT 'Elisa Ferreira',   '5599000000005', '02910-000', 'Av. Nova Cantareira',   '620',  'Tremembé'
  UNION ALL SELECT 'Felipe Araújo',    '5599000000006', '04551-060', 'Rua Funchal',           '411',  'Vila Olímpia'
  UNION ALL SELECT 'Gabriela Lima',    '5599000000007', '04538-132', 'Rua Pedroso Alvarenga', '1200', 'Itaim Bibi'
  UNION ALL SELECT 'Henrique Souza',   '5599000000008', '03307-000', 'Av. Radial Leste',      '890',  'Tatuapé'
  UNION ALL SELECT 'Isabela Martins',  '5599000000009', '05652-000', 'Av. Giovanni Gronchi',  '5000', 'Morumbi'
  UNION ALL SELECT 'João Pereira',     '5599000000010', '04753-000', 'Av. Santo Amaro',       '7123', 'Santo Amaro'
  UNION ALL SELECT 'Karina Alves',     '5599000000011', '01510-001', 'Rua da Glória',         '270',  'Liberdade'
  UNION ALL SELECT 'Lucas Ribeiro',    '5599000000012', '03510-000', 'Av. Aricanduva',        '5555', 'Aricanduva'
  UNION ALL SELECT 'Mariana Gomes',    '5599000000013', '05015-000', 'Rua Cardoso de Almeida','1100', 'Perdizes'
  UNION ALL SELECT 'Nicolas Barros',   '5599000000014', '04117-000', 'Rua Domingos de Morais','2188', 'Vila Mariana'
  UNION ALL SELECT 'Olívia Teixeira',  '5599000000015', '05409-000', 'Rua Teodoro Sampaio',   '1020', 'Pinheiros'
) c
WHERE u.email = 'owner@owner.com';

-- ─── 2. Pedidos (total fica 0 até o passo 4) ─────────────────
-- 60 dias x até 14 "vagas" por dia. Dias úteis usam ~5 a 8, sex/sáb/dom ~9 a 13.
-- Os "LIMIT 100000" obrigam o MySQL a sortear cada RAND() uma vez só por linha.
INSERT INTO Orders (businessId, customerId, total, status, paymentMethod, deliveryAddress,
                    notes, deliveryFee, channel, tableNumber, createdAt, deliveredAt)
SELECT
  c.businessId,
  CASE WHEN x.canal = 'mesa' THEN NULL ELSE c.id END,
  0,
  x.status,
  x.pagamento,
  CASE WHEN x.canal IN ('web', 'whatsapp') THEN c.endereco END,
  '[seed]',
  CASE WHEN x.canal IN ('web', 'whatsapp') THEN x.taxa ELSE 0 END,
  x.canal,
  CASE WHEN x.canal = 'mesa' THEN x.mesa END,
  x.criadoUtc,
  CASE WHEN x.status = 'DELIVERED' THEN DATE_ADD(x.criadoUtc, INTERVAL x.minEntrega MINUTE) END
FROM (
  SELECT y.*,
    CASE WHEN y.rCanal < 0.45 THEN 'web'
         WHEN y.rCanal < 0.70 THEN 'whatsapp'
         WHEN y.rCanal < 0.85 THEN 'mesa'
         ELSE 'balcao' END AS canal,
    CASE WHEN y.rPag < 0.45 THEN 'PIX'
         WHEN y.rPag < 0.80 THEN 'CREDIT'
         ELSE 'CASH' END AS pagamento,
    CASE
      WHEN y.criadoUtc > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR) THEN
        CASE WHEN y.rStatus < 0.35 THEN 'RECEIVED'
             WHEN y.rStatus < 0.70 THEN 'PREPARING'
             ELSE 'OUT_FOR_DELIVERY' END
      WHEN y.rStatus < 0.07 THEN 'CANCELLED'
      ELSE 'DELIVERED' END AS status
  FROM (
    SELECT
      DATE_ADD(DATE_SUB(UTC_DATE(), INTERVAL v.d DAY),
               INTERVAL (v.horaLocal + 3) * 60 + v.minuto MINUTE) AS criadoUtc,
      v.*
    FROM (
      SELECT
        s.n DIV 14 AS d,
        CAST(ELT(1 + FLOOR(RAND() * 20),
                 11,12,12,12,13,13, 18,19,19,19,20,20,20,20,21,21,21,22,22,23) AS UNSIGNED) AS horaLocal,
        FLOOR(RAND() * 60)      AS minuto,
        RAND()                  AS rCanal,
        RAND()                  AS rPag,
        RAND()                  AS rStatus,
        ELT(1 + FLOOR(RAND() * 3), 5.00, 8.00, 12.00) AS taxa,
        FLOOR(RAND() * 1000)    AS rCliente,
        1 + FLOOR(RAND() * 12)  AS mesa,
        25 + FLOOR(RAND() * 40) AS minEntrega
      FROM (
        SELECT a.i + b.i * 10 + c.i * 100 AS n
        FROM (SELECT 0 i UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
              UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) a
        CROSS JOIN
             (SELECT 0 i UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
              UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) b
        CROSS JOIN
             (SELECT 0 i UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
              UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8) c
      ) s
      WHERE s.n < 60 * 14
        AND s.n MOD 14 < CASE
              WHEN DAYOFWEEK(DATE_SUB(CURDATE(), INTERVAL s.n DIV 14 DAY)) IN (1, 6, 7) THEN 9 + FLOOR(RAND() * 5)
              ELSE 5 + FLOOR(RAND() * 4) END
      LIMIT 100000
    ) v
    LIMIT 100000
  ) y
  WHERE y.criadoUtc <= UTC_TIMESTAMP()   -- nada no futuro
  LIMIT 100000
) x
JOIN (
  SELECT cu.id, cu.businessId,
         CONCAT(cu.street, ', ', cu.`number`, ' - ', cu.neighborhood) AS endereco,
         ROW_NUMBER() OVER (ORDER BY cu.phone) AS rn,
         COUNT(*) OVER () AS qtd
  FROM Customers cu
  JOIN Users u ON u.businessId = cu.businessId AND u.email = 'owner@owner.com'
  WHERE cu.phone LIKE '5599000%'
) c ON c.rn = 1 + MOD(x.rCliente, c.qtd);

-- ─── 3. Itens (1 a 3 por pedido, sorteio puxado para alguns produtos) ───
INSERT INTO OrderItems (id, orderId, productId, quantity, unitPrice, finalPrice)
SELECT UUID(), i.orderId, p.id, i.qtd, p.price, p.price
FROM (
  SELECT o.id AS orderId,
         RAND() AS r,
         CASE WHEN RAND() < 0.8 THEN 1 ELSE 2 END AS qtd
  FROM Orders o
  JOIN Users u ON u.businessId = o.businessId AND u.email = 'owner@owner.com'
  JOIN (SELECT 1 AS k UNION ALL SELECT 2 UNION ALL SELECT 3) k
    ON k.k <= 1 + MOD(o.id, 3)
  WHERE o.notes = '[seed]'
    AND NOT EXISTS (SELECT 1 FROM OrderItems oi WHERE oi.orderId = o.id)
  LIMIT 100000
) i
JOIN (
  SELECT pr.id, pr.price,
         ROW_NUMBER() OVER (ORDER BY CRC32(pr.id)) AS rn,
         COUNT(*) OVER () AS qtd
  FROM Products pr
  JOIN Users u ON u.businessId = pr.businessId AND u.email = 'owner@owner.com'
) p ON p.rn = 1 + FLOOR(POW(i.r, 1.8) * p.qtd);

-- ─── 4. Total = itens + taxa de entrega ──────────────────────
UPDATE Orders o
JOIN Users u ON u.businessId = o.businessId AND u.email = 'owner@owner.com'
JOIN (SELECT orderId, SUM(quantity * finalPrice) AS itens FROM OrderItems GROUP BY orderId) t
  ON t.orderId = o.id
SET o.total = t.itens + o.deliveryFee
WHERE o.notes = '[seed]' AND o.total = 0;

-- ─── 5. Resultado ────────────────────────────────────────────
SELECT COUNT(*) AS pedidosSeed,
       MIN(o.createdAt) AS primeiro, MAX(o.createdAt) AS ultimo,
       ROUND(SUM(o.total), 2) AS faturamento,
       SUM(o.total = 0) AS semItens
FROM Orders o
JOIN Users u ON u.businessId = o.businessId AND u.email = 'owner@owner.com'
WHERE o.notes = '[seed]';

-- ============================================================
-- REMOVER os dados do seed (rode só se quiser limpar):
--
-- DELETE oi FROM OrderItems oi
--   JOIN Orders o ON o.id = oi.orderId
--   JOIN Users u ON u.businessId = o.businessId AND u.email = 'owner@owner.com'
--   WHERE o.notes = '[seed]';
-- DELETE o FROM Orders o
--   JOIN Users u ON u.businessId = o.businessId AND u.email = 'owner@owner.com'
--   WHERE o.notes = '[seed]';
-- DELETE c FROM Customers c
--   JOIN Users u ON u.businessId = c.businessId AND u.email = 'owner@owner.com'
--   WHERE c.phone LIKE '5599000%'
--     AND NOT EXISTS (SELECT 1 FROM Orders o WHERE o.customerId = c.id);
-- ============================================================
