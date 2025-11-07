const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Script de migración automática
const initializePostgreSQL = async () => {
  try {
    console.log('🔄 Inicializando PostgreSQL...');
    
    // Tabla de usuarios
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('super_admin', 'scanner', 'viewer')),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de empleados
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        dni VARCHAR(13) UNIQUE NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('Producción', 'Al Dia')),
        monthly_salary DECIMAL(10,2) DEFAULT 0,
        photo TEXT,
        qr_code TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de asistencia
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        entry_time TIME,
        exit_time TIME,
        hours_extra DECIMAL(5,2) DEFAULT 0,
        despalillo DECIMAL(8,2) DEFAULT 0,
        escogida DECIMAL(8,2) DEFAULT 0,
        monado DECIMAL(8,2) DEFAULT 0,
        t_despalillo DECIMAL(10,2) DEFAULT 0,
        t_escogida DECIMAL(10,2) DEFAULT 0,
        t_monado DECIMAL(10,2) DEFAULT 0,
        prop_sabado DECIMAL(10,2) DEFAULT 0,
        septimo_dia DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, date)
      )
    `);

    // Índices para performance
    await pool.query('CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, date)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_employees_dni ON employees(dni)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_employees_type ON employees(type)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');

    console.log('✅ Base de datos PostgreSQL inicializada correctamente');
  } catch (error) {
    console.error('❌ Error inicializando PostgreSQL:', error);
    throw error;
  }
};

// Funciones de consulta adaptadas para PostgreSQL
const runQuery = (text, params) => pool.query(text, params);
const getQuery = async (text, params) => {
  const result = await pool.query(text, params);
  return result.rows[0];
};
const allQuery = async (text, params) => {
  const result = await pool.query(text, params);
  return result.rows;
};

module.exports = {
  pool,
  initializePostgreSQL,
  runQuery,
  getQuery,
  allQuery
};