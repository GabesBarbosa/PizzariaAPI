-- ============================================================
-- Seed: cardápio completo de hamburgueria
-- Alvo: o negócio (Businesses) do usuário owner@owner.com
-- Banco: MySQL (Railway)
--
-- Fonte dos dados: seed-hamburgueria-produtos.csv
--                  seed-hamburgueria-variacoes.csv
--
-- Rode o arquivo inteiro de uma vez: a variável @businessId
-- precisa sobreviver até o fim da sessão.
-- ============================================================

-- ─── 1. Resolve o negócio a partir do e-mail ───────────────
SET @businessId = (SELECT businessId FROM Users WHERE email = 'owner@owner.com' LIMIT 1);

-- CONFIRA ESTE RESULTADO ANTES DE SEGUIR.
-- Se vier NULL, o e-mail não existe — pare aqui e rode:
--   SELECT email FROM Users;
  SELECT @businessId AS businessId,
       (SELECT name FROM Businesses WHERE id = @businessId) AS negocio;

-- ─── 2. Produtos ───────────────────────────────────────────
INSERT INTO Products (id, businessId, name, description, price, category)
SELECT UUID(), @businessId, d.name, d.description, d.price, d.category
FROM (
  SELECT 'X-Burger' AS name, 'Pão brioche, hambúrguer 160g, queijo prato, alface, tomate e maionese da casa' AS description, 22.90 AS price, 'Lanches' AS category
  UNION ALL SELECT 'X-Salada','Pão brioche, hambúrguer 160g, queijo prato, alface, tomate, cebola roxa e maionese verde',24.90,'Lanches'
  UNION ALL SELECT 'X-Bacon','Pão brioche, hambúrguer 160g, queijo cheddar, bacon crocante e maionese defumada',27.90,'Lanches'
  UNION ALL SELECT 'X-Egg','Pão brioche, hambúrguer 160g, queijo prato, ovo frito, alface e tomate',25.90,'Lanches'
  UNION ALL SELECT 'X-Calabresa','Pão brioche, hambúrguer 160g, calabresa fatiada, queijo prato e cebola caramelizada',26.90,'Lanches'
  UNION ALL SELECT 'X-Frango','Pão brioche, filé de frango grelhado, queijo prato, alface, tomate e maionese',25.90,'Lanches'
  UNION ALL SELECT 'X-Tudo','Pão brioche, dois hambúrgueres 160g, queijo prato, cheddar, bacon, ovo, presunto, alface, tomate e batata palha',34.90,'Lanches'
  UNION ALL SELECT 'X-Costela','Pão australiano, costela desfiada 180g, queijo prato, cebola caramelizada e barbecue',32.90,'Lanches'
  UNION ALL SELECT 'Cheddar Melt','Pão brioche, hambúrguer 160g, cheddar cremoso, bacon e cebola crispy',31.90,'Lanches'
  UNION ALL SELECT 'Smash Duplo','Pão de batata, dois smash burgers 90g, queijo cheddar e molho especial',29.90,'Lanches'
  UNION ALL SELECT 'Burger Vegetariano','Pão integral, hambúrguer de grão-de-bico, queijo branco, rúcula, tomate seco e maionese de ervas',26.90,'Lanches'
  UNION ALL SELECT 'Kids Burger','Pão brioche, hambúrguer 90g, queijo prato e batata frita porção pequena',18.90,'Lanches'

  UNION ALL SELECT 'Combo X-Burger','X-Burger + batata frita 150g + refrigerante lata 350ml',32.90,'Combos'
  UNION ALL SELECT 'Combo X-Bacon','X-Bacon + batata frita 150g + refrigerante lata 350ml',37.90,'Combos'
  UNION ALL SELECT 'Combo X-Tudo','X-Tudo + batata frita 250g + refrigerante lata 350ml',44.90,'Combos'
  UNION ALL SELECT 'Combo Smash Duplo','Smash Duplo + onion rings + refrigerante lata 350ml',39.90,'Combos'

  UNION ALL SELECT 'Batata Frita','Porção de batata frita crocante 250g com sal e alecrim',18.90,'Porções'
  UNION ALL SELECT 'Batata Cheddar Bacon','Batata frita 250g coberta com cheddar cremoso e bacon crocante',28.90,'Porções'
  UNION ALL SELECT 'Onion Rings','Anéis de cebola empanados 200g com molho barbecue',22.90,'Porções'
  UNION ALL SELECT 'Nuggets','10 unidades de nuggets de frango empanados com molho da casa',19.90,'Porções'
  UNION ALL SELECT 'Frango a Passarinho','Porção de frango a passarinho 500g com alho frito e limão',34.90,'Porções'
  UNION ALL SELECT 'Isca de Calabresa','Calabresa acebolada 400g com pão de alho',29.90,'Porções'
  UNION ALL SELECT 'Mandioca Frita','Porção de mandioca frita 350g com maionese da casa',21.90,'Porções'

  UNION ALL SELECT 'Coca-Cola','Refrigerante Coca-Cola gelado',7.00,'Bebidas'
  UNION ALL SELECT 'Coca-Cola Zero','Refrigerante Coca-Cola Zero gelado',7.00,'Bebidas'
  UNION ALL SELECT 'Guaraná Antarctica','Refrigerante Guaraná Antarctica gelado',6.50,'Bebidas'
  UNION ALL SELECT 'Sprite','Refrigerante Sprite gelado',6.50,'Bebidas'
  UNION ALL SELECT 'Suco de Laranja','Suco natural de laranja 500ml',9.90,'Bebidas'
  UNION ALL SELECT 'Suco de Maracujá','Suco natural de maracujá 500ml',9.90,'Bebidas'
  UNION ALL SELECT 'Limonada Suíça','Limonada suíça 500ml',10.90,'Bebidas'
  UNION ALL SELECT 'Água Mineral','Água mineral sem gás 500ml',4.00,'Bebidas'
  UNION ALL SELECT 'Água com Gás','Água mineral com gás 500ml',5.00,'Bebidas'
  UNION ALL SELECT 'Cerveja Heineken','Cerveja Heineken long neck 330ml',12.90,'Bebidas'
  UNION ALL SELECT 'Cerveja Budweiser','Cerveja Budweiser long neck 330ml',9.90,'Bebidas'
  UNION ALL SELECT 'Milkshake de Chocolate','Milkshake de chocolate 400ml com chantilly',16.90,'Bebidas'
  UNION ALL SELECT 'Milkshake de Morango','Milkshake de morango 400ml com chantilly',16.90,'Bebidas'

  UNION ALL SELECT 'Petit Gateau','Bolo de chocolate com recheio cremoso e sorvete de creme',19.90,'Sobremesas'
  UNION ALL SELECT 'Brownie com Sorvete','Brownie de chocolate meio amargo com sorvete de creme e calda quente',17.90,'Sobremesas'
  UNION ALL SELECT 'Pudim de Leite','Pudim de leite condensado com calda de caramelo',12.90,'Sobremesas'
  UNION ALL SELECT 'Açaí na Tigela','Açaí 400ml com banana e granola',21.90,'Sobremesas'
) AS d
-- Não duplica se o script rodar duas vezes.
WHERE NOT EXISTS (
  SELECT 1 FROM Products p
  WHERE p.businessId = @businessId AND p.name = d.name
);

