const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
require('dotenv').config();

const sqliteDb = new sqlite3.Database('./attendance.db');
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function migrateData() {
  try {
    console.log('🔄 Iniciando migración de SQLite a PostgreSQL...');

    // Migrar usuarios
    const users = await new Promise((resolve, reject) => {
      sqliteDb.all('SELECT * FROM users WHERE is_active = 1', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    for (const user of users) {
      await pgPool.query(
        `INSERT INTO users (username, password, role, is_active, created_at, updated_at) 
         VALUES ($1, $2, $3, $4, $5, $6) 
         ON CONFLICT (username) DO NOTHING`,
        [user.username, user.password, user.role, user.is_active, user.created_at, user.updated_at]
      );
    }
    console.log(`✅ ${users.length} usuarios migrados`);

    // Migrar empleados
    const employees = await new Promise((resolve, reject) => {
      sqliteDb.all('SELECT * FROM employees WHERE is_active = 1', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    for (const emp of employees) {
      await pgPool.query(
        `INSERT INTO employees (name, dni, type, monthly_salary, photo, qr_code, is_active, created_at, updated_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
         ON CONFLICT (dni) DO NOTHING`,
        [emp.name, emp.dni, emp.type, emp.monthly_salary, emp.photo, emp.qr_code, emp.is_active, emp.created_at, emp.updated_at]
      );
    }
    console.log(`✅ ${employees.length} empleados migrados`);

    // Migrar registros de asistencia
    const attendance = await new Promise((resolve, reject) => {
      sqliteDb.all('SELECT * FROM attendance', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    for (const record of attendance) {
      await pgPool.query(
        `INSERT INTO attendance (employee_id, date, entry_time, exit_time, hours_extra, despalillo, escogida, monado, t_despalillo, t_escogida, t_monado, prop_sabado, septimo_dia, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [record.employee_id, record.date, record.entry_time, record.exit_time, record.hours_extra, record.despalillo, record.escogida, record.monado, record.t_despalillo, record.t_escogida, record.t_monado, record.prop_sabado, record.septimo_dia, record.created_at]
      );
    }
    console.log(`✅ ${attendance.length} registros de asistencia migrados`);

    console.log('🎉 Migración completada exitosamente!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error en migración:', error);
    process.exit(1);
  }
}

migrateData();