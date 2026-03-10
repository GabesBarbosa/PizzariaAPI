const sql = require('mssql');

const config = {
  server: 'localhost',
  port: 1433,
  user: 'sa',
  password: 'Larissa7@',
  database: 'Pizzaria',
  options: { encrypt: false, trustServerCertificate: true }
};

async function run() {
  const pool = await sql.connect(config);

  // Clear existing data
  await pool.request().query('DELETE FROM OrderItems');
  await pool.request().query('DELETE FROM Orders');
  console.log('Cleared orders data');

  // Drop FK constraint
  await pool.request().query(`
    IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_OrderItems_Orders')
      ALTER TABLE OrderItems DROP CONSTRAINT FK_OrderItems_Orders
  `);
  console.log('Dropped FK_OrderItems_Orders');

  // Drop OrderItems.orderId (UNIQUEIDENTIFIER) and recreate as INT
  await pool.request().query('ALTER TABLE OrderItems DROP COLUMN orderId');
  await pool.request().query('ALTER TABLE OrderItems ADD orderId INT NOT NULL DEFAULT 0');
  console.log('OrderItems.orderId -> INT');

  // Drop Orders PK
  const pkRes = await pool.request().query(`
    SELECT name FROM sys.key_constraints
    WHERE parent_object_id = OBJECT_ID('Orders') AND type = 'PK'
  `);
  const pkName = pkRes.recordset[0]?.name;
  if (pkName) {
    await pool.request().query(`ALTER TABLE Orders DROP CONSTRAINT [${pkName}]`);
    console.log('Dropped PK:', pkName);
  }

  // Drop default constraint on id column
  const defRes = await pool.request().query(`
    SELECT dc.name FROM sys.default_constraints dc
    INNER JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
    WHERE dc.parent_object_id = OBJECT_ID('Orders') AND c.name = 'id'
  `);
  const defName = defRes.recordset[0]?.name;
  if (defName) {
    await pool.request().query(`ALTER TABLE Orders DROP CONSTRAINT [${defName}]`);
    console.log('Dropped default:', defName);
  }

  // Drop old id column, add INT IDENTITY
  await pool.request().query('ALTER TABLE Orders DROP COLUMN id');
  await pool.request().query('ALTER TABLE Orders ADD id INT IDENTITY(1,1) NOT NULL PRIMARY KEY');
  console.log('Orders.id -> INT IDENTITY(1,1)');

  // Recreate FK
  await pool.request().query(`
    ALTER TABLE OrderItems ADD CONSTRAINT FK_OrderItems_Orders
    FOREIGN KEY (orderId) REFERENCES Orders(id)
  `);
  console.log('Recreated FK_OrderItems_Orders');

  // Verify
  const cols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, COLUMNPROPERTY(OBJECT_ID('Orders'), 'id', 'IsIdentity') AS IsIdentity
    FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Orders' AND COLUMN_NAME='id'
  `);
  console.log('Orders.id:', cols.recordset[0]);

  await pool.close();
}

run().catch(err => { console.error(err.message); process.exit(1); });
