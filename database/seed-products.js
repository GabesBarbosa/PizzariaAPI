const sql = require('mssql');
require('dotenv').config();

const config = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  options: { encrypt: true, trustServerCertificate: false }
};

const products = [
  { name: 'A moda da casa', description: 'Apresuntado, calabresa, ervilha, palmito, requeijão, tomate e bacon', price: 59.00, category: 'Pizza Salgada' },
  { name: 'Alho e óleo', description: 'Mussarela e alho frito', price: 53.00, category: 'Pizza Salgada' },
  { name: 'Aliche', description: 'Aliche, tomate, parmesão ou mussarela', price: 53.00, category: 'Pizza Salgada' },
  { name: 'Americana', description: 'Calabresa, cebola, mussarela e bacon', price: 56.00, category: 'Pizza Salgada' },
  { name: 'Ana', description: 'Calabresa, mussarela e philadelphia', price: 66.00, category: 'Pizza Salgada' },
  { name: 'Apresuntado', description: 'Apresuntado, cebola e mussarela', price: 53.00, category: 'Pizza Salgada' },
  { name: 'Atum', description: 'Atum, cebola e tomate', price: 53.00, category: 'Pizza Salgada' },
  { name: 'Atum especial', description: 'Atum, champignon e requeijão', price: 59.00, category: 'Pizza Salgada' },
  { name: 'Atum sólido', description: 'Atum sólido, cebola e tomate', price: 58.00, category: 'Pizza Salgada' },
  { name: 'Bacon', description: 'Bacon, ovos, cebola e mussarela', price: 58.00, category: 'Pizza Salgada' },
  { name: 'Baianinha', description: 'Calabresa, pimenta, cebola, ovos e parmesão', price: 55.00, category: 'Pizza Salgada' },
  { name: 'Batata palha', description: 'Batata palha e mussarela', price: 54.00, category: 'Pizza Salgada' },
  { name: 'Bauru', description: 'Apresuntado, mussarela e tomate', price: 53.00, category: 'Pizza Salgada' },
  { name: 'Brasileirinha', description: 'Apresuntado, palmito, ervilha e mussarela', price: 55.00, category: 'Pizza Salgada' },
  { name: 'Brócolis', description: 'Brócolis, cebola e mussarela', price: 54.00, category: 'Pizza Salgada' },
  { name: 'Brócolis especial', description: 'Brócolis, tomate seco, philadelphia e bacon', price: 66.00, category: 'Pizza Salgada' },
  { name: 'Caipira', description: 'Frango, milho e mussarela', price: 55.00, category: 'Pizza Salgada' },
  { name: 'Calabresa', description: 'Calabresa e cebola', price: 51.00, category: 'Pizza Salgada' },
  { name: 'Camarão', description: 'Camarão e catupiry original', price: 76.00, category: 'Pizza Salgada' },
  { name: 'Carne seca', description: 'Carne seca, champignon, mussarela e pimentão', price: 60.00, category: 'Pizza Salgada' },
  { name: 'Catupiry com milho', description: 'Catupiry original, milho e parmesão', price: 70.00, category: 'Pizza Salgada' },
  { name: 'Catupiry original', description: 'Catupiry original', price: 70.00, category: 'Pizza Salgada' },
  { name: 'Champignon', description: 'Champignon, bacon, mussarela ou requeijão', price: 58.00, category: 'Pizza Salgada' },
  { name: 'Escarola', description: 'Escarola, mussarela e bacon', price: 54.00, category: 'Pizza Salgada' },
  { name: 'Espanhola', description: 'Atum, tomate, bacon e requeijão', price: 58.00, category: 'Pizza Salgada' },
  { name: 'Florença', description: 'Frango, cebola, parmesão e requeijão', price: 59.00, category: 'Pizza Salgada' },
  { name: 'Florentina', description: 'Calabresa, atum, ervilha, palmito, milho e mussarela', price: 57.00, category: 'Pizza Salgada' },
  { name: 'Francesa', description: 'Apresuntado, ovos, milho, ervilha, cebola e mussarela', price: 54.00, category: 'Pizza Salgada' },
  { name: 'Frango com catupiry', description: 'Frango filetado com catupiry original', price: 66.00, category: 'Pizza Salgada' },
  { name: 'Frango com cheddar', description: 'Frango filetado com cheddar', price: 54.00, category: 'Pizza Salgada' },
  { name: 'Frango com philadelphia', description: 'Frango filetado com philadelphia', price: 67.00, category: 'Pizza Salgada' },
  { name: 'Frango com requeijão', description: 'Frango filetado com requeijão', price: 58.00, category: 'Pizza Salgada' },
  { name: 'Frango especial', description: 'Frango, milho e requeijão', price: 59.00, category: 'Pizza Salgada' },
  { name: 'Grega', description: 'Camarão, ervilha, palmito e mussarela', price: 70.00, category: 'Pizza Salgada' },
  { name: 'Italiana', description: 'Palmito, requeijão, mussarela e salame', price: 60.00, category: 'Pizza Salgada' },
  { name: 'Larissa I', description: 'Escarola, palmito, requeijão e bacon', price: 58.00, category: 'Pizza Salgada' },
  { name: 'Larissa II', description: 'Lombo, palmito e provolone', price: 55.00, category: 'Pizza Salgada' },
  { name: 'Larissa III', description: 'Frango e mussarela', price: 54.00, category: 'Pizza Salgada' },
  { name: 'Lombinho', description: 'Lombinho, cebola, mussarela ou requeijão', price: 58.00, category: 'Pizza Salgada' },
  { name: 'Maracatu', description: 'Calabresa e requeijão', price: 58.00, category: 'Pizza Salgada' },
  { name: 'Marguerita', description: 'Mussarela, parmesão, tomate e manjericão', price: 55.00, category: 'Pizza Salgada' },
  { name: 'Moda do chefe', description: 'Apresuntado, calabresa, parmesão, mussarela e requeijão', price: 59.00, category: 'Pizza Salgada' },
  { name: 'Moda do cliente', description: 'Até oito ingredientes escolhidos', price: 85.00, category: 'Pizza Salgada' },
  { name: 'Mussarela', description: 'Mussarela e molho de tomate', price: 52.00, category: 'Pizza Salgada' },
  { name: 'Mussarela de búfala', description: 'Mussarela de búfala e tomate seco', price: 57.00, category: 'Pizza Salgada' },
  { name: 'Mussarela especial', description: 'Mussarela, parmesão e tomate seco', price: 57.00, category: 'Pizza Salgada' },
  { name: 'Napolitana', description: 'Tomate, ovos, parmesão e mussarela', price: 55.00, category: 'Pizza Salgada' },
  { name: 'Palmito', description: 'Palmito, ervilha e mussarela', price: 55.00, category: 'Pizza Salgada' },
  { name: 'Paulistana', description: 'Frango, calabresa, ervilha, palmito, mussarela e bacon', price: 57.00, category: 'Pizza Salgada' },
  { name: 'Peito de peru', description: 'Peito de peru, champignon, cebola e mussarela', price: 58.00, category: 'Pizza Salgada' },
  { name: 'Peito de peru especial', description: 'Peito de peru, champignon, milho, philadelphia e bacon', price: 67.00, category: 'Pizza Salgada' },
  { name: 'Peperone', description: 'Mussarela, peperone e tomate seco', price: 60.00, category: 'Pizza Salgada' },
  { name: 'Peruana', description: 'Apresuntado, ovos e requeijão', price: 58.00, category: 'Pizza Salgada' },
  { name: 'Pizzaiolo', description: 'Calabresa, champignon e mussarela', price: 55.00, category: 'Pizza Salgada' },
  { name: 'Pizzaiolo especial', description: 'Cheddar, peperone, bacon e parmesão', price: 58.00, category: 'Pizza Salgada' },
  { name: 'Pomodoro', description: 'Atum, cebola, mussarela, tomate e alho frito', price: 57.00, category: 'Pizza Salgada' },
  { name: 'Portuguesa especial', description: 'Apresuntado, cebola, ovos, ervilha, palmito, mussarela e bacon', price: 57.00, category: 'Pizza Salgada' },
  { name: 'Portuguesa simples', description: 'Apresuntado, ovos, cebola e parmesão', price: 54.00, category: 'Pizza Salgada' },
  { name: 'Provolone', description: 'Queijo provolone', price: 57.00, category: 'Pizza Salgada' },
  { name: 'Quatro queijos', description: 'Mussarela, gorgonzola, provolone e requeijão', price: 60.00, category: 'Pizza Salgada' },
  { name: 'Romanesca', description: 'Apresuntado, bacon, champignon e requeijão', price: 58.00, category: 'Pizza Salgada' },
  { name: 'Salada di tono', description: 'Palmito, ervilha, atum, cebola, ovos e tomate', price: 55.00, category: 'Pizza Salgada' },
  { name: 'Salame', description: 'Mussarela e salame', price: 56.00, category: 'Pizza Salgada' },
  { name: 'Siciliana', description: 'Mussarela, tomate, champignon e bacon', price: 57.00, category: 'Pizza Salgada' },
  { name: 'Toscana', description: 'Calabresa, cebola e mussarela', price: 53.00, category: 'Pizza Salgada' },
  { name: 'Três queijos', description: 'Mussarela, requeijão e provolone', price: 58.00, category: 'Pizza Salgada' },
  { name: 'Vegetariana', description: 'Brócolis, milho, ervilha, palmito, escarola e mussarela de búfala', price: 58.00, category: 'Pizza Salgada' },
  { name: 'Banana', description: 'Banana, açúcar, canela, mussarela e leite condensado', price: 53.00, category: 'Pizza Doce' },
  { name: 'Banana especial', description: 'Banana, chocolate, granulado e leite condensado', price: 55.00, category: 'Pizza Doce' },
  { name: 'Banana flambada', description: 'Banana, chocolate branco e canela', price: 55.00, category: 'Pizza Doce' },
  { name: 'Brigadeiro', description: 'Chocolate, granulado e leite condensado', price: 55.00, category: 'Pizza Doce' },
  { name: 'Chocolate branco', description: 'Chocolate branco e leite condensado', price: 55.00, category: 'Pizza Doce' },
  { name: 'Chocolate com confeito', description: 'Chocolate, granulado, leite condensado e confeito', price: 55.00, category: 'Pizza Doce' },
  { name: 'Chocolate especial', description: 'Chocolate, granulado, bis, kitkat e leite condensado', price: 58.00, category: 'Pizza Doce' },
  { name: 'Chocolate com morango', description: 'Chocolate, granulado, morango e leite condensado', price: 55.00, category: 'Pizza Doce' },
  { name: 'Chocolate com uva', description: 'Chocolate, granulado, uva e leite condensado', price: 55.00, category: 'Pizza Doce' },
  { name: 'Mesclada', description: 'Chocolate ao leite e chocolate branco', price: 55.00, category: 'Pizza Doce' },
  { name: 'Prestígio', description: 'Chocolate, coco ralado e leite condensado', price: 55.00, category: 'Pizza Doce' },
  { name: 'Romeu e Julieta', description: 'Mussarela e goiabada', price: 53.00, category: 'Pizza Doce' },
];

async function run() {
  const pool = await sql.connect(config);

  // Remove old seed products
  await pool.request().query("DELETE FROM OrderItems WHERE productId IN (SELECT id FROM Products)");
  await pool.request().query("DELETE FROM Products");
  console.log('Cleared existing products');

  let count = 0;
  for (const p of products) {
    const req = pool.request();
    req.input('name', sql.NVarChar(200), p.name);
    req.input('description', sql.NVarChar(1000), p.description);
    req.input('price', sql.Decimal(10, 2), p.price);
    req.input('category', sql.NVarChar(50), p.category);
    await req.query(
      `INSERT INTO Products (id, name, description, price, category)
       VALUES (NEWID(), @name, @description, @price, @category)`
    );
    count++;
  }

  console.log(`Inserted ${count} products successfully!`);
  await pool.close();
}

run().catch(err => { console.error(err.message); process.exit(1); });