-- ─── 3. Adicionais e remoções dos Lanches ──────────────────
INSERT INTO ProductVariations (id, productId, businessId, name, type, priceModifier)
SELECT UUID(), p.id, @businessId, v.name, v.type, v.priceModifier
FROM Products p
CROSS JOIN (
            SELECT 'Bacon extra' AS name, 'addon' AS type, 6.00 AS priceModifier
  UNION ALL SELECT 'Queijo extra','addon',4.00
  UNION ALL SELECT 'Hambúrguer extra 160g','addon',12.00
  UNION ALL SELECT 'Cheddar cremoso','addon',5.00
  UNION ALL SELECT 'Catupiry','addon',5.00
  UNION ALL SELECT 'Ovo frito','addon',3.00
  UNION ALL SELECT 'Cebola caramelizada','addon',4.00
  UNION ALL SELECT 'Cebola crispy','addon',4.00
  UNION ALL SELECT 'Salada completa','addon',2.00
  UNION ALL SELECT 'Molho barbecue','addon',2.50
  UNION ALL SELECT 'Sem cebola','removal',0.00
  UNION ALL SELECT 'Sem tomate','removal',0.00
  UNION ALL SELECT 'Sem alface','removal',0.00
  UNION ALL SELECT 'Sem maionese','removal',0.00
  UNION ALL SELECT 'Sem picles','removal',0.00
) AS v
WHERE p.businessId = @businessId
  AND p.category = 'Lanches'
  AND NOT EXISTS (
    SELECT 1 FROM ProductVariations pv
    WHERE pv.productId = p.id AND pv.name = v.name
  );

