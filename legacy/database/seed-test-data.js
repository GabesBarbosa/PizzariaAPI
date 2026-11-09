/**
 * seed-test-data.js
 * Popula dados de teste: produtos, clientes e pedidos dos últimos 30 dias.
 * Uso: node database/seed-test-data.js
 */

const sql = require('mssql');
require('dotenv').config();

const BUSINESS_ID = '6c17daca-ef47-4cb7-b4e4-fc6230d1372c';

const config = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  options: { encrypt: true, trustServerCertificate: false }
};

// ─── PRODUTOS ────────────────────────────────────────────────────────────────
const products = [
  { name: 'Calabresa',             description: 'Calabresa e cebola',                                price: 51.00, category: 'Pizza Salgada' },
  { name: 'Mussarela',             description: 'Mussarela e molho de tomate',                       price: 52.00, category: 'Pizza Salgada' },
  { name: 'Frango com catupiry',   description: 'Frango filetado com catupiry original',             price: 66.00, category: 'Pizza Salgada' },
  { name: 'Portuguesa especial',   description: 'Apresuntado, cebola, ovos, ervilha, palmito, mussarela e bacon', price: 57.00, category: 'Pizza Salgada' },
  { name: 'Quatro queijos',        description: 'Mussarela, gorgonzola, provolone e requeijão',      price: 60.00, category: 'Pizza Salgada' },
  { name: 'Camarão',               description: 'Camarão e catupiry original',                       price: 76.00, category: 'Pizza Salgada' },
  { name: 'Marguerita',            description: 'Mussarela, parmesão, tomate e manjericão',          price: 55.00, category: 'Pizza Salgada' },
  { name: 'Frango com requeijão',  description: 'Frango filetado com requeijão',                     price: 58.00, category: 'Pizza Salgada' },
  { name: 'Bauru',                 description: 'Apresuntado, mussarela e tomate',                   price: 53.00, category: 'Pizza Salgada' },
  { name: 'Americana',             description: 'Calabresa, cebola, mussarela e bacon',              price: 56.00, category: 'Pizza Salgada' },
  { name: 'Peperone',              description: 'Mussarela, peperone e tomate seco',                 price: 60.00, category: 'Pizza Salgada' },
  { name: 'Vegetariana',           description: 'Brócolis, milho, ervilha, palmito e mussarela de búfala', price: 58.00, category: 'Pizza Salgada' },
  { name: 'Banana',                description: 'Banana, açúcar, canela, mussarela e leite condensado', price: 53.00, category: 'Pizza Doce' },
  { name: 'Brigadeiro',            description: 'Chocolate, granulado e leite condensado',           price: 55.00, category: 'Pizza Doce' },
  { name: 'Chocolate com morango', description: 'Chocolate, granulado, morango e leite condensado', price: 55.00, category: 'Pizza Doce' },
  { name: 'Romeu e Julieta',       description: 'Mussarela e goiabada',                              price: 53.00, category: 'Pizza Doce' },
  { name: 'Coca-Cola 2L',          description: 'Refrigerante gelado',                               price: 12.00, category: 'Bebida' },
  { name: 'Guaraná 2L',            description: 'Refrigerante gelado',                               price: 11.00, category: 'Bebida' },
  { name: 'Água mineral 500ml',    description: 'Água sem gás',                                      price: 4.00,  category: 'Bebida' },
  { name: 'Suco de laranja 500ml', description: 'Natural, feito na hora',                            price: 8.00,  category: 'Bebida' },
];

