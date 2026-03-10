/* Master database for multi-tenant Pizzaria system.
   This database stores tenants (pizzarias) and their users.
   Each tenant has its own separate database with the pizzaria schema (Customers, Products, Orders, OrderItems).
*/

-- Create the master database (run on master context)
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'PizzariaMaster')
  CREATE DATABASE PizzariaMaster;
GO

USE PizzariaMaster;
GO

-- Tenants table
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Tenants')
CREATE TABLE Tenants (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  name NVARCHAR(200) NOT NULL,            -- Nome da pizzaria
  slug NVARCHAR(100) NOT NULL UNIQUE,     -- Identificador único (ex: 'larissa')
  dbName NVARCHAR(128) NOT NULL UNIQUE,   -- Nome do banco de dados do tenant
  active BIT NOT NULL DEFAULT 1,
  createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- Users table
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Users')
CREATE TABLE Users (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenantId UNIQUEIDENTIFIER NOT NULL,
  name NVARCHAR(200) NOT NULL,
  email NVARCHAR(200) NOT NULL UNIQUE,
  passwordHash NVARCHAR(500) NOT NULL,
  role NVARCHAR(50) NOT NULL DEFAULT 'admin',   -- admin, operator
  active BIT NOT NULL DEFAULT 1,
  createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_Users_Tenants FOREIGN KEY (tenantId) REFERENCES Tenants(id)
);
GO
