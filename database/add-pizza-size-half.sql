-- Adds size (normal/brotinho) and meio-a-meio support to OrderItems
ALTER TABLE OrderItems ADD size NVARCHAR(20) NOT NULL DEFAULT 'normal';
ALTER TABLE OrderItems ADD halfProductId UNIQUEIDENTIFIER NULL;

-- FK for the second half product
ALTER TABLE OrderItems ADD CONSTRAINT FK_OrderItems_HalfProduct
  FOREIGN KEY (halfProductId) REFERENCES Products(id);
