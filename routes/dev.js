const express = require('express');
const { runQuery, allQuery, getQuery } = require('../config/database');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');

const router = express.Router();

// Resetear base de datos (mantener usuarios) - ACTUALIZADO PARA POSTGRESQL
router.delete('/reset-database', authenticateToken, requireSuperAdmin, async (req, res) => {
  let client;
  
  try {
    console.log('🧹 SOLICITUD DE RESET - Usuario:', req.user?.username);
    
    // Validar entorno de producción
    if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DB_RESET) {
      return res.status(403).json({
        success: false,
        error: 'Reset de base de datos no permitido en producción sin ALLOW_DB_RESET=true'
      });
    }

    console.log('🔄 Iniciando reset de base de datos PostgreSQL...');

    // Obtener conteos antes del reset para el reporte
    const statsBefore = await getDatabaseStats();

    // ✅ POSTGRESQL: Usar transacción para mayor seguridad
    if (process.env.NODE_ENV === 'production') {
      const { Pool } = require('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      
      client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        console.log('🗑️ Eliminando registros de attendance...');
        await client.query('DELETE FROM attendance');
        
        console.log('🗑️ Eliminando registros de employees...');
        await client.query('DELETE FROM employees');
        
        console.log('🔁 Reseteando secuencias...');
        await client.query('ALTER SEQUENCE employees_id_seq RESTART WITH 1');
        await client.query('ALTER SEQUENCE attendance_id_seq RESTART WITH 1');
        
        await client.query('COMMIT');
        console.log('✅ Transacción completada exitosamente');
        
      } catch (transactionError) {
        await client.query('ROLLBACK');
        console.error('❌ Error en transacción, haciendo rollback:', transactionError);
        throw transactionError;
      } finally {
        client.release();
      }
    } else {
      // ✅ SQLITE (para desarrollo)
      console.log('🗑️ Eliminando registros de attendance...');
      await runQuery('DELETE FROM attendance');
      
      console.log('🗑️ Eliminando registros de employees...');
      await runQuery('DELETE FROM employees');
      
      console.log('🔁 Reseteando autoincrement...');
      await runQuery('DELETE FROM sqlite_sequence WHERE name IN ("attendance", "employees")');
    }

    // Obtener conteos después del reset
    const statsAfter = await getDatabaseStats();

    console.log('✅ Reset de base de datos completado');
    console.log('📊 Estadísticas del reset:');
    console.log('   👥 Usuarios:', statsAfter.users, '(mantenidos)');
    console.log('   👨‍💼 Empleados:', statsAfter.employees, '(eliminados: ' + statsBefore.employees + ')');
    console.log('   📅 Asistencia:', statsAfter.attendance, '(eliminados: ' + statsBefore.attendance + ')');

    res.json({
      success: true,
      message: 'Base de datos reseteada exitosamente',
      data: {
        before_reset: statsBefore,
        after_reset: statsAfter,
        summary: {
          users_preserved: statsAfter.users,
          employees_deleted: statsBefore.employees - statsAfter.employees,
          attendance_deleted: statsBefore.attendance - statsAfter.attendance,
          auto_increment_reset: true
        }
      }
    });

  } catch (error) {
    console.error('❌ Error durante el reset de base de datos:', error);
    
    res.status(500).json({
      success: false,
      error: 'Error al resetear base de datos: ' + error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Obtener estadísticas detalladas de la base de datos - MEJORADO
router.get('/stats', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const stats = await getDatabaseStats();
    
    res.json({
      success: true,
      data: stats,
      environment: process.env.NODE_ENV,
      database_type: process.env.NODE_ENV === 'production' ? 'PostgreSQL' : 'SQLite',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo estadísticas: ' + error.message
    });
  }
});

// ✅ NUEVO: Endpoint para verificar secuencias de PostgreSQL
router.get('/sequences', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      const sequences = await allQuery(`
        SELECT sequencename, start_value, last_value, increment_by 
        FROM pg_sequences 
        WHERE sequencename LIKE '%_seq'
      `);
      
      res.json({
        success: true,
        data: sequences,
        database: 'PostgreSQL'
      });
    } else {
      res.json({
        success: true,
        data: { message: 'SQLite no usa secuencias PostgreSQL' },
        database: 'SQLite'
      });
    }
  } catch (error) {
    console.error('Error obteniendo secuencias:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo secuencias: ' + error.message
    });
  }
});

// ✅ NUEVO: Endpoint para limpiar solo registros de asistencia
router.delete('/clear-attendance', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    console.log('🧹 Limpiando solo registros de asistencia...');
    
    const statsBefore = await getDatabaseStats();
    
    await runQuery('DELETE FROM attendance');
    
    if (process.env.NODE_ENV === 'production') {
      await runQuery('ALTER SEQUENCE attendance_id_seq RESTART WITH 1');
    }
    
    const statsAfter = await getDatabaseStats();
    
    res.json({
      success: true,
      message: 'Registros de asistencia eliminados exitosamente',
      data: {
        before: statsBefore.attendance,
        after: statsAfter.attendance,
        deleted: statsBefore.attendance - statsAfter.attendance
      }
    });
    
  } catch (error) {
    console.error('Error limpiando asistencia:', error);
    res.status(500).json({
      success: false,
      error: 'Error limpiando registros de asistencia: ' + error.message
    });
  }
});

// Función auxiliar para obtener estadísticas de la base de datos
async function getDatabaseStats() {
  try {
    const [usersResult, employeesResult, attendanceResult, todayAttendanceResult] = await Promise.all([
      allQuery('SELECT COUNT(*) as count FROM users WHERE is_active = true'),
      allQuery('SELECT COUNT(*) as count FROM employees WHERE is_active = true'),
      allQuery('SELECT COUNT(*) as count FROM attendance'),
      allQuery('SELECT COUNT(*) as count FROM attendance WHERE date = CURRENT_DATE')
    ]);

    // Normalizar resultados para ambos entornos (PostgreSQL y SQLite)
    const normalizeCount = (result) => {
      if (Array.isArray(result) && result[0] && result[0].count !== undefined) {
        return parseInt(result[0].count);
      }
      return 0;
    };

    return {
      users: normalizeCount(usersResult),
      employees: normalizeCount(employeesResult),
      attendance: normalizeCount(attendanceResult),
      attendance_today: normalizeCount(todayAttendanceResult),
      last_updated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    return {
      users: 0,
      employees: 0,
      attendance: 0,
      attendance_today: 0,
      error: error.message
    };
  }
}

module.exports = router;