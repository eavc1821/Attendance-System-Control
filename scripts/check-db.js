require('dotenv').config();

console.log('🔍 Verificando configuración de base de datos...');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '✅ Definida' : '❌ NO definida');
console.log('NODE_ENV:', process.env.NODE_ENV);

if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('✅ Conexión a PostgreSQL exitosa:', result.rows[0].now);
    client.release();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error conectando a PostgreSQL:', error.message);
    process.exit(1);
  }
} else {
  console.log('ℹ️  Usando SQLite (desarrollo)');
  process.exit(0);
}