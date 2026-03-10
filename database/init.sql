/* SQL Server schema for Pizzaria API
   Run this script against your SQL Server instance to create the database objects.
*/

CREATE TABLE Customers (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  name NVARCHAR(200) NOT NULL,
  phone NVARCHAR(50) NOT NULL UNIQUE,
  address NVARCHAR(500) NULL,
  createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE Products (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  name NVARCHAR(200) NOT NULL,
  description NVARCHAR(1000) NULL,
  price DECIMAL(10,2) NOT NULL,
  category NVARCHAR(50) NOT NULL DEFAULT 'outro',
  createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE Orders (
  id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  customerId UNIQUEIDENTIFIER NOT NULL,
  total DECIMAL(12,2) NOT NULL,
  status NVARCHAR(50) NOT NULL DEFAULT 'RECEIVED',
  createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_Orders_Customers FOREIGN KEY (customerId) REFERENCES Customers(id)
);

CREATE TABLE OrderItems (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  orderId INT NOT NULL,
  productId UNIQUEIDENTIFIER NOT NULL,
  quantity INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  CONSTRAINT FK_OrderItems_Orders FOREIGN KEY (orderId) REFERENCES Orders(id),
  CONSTRAINT FK_OrderItems_Products FOREIGN KEY (productId) REFERENCES Products(id)
);

-- Optional: seed example products
INSERT INTO Products (name, description, price, category) VALUES
('Margherita', 'Tomato, mozzarella, basil', 29.90, 'pizza'),
('Pepperoni', 'Pepperoni, cheese', 35.50, 'pizza'),
('Coca-Cola 350ml', 'Refrigerante', 5.00, 'bebida');
