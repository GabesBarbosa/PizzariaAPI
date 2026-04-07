# Design Spec: Restaurant API Refactor

**Date:** 2026-04-06  
**Status:** Approved

## Overview

Refactor PizzariaAPI into a generic multi-tenant restaurant SaaS platform with two goals:
1. Migrate from separate-database-per-tenant to a single Azure SQL database with `businessId` column isolation
2. Generalize the domain from pizza-specific to any type of restaurant, adding a flexible product variations system

---

## Motivation

The current architecture creates a new SQL Server database per tenant via `CREATE DATABASE`, which is not supported in Azure SQL Database (only available on SQL Server VMs/on-premises). The new architecture uses a single database with row-level tenant isolation via `businessId`, which is fully compatible with Azure SQL.

The original domain was built specifically for pizzarias (pizza sizes, brotinho multiplier, meio-a-meio, loyalty card with pizza emojis). The refactor removes these hard-coded concepts and replaces them with a generic variations system applicable to any food business.

---

## Layer 1: Database Schema

### Master Database (single Azure SQL database)

**Table: `Businesses`** (replaces `Tenants`)
```sql
Businesses (
  id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  name        NVARCHAR(200) NOT NULL,
  slug        NVARCHAR(100) NOT NULL UNIQUE,
  active      BIT NOT NULL DEFAULT 1,
  createdAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
)
```

**Table: `Users`** (updated — removes `dbName` dependency)
```sql
Users (
  id            UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  businessId    UNIQUEIDENTIFIER NOT NULL REFERENCES Businesses(id),
  name          NVARCHAR(200) NOT NULL,
  email         NVARCHAR(200) NOT NULL UNIQUE,
  passwordHash  NVARCHAR(500) NOT NULL,
  role          NVARCHAR(50) NOT NULL DEFAULT 'admin',
  active        BIT NOT NULL DEFAULT 1,
  createdAt     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
)
```

### Tenant Data Tables (all in the same database, isolated by `businessId`)

**Table: `Customers`** (adds `businessId`)
```sql
Customers (
  id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  businessId  UNIQUEIDENTIFIER NOT NULL,
  name        NVARCHAR(200) NOT NULL,
  phone       NVARCHAR(50) NOT NULL,
  address     NVARCHAR(500) NULL,
  createdAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UNIQUE (businessId, phone)
)
```

**Table: `Products`** (adds `businessId`)
```sql
Products (
  id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  businessId  UNIQUEIDENTIFIER NOT NULL,
  name        NVARCHAR(200) NOT NULL,
  description NVARCHAR(1000) NULL,
  price       DECIMAL(10,2) NOT NULL,
  category    NVARCHAR(50) NOT NULL DEFAULT 'geral',
  createdAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
)
```

**Table: `ProductVariations`** (new)
```sql
ProductVariations (
  id            UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  productId     UNIQUEIDENTIFIER NOT NULL REFERENCES Products(id),
  businessId    UNIQUEIDENTIFIER NOT NULL,
  name          NVARCHAR(100) NOT NULL,   -- e.g. "Grande", "Bacon", "Sem cebola"
  type          NVARCHAR(50) NOT NULL,    -- "size" | "addon" | "removal" | "custom"
  priceModifier DECIMAL(10,2) NOT NULL DEFAULT 0,  -- +5.00, -2.00, 0.00
  createdAt     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
)
```

**Table: `Orders`** (adds `businessId`)
```sql
Orders (
  id              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  businessId      UNIQUEIDENTIFIER NOT NULL,
  customerId      UNIQUEIDENTIFIER NOT NULL REFERENCES Customers(id),
  total           DECIMAL(12,2) NOT NULL,
  status          NVARCHAR(50) NOT NULL DEFAULT 'RECEIVED',
  paymentMethod   NVARCHAR(50) NULL,
  deliveryAddress NVARCHAR(500) NULL,
  notes           NVARCHAR(1000) NULL,
  deliveryFee     DECIMAL(10,2) NOT NULL DEFAULT 0,
  channel         NVARCHAR(50) NOT NULL DEFAULT 'balcao',
  createdAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  deliveredAt     DATETIME2 NULL
)
```

**Table: `OrderItems`** (removes pizza-specific columns, adds `finalPrice`)
```sql
OrderItems (
  id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  orderId     INT NOT NULL REFERENCES Orders(id),
  productId   UNIQUEIDENTIFIER NOT NULL REFERENCES Products(id),
  quantity    INT NOT NULL,
  unitPrice   DECIMAL(10,2) NOT NULL,   -- snapshot of product base price at order time
  finalPrice  DECIMAL(10,2) NOT NULL    -- unitPrice + sum of variation modifiers
  -- Removed: size, halfProductId (pizza-specific)
)
```

**Table: `OrderItemVariations`** (new — tracks which variations were applied to each order item)
```sql
OrderItemVariations (
  id              UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  orderItemId     UNIQUEIDENTIFIER NOT NULL REFERENCES OrderItems(id),
  variationId     UNIQUEIDENTIFIER NOT NULL REFERENCES ProductVariations(id),
  priceModifier   DECIMAL(10,2) NOT NULL  -- snapshot of modifier at order time
)
```

### Indexes
```sql
CREATE INDEX IX_Customers_BusinessId ON Customers(businessId);
CREATE INDEX IX_Products_BusinessId ON Products(businessId);
CREATE INDEX IX_Orders_BusinessId ON Orders(businessId);
CREATE INDEX IX_Orders_CustomerId ON Orders(customerId);
CREATE INDEX IX_ProductVariations_ProductId ON ProductVariations(productId);
CREATE INDEX IX_OrderItems_OrderId ON OrderItems(orderId);
CREATE INDEX IX_OrderItemVariations_OrderItemId ON OrderItemVariations(orderItemId);
```

