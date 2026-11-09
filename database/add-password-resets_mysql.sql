-- RF05: recuperação de senha por e-mail.
-- Rodar uma vez no banco MySQL do Railway (também já está em init_mysql.sql).
CREATE TABLE IF NOT EXISTS PasswordResets (
  id         CHAR(36) NOT NULL PRIMARY KEY,
  userId     CHAR(36) NOT NULL,
  tokenHash  CHAR(64) NOT NULL,          -- SHA-256 do token; o token puro só vai no e-mail
  expiresAt  DATETIME NOT NULL,          -- UTC
  usedAt     DATETIME NULL,
  createdAt  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT FK_PasswordResets_Users FOREIGN KEY (userId) REFERENCES Users(id),
  INDEX IX_PasswordResets_TokenHash (tokenHash)
);