-- ─── 4. Adicionais das Porções ─────────────────────────────
INSERT INTO ProductVariations (id, productId, businessId, name, type, priceModifier)
SELECT UUID(), p.id, @businessId, v.name, v.type, v.priceModifier
FROM Products p
CROSS JOIN (
            SELECT 'Cheddar cremoso' AS name, 'addon' AS type, 7.00 AS priceModifier
  UNION ALL SELECT 'Bacon crocante','addon',7.00
  UNION ALL SELECT 'Molho extra','addon',3.00
) AS v
WHERE p.businessId = @businessId
  AND p.category = 'Porções'
  AND NOT EXISTS (
    SELECT 1 FROM ProductVariations pv
    WHERE pv.productId = p.id AND pv.name = v.name
  );

-- ─── 5. Tamanhos (refrigerantes e batata) ──────────────────
INSERT INTO ProductVariations (id, productId, businessId, name, type, priceModifier)
SELECT UUID(), p.id, @businessId, v.name, v.type, v.priceModifier
FROM Products p
JOIN (
            SELECT 'Coca-Cola' AS produto, 'Lata 350ml' AS name, 'size' AS type, 0.00 AS priceModifier
  UNION ALL SELECT 'Coca-Cola','Garrafa 600ml','size',3.00
  UNION ALL SELECT 'Coca-Cola','Garrafa 2L','size',7.00
  UNION ALL SELECT 'Coca-Cola Zero','Lata 350ml','size',0.00
  UNION ALL SELECT 'Coca-Cola Zero','Garrafa 600ml','size',3.00
  UNION ALL SELECT 'Coca-Cola Zero','Garrafa 2L','size',7.00
  UNION ALL SELECT 'Guaraná Antarctica','Lata 350ml','size',0.00
  UNION ALL SELECT 'Guaraná Antarctica','Garrafa 600ml','size',3.00
  UNION ALL SELECT 'Guaraná Antarctica','Garrafa 2L','size',6.50
  UNION ALL SELECT 'Sprite','Lata 350ml','size',0.00
  UNION ALL SELECT 'Sprite','Garrafa 600ml','size',3.00
  UNION ALL SELECT 'Batata Frita','Pequena 150g','size',-6.00
  UNION ALL SELECT 'Batata Frita','Média 250g','size',0.00
  UNION ALL SELECT 'Batata Frita','Grande 400g','size',9.00
) AS v ON v.produto = p.name
WHERE p.businessId = @businessId
  AND NOT EXISTS (
    SELECT 1 FROM ProductVariations pv
    WHERE pv.productId = p.id AND pv.name = v.name
  );

-- ─── 6. Conferência ────────────────────────────────────────
SELECT category, COUNT(*) AS produtos
FROM Products
WHERE businessId = @businessId
GROUP BY category
ORDER BY category;

SELECT pv.type, COUNT(*) AS variacoes
FROM ProductVariations pv
WHERE pv.businessId = @businessId
GROUP BY pv.type;
