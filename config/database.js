// config/database.js - Configuración unificada para ambos entornos

let dbConfig;

if (process.env.NODE_ENV === 'production') {
  console.log('📊 Modo: PostgreSQL (Producción)');
  
  // Configuración para PostgreSQL
  const { Pool } = require('pg');
  
  // Validar DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL no está definida para PostgreSQL');
    process.exit(1);
  }
  
  const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // ✅ ESTABLECER ZONA HORIA EN LA CONEXIÓN
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 20
});
  
  // Funciones para PostgreSQL
  dbConfig = {
    initializeDatabase: async () => {
      console.log('🔄 Inicializando PostgreSQL...');
      const client = await pool.connect();
      
      try {
        // Crear tablas (el mismo código que en database-pg.js)
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

        // Insertar usuario admin
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
          console.log('✅ Usuario admin creado');
        }

        console.log('✅ PostgreSQL inicializado correctamente');
      } finally {
        client.release();
      }
    },
    
    runQuery: (text, params) => pool.query(text, params),
    
    getQuery: async (text, params) => {
      const result = await pool.query(text, params);
      return result.rows[0];
    },
    
    allQuery: async (text, params) => {
      const result = await pool.query(text, params);
      return result.rows;
    },
    
    healthCheck: async () => {
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
    }
  };
} else {
  console.log('📊 Modo: SQLite (Desarrollo)');
  
  // Configuración para SQLite (solo desarrollo)
  const sqlite3 = require('sqlite3').verbose();
  const path = require('path');
  const bcrypt = require('bcryptjs');

  const dbPath = path.join(__dirname, '..', 'attendance.db');
  const db = new sqlite3.Database(dbPath);

  // Funciones para SQLite (mantener tu código actual)
  dbConfig = {
    initializeDatabase: () => {
      return new Promise((resolve, reject) => {
        db.serialize(() => {
          // Tu código actual de inicialización de SQLite...
          db.run(`CREATE TABLE IF NOT EXISTS employees (...)`, (err) => {
            if (err) console.error('Error creando tabla employees:', err);
          });

          // ... resto de tu código SQLite actual

          // Insertar super usuario
          const hashedPassword = bcrypt.hashSync('admin123', 10);
          
          db.get('SELECT id FROM users WHERE username = ?', ['admin'], (err, row) => {
            if (err) {
              reject(err);
              return;
            }
            
            if (!row) {
              db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`, 
                ['admin', hashedPassword, 'super_admin'], function(err) {
                if (err) {
                  reject(err);
                } else {
                  console.log('✅ Usuario admin creado (SQLite)');
                  resolve();
                }
              });
            } else {
              console.log('✅ Usuario admin ya existe (SQLite)');
              resolve();
            }
          });
        });
      });
    },

    runQuery: (sql, params = []) => {
      return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
          if (err) {
            reject(err);
          } else {
            resolve({ id: this.lastID, changes: this.changes });
          }
        });
      });
    },

    getQuery: (sql, params = []) => {
      return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        });
      });
    },

    allQuery: (sql, params = []) => {
      return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      });
    },

    healthCheck: async () => {
      return {
        status: 'healthy',
        database: 'SQLite',
        current_time: new Date().toISOString()
      };
    }
  };
}

module.exports = dbConfig;