// ─── CLIENTES ─────────────────────────────────────────────────────────────────
const customers = [
  { name: 'Ana Silva',       phone: '5511987654321', cep: '01310-100', street: 'Av. Paulista',       number: '1578', neighborhood: 'Bela Vista',     city: 'São Paulo', uf: 'SP' },
  { name: 'Bruno Costa',     phone: '5511976543210', cep: '04038-001', street: 'Rua Vergueiro',      number: '3185', neighborhood: 'Vila Mariana',    city: 'São Paulo', uf: 'SP' },
  { name: 'Carla Mendes',    phone: '5511965432109', cep: '05421-001', street: 'Rua Oscar Freire',   number: '900',  neighborhood: 'Jardins',         city: 'São Paulo', uf: 'SP' },
  { name: 'Diego Rocha',     phone: '5511954321098', cep: '01414-001', street: 'Rua Augusta',        number: '2690', neighborhood: 'Consolação',      city: 'São Paulo', uf: 'SP' },
  { name: 'Elisa Ferreira',  phone: '5511943210987', cep: '02910-000', street: 'Av. Nova Cantareira',number: '620',  neighborhood: 'Tremembé',        city: 'São Paulo', uf: 'SP' },
  { name: 'Felipe Gomes',    phone: '5511932109876', cep: '04552-000', street: 'Rua Funchal',        number: '411',  neighborhood: 'Vila Olímpia',    city: 'São Paulo', uf: 'SP' },
  { name: 'Gabriela Lima',   phone: '5511921098765', cep: '05002-000', street: 'Rua Pedroso Alvarenga', number: '1200', neighborhood: 'Itaim Bibi',  city: 'São Paulo', uf: 'SP' },
  { name: 'Henrique Souza',  phone: '5511910987654', cep: '03301-000', street: 'Av. Radial Leste',   number: '890',  neighborhood: 'Tatuapé',         city: 'São Paulo', uf: 'SP' },
  { name: 'Isabela Nunes',   phone: '5511909876543', cep: '05724-001', street: 'Av. Giovanni Gronchi',number: '5000','neighborhood': 'Vila Andrade',  city: 'São Paulo', uf: 'SP' },
  { name: 'João Pereira',    phone: '5511898765432', cep: '04795-100', street: 'Av. Santo Amaro',    number: '7123', neighborhood: 'Santo Amaro',     city: 'São Paulo', uf: 'SP' },
  { name: 'Karen Oliveira',  phone: '5511887654321', cep: '01505-001', street: 'Rua da Glória',      number: '270',  neighborhood: 'Liberdade',       city: 'São Paulo', uf: 'SP' },
  { name: 'Lucas Martins',   phone: '5511876543210', cep: '03162-020', street: 'Av. Aricanduva',     number: '5555', neighborhood: 'Jardim Aricanduva',city: 'São Paulo', uf: 'SP' },
  { name: 'Marina Alves',    phone: '5511865432109', cep: '01220-010', street: 'Av. São João',       number: '473',  neighborhood: 'Centro',          city: 'São Paulo', uf: 'SP' },
  { name: 'Natan Ribeiro',   phone: '5511854321098', cep: '04126-001', street: 'Rua Domingos de Morais', number: '2188', neighborhood: 'Vila Mariana', city: 'São Paulo', uf: 'SP' },
  { name: 'Odete Santos',    phone: '5511843210987', cep: '08210-000', street: 'Av. Marechal Tito',  number: '3800', neighborhood: 'Itaquera',        city: 'São Paulo', uf: 'SP' },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const STATUSES = ['RECEIVED', 'RECEIVED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERED', 'DELIVERED', 'CANCELLED'];
const CHANNELS = ['web', 'web', 'web', 'whatsapp', 'balcao'];
const PAYMENT_METHODS = ['Dinheiro', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito', 'Pix'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function randomPastDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  // Random hour between 11:00 and 23:00
  d.setHours(randInt(11, 23), randInt(0, 59), 0, 0);
  return d;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function run() {
  const pool = await sql.connect(config);
  console.log('Conectado ao banco de dados.');

  // ── 1. Limpar dados antigos de teste ──────────────────────────────────────
  console.log('\n[1/4] Limpando dados anteriores...');
  await pool.request().query(`DELETE FROM OrderItemVariations WHERE orderItemId IN (SELECT oi.id FROM OrderItems oi INNER JOIN Orders o ON oi.orderId = o.id WHERE o.businessId = '${BUSINESS_ID}')`);
  await pool.request().query(`DELETE FROM OrderItems WHERE orderId IN (SELECT id FROM Orders WHERE businessId = '${BUSINESS_ID}')`);
  await pool.request().query(`DELETE FROM Orders WHERE businessId = '${BUSINESS_ID}'`);
  await pool.request().query(`DELETE FROM Customers WHERE businessId = '${BUSINESS_ID}'`);
  await pool.request().query(`DELETE FROM Products WHERE businessId = '${BUSINESS_ID}'`);
  console.log('   Dados anteriores removidos.');

  // ── 2. Produtos ───────────────────────────────────────────────────────────
  console.log('\n[2/4] Inserindo produtos...');
  const productIds = [];
  const productPrices = [];
  for (const p of products) {
    const r = pool.request();
    r.input('businessId', sql.UniqueIdentifier, BUSINESS_ID);
    r.input('name', sql.NVarChar(200), p.name);
    r.input('description', sql.NVarChar(1000), p.description);
    r.input('price', sql.Decimal(10, 2), p.price);
    r.input('category', sql.NVarChar(50), p.category);
    const res = await r.query(`
      INSERT INTO Products (id, businessId, name, description, price, category)
      OUTPUT INSERTED.id
      VALUES (NEWID(), @businessId, @name, @description, @price, @category)
    `);
    productIds.push(res.recordset[0].id);
    productPrices.push(p.price);
  }
  console.log(`   ${productIds.length} produtos inseridos.`);

  // ── 3. Clientes ───────────────────────────────────────────────────────────
  console.log('\n[3/4] Inserindo clientes...');
  const customerIds = [];
  for (const c of customers) {
    const r = pool.request();
    r.input('businessId', sql.UniqueIdentifier, BUSINESS_ID);
    r.input('name', sql.NVarChar(200), c.name);
    r.input('phone', sql.NVarChar(50), c.phone);
    r.input('cep', sql.NVarChar(9), c.cep);
    r.input('street', sql.NVarChar(200), c.street);
    r.input('number', sql.NVarChar(20), c.number);
    r.input('complement', sql.NVarChar(200), null);
    r.input('neighborhood', sql.NVarChar(200), c.neighborhood);
    r.input('city', sql.NVarChar(100), c.city);
    r.input('uf', sql.NVarChar(2), c.uf);
    const res = await r.query(`
      INSERT INTO Customers (id, businessId, name, phone, cep, street, [number], complement, neighborhood, city, uf)
      OUTPUT INSERTED.id
      VALUES (NEWID(), @businessId, @name, @phone, @cep, @street, @number, @complement, @neighborhood, @city, @uf)
    `);
    customerIds.push(res.recordset[0].id);
  }
  console.log(`   ${customerIds.length} clientes inseridos.`);

  // ── 4. Pedidos (últimos 30 dias) ──────────────────────────────────────────
  console.log('\n[4/4] Inserindo pedidos...');

  // ~3-6 pedidos por dia nos últimos 30 dias
  let orderCount = 0;
  for (let day = 30; day >= 0; day--) {
    const ordersToday = randInt(2, 6);
    // Fim de semana tem mais pedidos
    const date = new Date();
    date.setDate(date.getDate() - day);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const total = isWeekend ? ordersToday + randInt(1, 3) : ordersToday;

    for (let o = 0; o < total; o++) {
      const customerId = pick(customerIds);
      const channel = pick(CHANNELS);
      const paymentMethod = pick(PAYMENT_METHODS);
      const status = day > 0 ? pick(STATUSES) : pick(['RECEIVED', 'RECEIVED', 'PREPARING']);
      const orderDate = randomPastDate(day);

      // Escolher 1-3 itens aleatórios
      const numItems = randInt(1, 3);
      const selectedIdxs = new Set();
      while (selectedIdxs.size < numItems) selectedIdxs.add(randInt(0, productIds.length - 1));

      const cartItems = [...selectedIdxs].map(idx => ({
        productId: productIds[idx],
        price: productPrices[idx],
        qty: randInt(1, 2)
      }));

      const subtotal = cartItems.reduce((s, i) => s + i.price * i.qty, 0);
      const deliveryFee = channel === 'balcao' ? 0 : pick([5, 8, 12]);
      const orderTotal = subtotal + deliveryFee;

      const deliveryAddress = channel !== 'balcao'
        ? `${customers[customerIds.indexOf(customerId)]?.street || 'Rua Teste'}, ${randInt(1, 999)}`
        : null;

      // deliveredAt para pedidos DELIVERED
      const deliveredAt = status === 'DELIVERED'
        ? new Date(orderDate.getTime() + randInt(25, 60) * 60000)
        : null;

      const rO = pool.request();
      rO.input('businessId', sql.UniqueIdentifier, BUSINESS_ID);
      rO.input('customerId', sql.UniqueIdentifier, customerId);
      rO.input('total', sql.Decimal(12, 2), orderTotal);
      rO.input('status', sql.NVarChar(50), status);
      rO.input('paymentMethod', sql.NVarChar(50), paymentMethod);
      rO.input('deliveryAddress', sql.NVarChar(500), deliveryAddress);
      rO.input('deliveryFee', sql.Decimal(10, 2), deliveryFee);
      rO.input('channel', sql.NVarChar(50), channel);
      rO.input('createdAt', sql.DateTime2, orderDate);
      rO.input('deliveredAt', sql.DateTime2, deliveredAt);

      const ordRes = await rO.query(`
        INSERT INTO Orders (businessId, customerId, total, status, paymentMethod, deliveryAddress, deliveryFee, channel, createdAt, deliveredAt)
        OUTPUT INSERTED.id
        VALUES (@businessId, @customerId, @total, @status, @paymentMethod, @deliveryAddress, @deliveryFee, @channel, @createdAt, @deliveredAt)
      `);
      const orderId = ordRes.recordset[0].id;

      for (const item of cartItems) {
        const rI = pool.request();
        rI.input('orderId', sql.Int, orderId);
        rI.input('productId', sql.UniqueIdentifier, item.productId);
        rI.input('quantity', sql.Int, item.qty);
        rI.input('unitPrice', sql.Decimal(10, 2), item.price);
        rI.input('finalPrice', sql.Decimal(10, 2), item.price);
        await rI.query(`
          INSERT INTO OrderItems (id, orderId, productId, quantity, unitPrice, finalPrice)
          VALUES (NEWID(), @orderId, @productId, @quantity, @unitPrice, @finalPrice)
        `);
      }

      orderCount++;
    }
  }

  console.log(`   ${orderCount} pedidos inseridos.`);

  await pool.close();
  console.log('\n✓ Seed concluído com sucesso!');
}

run().catch(err => {
  console.error('Erro no seed:', err.message);
  process.exit(1);
});
