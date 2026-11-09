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

async function run() {
  console.log(`Connecting to ${process.env.DB_HOST}/${process.env.DB_NAME}...`);
  const pool = await sql.connect(config);

  // init.sql: create base tables if they don't exist
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Customers')
    CREATE TABLE Customers (
      id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
      name NVARCHAR(200) NOT NULL,
      phone NVARCHAR(50) NOT NULL UNIQUE,
      address NVARCHAR(500) NULL,
      createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Products')
    CREATE TABLE Products (
      id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
      name NVARCHAR(200) NOT NULL,
      description NVARCHAR(1000) NULL,
      price DECIMAL(10,2) NOT NULL,
      category NVARCHAR(50) NOT NULL DEFAULT 'outro',
      createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Orders')
    CREATE TABLE Orders (
      id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      customerId UNIQUEIDENTIFIER NOT NULL,
      total DECIMAL(12,2) NOT NULL,
      status NVARCHAR(50) NOT NULL DEFAULT 'RECEIVED',
      createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_Orders_Customers FOREIGN KEY (customerId) REFERENCES Customers(id)
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'OrderItems')
    CREATE TABLE OrderItems (
      id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
      orderId INT NOT NULL,
      productId UNIQUEIDENTIFIER NOT NULL,
      quantity INT NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      size NVARCHAR(20) NOT NULL DEFAULT 'normal',
      halfProductId UNIQUEIDENTIFIER NULL,
      CONSTRAINT FK_OrderItems_Orders FOREIGN KEY (orderId) REFERENCES Orders(id),
      CONSTRAINT FK_OrderItems_Products FOREIGN KEY (productId) REFERENCES Products(id)
    )
  `);
  console.log('[0/3] Init OK: base tables created (if not existed)');

  // migrate-category: add category column to Products
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('Products') AND name = 'category'
    )
    ALTER TABLE Products ADD category NVARCHAR(50) NOT NULL DEFAULT 'outro'
  `);
  console.log('[1/3] Migration OK: category column in Products');

  // migrate-pizza-size-half: add size + halfProductId to OrderItems
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('OrderItems') AND name = 'size')
      ALTER TABLE OrderItems ADD size NVARCHAR(20) NOT NULL DEFAULT 'normal'
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('OrderItems') AND name = 'halfProductId')
      ALTER TABLE OrderItems ADD halfProductId UNIQUEIDENTIFIER NULL
  `);
  console.log('[2/3] Migration OK: size + halfProductId in OrderItems');

  // migrate-order-id: ensure Orders.id is INT IDENTITY and OrderItems.orderId is INT
  const ordersIdType = await pool.request().query(`
    SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Orders' AND COLUMN_NAME = 'id'
  `);
  const currentType = ordersIdType.recordset[0]?.DATA_TYPE;

  if (currentType !== 'int') {
    console.log(`Orders.id is '${currentType}', migrating to INT IDENTITY...`);

    await pool.request().query('DELETE FROM OrderItems');
    await pool.request().query('DELETE FROM Orders');
    console.log('  Cleared orders data');

    await pool.request().query(`
      IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_OrderItems_Orders')
        ALTER TABLE OrderItems DROP CONSTRAINT FK_OrderItems_Orders
    `);
    console.log('  Dropped FK_OrderItems_Orders');

    await pool.request().query('ALTER TABLE OrderItems DROP COLUMN orderId');
    await pool.request().query('ALTER TABLE OrderItems ADD orderId INT NOT NULL DEFAULT 0');
    console.log('  OrderItems.orderId -> INT');

    const pkRes = await pool.request().query(`
      SELECT name FROM sys.key_constraints
      WHERE parent_object_id = OBJECT_ID('Orders') AND type = 'PK'
    `);
    const pkName = pkRes.recordset[0]?.name;
    if (pkName) {
      await pool.request().query(`ALTER TABLE Orders DROP CONSTRAINT [${pkName}]`);
      console.log('  Dropped PK:', pkName);
    }

    const defRes = await pool.request().query(`
      SELECT dc.name FROM sys.default_constraints dc
      INNER JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
      WHERE dc.parent_object_id = OBJECT_ID('Orders') AND c.name = 'id'
    `);
    const defName = defRes.recordset[0]?.name;
    if (defName) {
      await pool.request().query(`ALTER TABLE Orders DROP CONSTRAINT [${defName}]`);
      console.log('  Dropped default:', defName);
    }

    await pool.request().query('ALTER TABLE Orders DROP COLUMN id');
    await pool.request().query('ALTER TABLE Orders ADD id INT IDENTITY(1,1) NOT NULL PRIMARY KEY');
    console.log('  Orders.id -> INT IDENTITY(1,1)');

    await pool.request().query(`
      ALTER TABLE OrderItems ADD CONSTRAINT FK_OrderItems_Orders
      FOREIGN KEY (orderId) REFERENCES Orders(id)
    `);
    console.log('  Recreated FK_OrderItems_Orders');
  } else {
    console.log('  Orders.id already INT, skipping migrate-order-id');
  }
  console.log('[3/3] Migration OK: Orders.id INT IDENTITY + FK');

  // migrate-customer-address: structured address fields on Customers
  const customerAddressColumns = [
    { name: 'cep',          ddl: 'NVARCHAR(9) NULL' },
    { name: 'street',       ddl: 'NVARCHAR(200) NULL' },
    { name: 'number',       ddl: 'NVARCHAR(20) NULL' },
    { name: 'complement',   ddl: 'NVARCHAR(200) NULL' },
    { name: 'neighborhood', ddl: 'NVARCHAR(200) NULL' },
    { name: 'city',         ddl: 'NVARCHAR(100) NULL' },
    { name: 'uf',           ddl: 'NVARCHAR(2) NULL' },
    { name: 'latitude',     ddl: 'DECIMAL(9,6) NULL' },
    { name: 'longitude',    ddl: 'DECIMAL(9,6) NULL' },
  ];
  for (const col of customerAddressColumns) {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('Customers') AND name = '${col.name}'
      )
      ALTER TABLE Customers ADD [${col.name}] ${col.ddl}
    `);
  }
  console.log('[4/4] Migration OK: structured address columns in Customers');

  await pool.close();
  console.log('\nAll migrations completed successfully!');
}

run().catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
