const { Pool } = require('pg');
require('dotenv').config();

console.log('🔍 Verificando configuración de PostgreSQL...');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL definida:', !!process.env.DATABASE_URL);

// Verificar que DATABASE_URL existe
if (!process.env.DATABASE_URL) {
  console.error('❌ ERROR CRÍTICO: DATABASE_URL no está definida en las variables de entorno');
  console.error('Por favor, configura DATABASE_URL en Railway');
  process.exit(1);
}

// Validar formato de DATABASE_URL
try {
  new URL(process.env.DATABASE_URL);
  console.log('✅ DATABASE_URL tiene formato válido');
} catch (error) {
  console.error('❌ ERROR: DATABASE_URL no es una URL válida:', process.env.DATABASE_URL);
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Función mejorada de inicialización
const initializePostgreSQL = async () => {
  let client;
  try {
    console.log('🔄 Conectando a PostgreSQL...');
    
    // Probar la conexión
    client = await pool.connect();
    console.log('✅ Conexión a PostgreSQL exitosa');

    // Crear tablas si no existen
    console.log('🔄 Creando tablas...');
    
    // Tabla de usuarios
    await client.query(`
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
    await client.query(`
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
    await client.query(`
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

    // Crear índices
    await client.query('CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, date)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_employees_dni ON employees(dni)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_employees_type ON employees(type)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');

    // Insertar usuario admin por defecto si no existe
    const bcrypt = require('bcryptjs');
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    
    const adminExists = await client.query(
      'SELECT id FROM users WHERE username = $1', 
      ['admin']
    );

    if (adminExists.rows.length === 0) {
      await client.query(
        `INSERT INTO users (username, password, role) VALUES ($1, $2, $3)`,
        ['admin', hashedPassword, 'super_admin']
      );
      console.log('✅ Usuario admin creado por defecto');
    } else {
      console.log('✅ Usuario admin ya existe');
    }

    console.log('✅ Base de datos PostgreSQL inicializada correctamente');
    
  } catch (error) {
    console.error('❌ Error inicializando PostgreSQL:', error.message);
    console.error('Stack trace:', error.stack);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

// Funciones de consulta
const runQuery = (text, params) => pool.query(text, params);

const getQuery = async (text, params) => {
  const result = await pool.query(text, params);
  return result.rows[0];
};

const allQuery = async (text, params) => {
  const result = await pool.query(text, params);
  return result.rows;
};

// Health check de la base de datos
const healthCheck = async () => {
  try {
    const result = await pool.query('SELECT NOW() as current_time');
    return {
      status: 'healthy',
      database: 'PostgreSQL',
      current_time: result.rows[0].current_time
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
};

module.exports = {
  pool,
  initializePostgreSQL,
  runQuery,
  getQuery,
  allQuery,
  healthCheck
};