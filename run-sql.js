const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'metro.proxy.rlwy.net:41776',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'IJtdkWflUZrKBmjzzMgUKCPhVaKfVuCn',
  database: process.env.PGDATABASE || 'railway',
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    console.log('✅ Conectando a PostgreSQL...');
    await pool.query(`
      ALTER TABLE attendance ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE attendance ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);
    console.log('✅ Columnas agregadas correctamente.');
  } catch (err) {
    console.error('❌ Error ejecutando SQL:', err.message);
  } finally {
    await pool.end();
  }
})();