---

## Layer 2: Business Context (replaces Tenant Context)

### `src/database/businessContext.ts` (replaces `tenantContext.ts`)

```typescript
interface BusinessContext {
  businessId: string;
  userId: string;
  role: string;
}
// Uses AsyncLocalStorage — same mechanism, no dbName needed
```

### `src/database/mssqlClient.ts`

Replaces the `Map<dbName, ConnectionPool>` with a **singleton connection pool** pointing to the single database. `getPool()` always returns the same pool — no routing logic needed.

`masterDb.ts` is removed. The auth repository (`auth.repository.ts`) switches to using `getPool()` from `mssqlClient.ts` directly — same pool, same database. Connection config must have `encrypt: true` (required by Azure SQL).

### JWT Payload

```typescript
// Before: { userId, tenantId, dbName, role }
// After:  { userId, businessId, role }
```

---

## Layer 3: Repository Changes

All repositories gain `businessId` filtering. The `businessId` is read from `getBusinessContext()` on every query — never passed as a parameter from controllers.

Pattern for every query:
```typescript
const { businessId } = getBusinessContext();
// Every SELECT adds: WHERE businessId = @businessId
// Every INSERT includes businessId
```

This ensures data isolation without any possibility of cross-business data leakage.

---

## Layer 4: Product Variations

### New endpoints under `/api/products/:id/variations`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/products/:id/variations` | List all variations for a product |
| POST | `/api/products/:id/variations` | Create a variation |
| PUT | `/api/products/:id/variations/:vid` | Update a variation |
| DELETE | `/api/products/:id/variations/:vid` | Delete a variation |

### Order creation with variations

Request body for `POST /api/orders`:
```json
{
  "customerId": "uuid",
  "items": [
    {
      "productId": "uuid",
      "quantity": 2,
      "variations": [
        { "variationId": "uuid" },
        { "variationId": "uuid" }
      ]
    }
  ],
  "paymentMethod": "PIX",
  "deliveryAddress": "Rua X, 123",
  "deliveryFee": 5.00
}
```

Price calculation in `order.service.ts`:
```
finalPrice = unitPrice + sum(priceModifier for each chosen variation)
total = sum(finalPrice * quantity for each item) + deliveryFee
```

---

## Layer 5: Renaming

| Before | After |
|--------|-------|
| `tenantId` | `businessId` |
| `Tenants` table | `Businesses` table |
| `tenantContext.ts` | `businessContext.ts` |
| `getTenantDb()` / `getTenantContext()` | `getBusinessContext()` |
| `tenantStorage` | `businessStorage` |
| `tenant.service.ts` | `business.service.ts` |
| `auth.repository.ts` — `findTenantBySlug` | `findBusinessBySlug` |
| `provisionTenantDatabase()` | `registerBusiness()` — inserts into `Businesses`, no DB creation |
| `dbName` in JWT, context, repositories | removed |
| `pizzaria-api` (package.json name) | `restaurant-api` |

### Removed (pizza-specific)
- `size` and `halfProductId` columns on `OrderItems`
- `BROTINHO_MULTIPLIER` constant
- Loyalty card logic (hardcoded 🍕 emojis, 10-stamp reset)
- Pizza-specific WhatsApp message templates (replace with generic ones)
- `seed-products.js` (pizza menu seed data)
- `add-pizza-size-half.sql` and related migration scripts

---

## Infrastructure

A **new Azure SQL database** is created from scratch on the existing server (`gustavomarinho2004.database.windows.net`). A single SQL script (`database/init.sql`) creates all tables, constraints, and indexes. No data migration is needed — the system has no production data.

Steps:
1. Create new database via Azure Portal (e.g., `RestaurantHub`)
2. Run `database/init.sql` against the new database
3. Update `.env`: `DB_NAME=RestaurantHub`
4. Deploy updated API

---

## Files Affected

| File | Change |
|------|--------|
| `database/init.sql` | Full rewrite — new schema |
| `src/database/tenantContext.ts` | Rename + remove `dbName` |
| `src/database/mssqlClient.ts` | Replace Map pool with singleton |
| `src/database/masterDb.ts` | Remove — masterDb merges into single DB |
| `src/services/tenant.service.ts` | Rename + remove DB provisioning |
| `src/services/auth.service.ts` | Remove `dbName` from JWT, update register flow |
| `src/middlewares/auth.middleware.ts` | Update context shape |
| `src/repositories/auth.repository.ts` | Rename tenant→business references |
| `src/repositories/customer.repository.ts` | Add `businessId` filter |
| `src/repositories/product.repository.ts` | Add `businessId` filter + variations |
| `src/repositories/order.repository.ts` | Add `businessId` filter + variations |
| `src/repositories/dashboard.repository.ts` | Add `businessId` filter |
| `src/models/entities/Product.ts` | Add `variations` field |
| `src/models/entities/Order.ts` | Update `OrderItem` shape |
| `src/models/entities/` | New: `ProductVariation.ts`, `OrderItemVariation.ts` |
| `src/controllers/product.controller.ts` | Add variation endpoints |
| `src/routes/product.routes.ts` | Add variation routes |
| `src/dtos/auth.dto.ts` | Remove `dbName` |
| `src/dtos/product.dto.ts` | Add variation DTOs |
| `src/dtos/order.dto.ts` | Update item DTO with variations |
| `src/services/order.service.ts` | Remove pizza logic, add variation price calc |
| `src/services/whatsapp.service.ts` | Remove hardcoded tenant context |
| `package.json` | Rename `pizzaria-api` → `restaurant-api` |
| `src/scripts/seed-master.ts` | Update for new schema |
| `src/scripts/migrate-azure.ts` | Remove (no longer needed) |
