const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'attendance.db');
const db = new sqlite3.Database(dbPath);

// Inicializar base de datos
const initializeDatabase = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Tabla de empleados
      db.run(`CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        dni TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('Producción', 'Al Dia')),
        monthly_salary REAL DEFAULT 0,
        photo TEXT,
        qr_code TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) console.error('Error creando tabla employees:', err);
      });

      // Tabla de usuarios
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('super_admin', 'scanner', 'viewer')),
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) console.error('Error creando tabla users:', err);
      });

      // Tabla de registros de asistencia
      db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        entry_time TEXT,
        exit_time TEXT,
        hours_extra REAL DEFAULT 0,
        despalillo REAL DEFAULT 0,
        escogida REAL DEFAULT 0,
        monado REAL DEFAULT 0,
        t_despalillo REAL DEFAULT 0,        
        t_escogida REAL DEFAULT 0,          
        t_monado REAL DEFAULT 0,            
        prop_sabado REAL DEFAULT 0,         
        septimo_dia REAL DEFAULT 0,    
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees (id),
        UNIQUE(employee_id, date)
      )`, (err) => {
        if (err) console.error('Error creando tabla attendance:', err);
      });

      // Crear índices
      db.run('CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)');
      db.run('CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, date)');
      db.run('CREATE INDEX IF NOT EXISTS idx_employees_dni ON employees(dni)');
      db.run('CREATE INDEX IF NOT EXISTS idx_employees_type ON employees(type)');

      // Insertar super usuario por defecto
      const hashedPassword = bcrypt.hashSync('admin123', 10);
      
      db.get('SELECT id FROM users WHERE username = ?', ['admin'], (err, row) => {
        if (err) {
          console.error('Error verificando usuario admin:', err);
          reject(err);
          return;
        }
        
        if (!row) {
          db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`, 
            ['admin', hashedPassword, 'super_admin'], function(err) {
            if (err) {
              console.error('Error creando usuario admin:', err);
              reject(err);
            } else {
              console.log('✅ Usuario admin creado por defecto');
              resolve();
            }
          });
        } else {
          console.log('✅ Usuario admin ya existe');
          resolve();
        }
      });
    });
  });
};

// Función para ejecutar consultas
const runQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
};

// Función para obtener un registro
const getQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
};

// Función para obtener múltiples registros
const allQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

module.exports = {
  db,
  initializeDatabase,
  runQuery,
  getQuery,
  allQuery
};