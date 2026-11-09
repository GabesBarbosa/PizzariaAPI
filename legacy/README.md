# legacy/

Arquivos da primeira versão do projeto (Azure + SQL Server), guardados só como histórico.
**Nada aqui é compilado nem usado pela API atual**, que roda em Node.js + MySQL no Railway.

- `database/` — schema `init.sql` e scripts de migração/seed para SQL Server (pacote `mssql`).
  O schema válido hoje é `database/init_mysql.sql`.
- `scripts/` — `run-init.js`, `run-seed.js`, `checkDb.js` (SQL Server).
- `services/` — versões antigas do chatbot por menu fixo (não são importadas).
- `workflows/` — deploy antigo no Azure Web App.
- `migrate-express-to-functions.patch` — tentativa de rodar a API como Azure Functions.
- `docs/` — planos de refatoração da época do Azure SQL.
