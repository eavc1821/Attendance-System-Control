const express = require('express');
const { getQuery, allQuery, runQuery } = require('../config/database');
const { authenticateToken, requireAdminOrScanner } = require('../middleware/auth');

const router = express.Router();

// ✅ CACHE PARA PREVENIR REQUESTS DUPLICADOS DESDE EL MÓVIL
const pendingRequests = new Map();
const REQUEST_TIMEOUT = 3000; // 3 segundos

// ✅ FUNCIÓN SIMPLIFICADA PARA FECHA/HORA LOCAL
const getCurrentLocalDateTime = () => {
  const now = new Date();
  
  // Para América Central (UTC-6)
  const localTime = new Date(now.getTime() - (6 * 60 * 60 * 1000));
  
  const year = localTime.getUTCFullYear();
  const month = String(localTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(localTime.getUTCDate()).padStart(2, '0');
  const hours = String(localTime.getUTCHours()).padStart(2, '0');
  const minutes = String(localTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(localTime.getUTCSeconds()).padStart(2, '0');
  
  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}:${seconds}`,
    displayTime: `${hours}:${minutes}`
  };
};

// ✅ MIDDLEWARE PARA PREVENIR DUPLICADOS
const preventDuplicateRequests = (req, res, next) => {
  const { employee_id } = req.body;
  const requestKey = `${employee_id}-${Date.now()}`;
  
  // Limpiar requests antiguos
  const now = Date.now();
  for (const [key, timestamp] of pendingRequests.entries()) {
    if (now - timestamp > REQUEST_TIMEOUT) {
      pendingRequests.delete(key);
    }
  }
  
  // Verificar si ya hay un request pendiente para este empleado
  for (const [key] of pendingRequests.entries()) {
    if (key.startsWith(employee_id)) {
      return res.status(429).json({
        success: false,
        error: 'Request duplicado detectado. Espere un momento.'
      });
    }
  }
  
  pendingRequests.set(requestKey, now);
  req.requestKey = requestKey;
  
  // Limpiar después de timeout
  setTimeout(() => {
    pendingRequests.delete(requestKey);
  }, REQUEST_TIMEOUT);
  
  next();
};

// POST /api/attendance/entry - SOLUCIÓN COMPLETA
router.post('/entry', authenticateToken, requireAdminOrScanner, preventDuplicateRequests, async (req, res) => {
  let client;
  
  try {
    console.log('📥 POST /api/attendance/entry - Body:', req.body);
    
    const { employee_id } = req.body;

    if (!employee_id) {
      pendingRequests.delete(req.requestKey);
      return res.status(400).json({
        success: false,
        error: 'employee_id es requerido'
      });
    }

    // Verificar que el empleado existe y está activo
    const employee = await getQuery(
      'SELECT id, name, is_active FROM employees WHERE id = $1',
      [employee_id]
    );

    if (!employee) {
      pendingRequests.delete(req.requestKey);
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado'
      });
    }

    if (!employee.is_active) {
      pendingRequests.delete(req.requestKey);
      return res.status(400).json({
        success: false,
        error: 'Este empleado está inactivo'
      });
    }

    const { date: today, time: currentTime, displayTime } = getCurrentLocalDateTime();
    console.log('🕐 Fecha/hora local calculada:', { today, currentTime, displayTime });

    if (process.env.NODE_ENV === 'production') {
      const { Pool } = require('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        console.log('🔄 Verificando registro existente...');
        
        // ✅ CONSULTA MÁS ROBUSTA CON ZONA HORARIA
        const existingRecord = await client.query(
          `SELECT id, entry_time, exit_time 
           FROM attendance 
           WHERE employee_id = $1 AND date = $2`,
          [employee_id, today]
        );

        if (existingRecord.rows.length > 0) {
          const record = existingRecord.rows[0];
          console.log('ℹ️ Registro existente encontrado:', record);
          
          const existingEntryTime = record.entry_time ? 
            formatTimeForDisplay(record.entry_time) : '--:--';
          
          await client.query('ROLLBACK');
          pendingRequests.delete(req.requestKey);
          
          if (record.exit_time) {
            return res.status(400).json({
              success: false,
              error: `El empleado ${employee.name} ya completó su jornada hoy. No puede registrar otra entrada.`
            });
          } else {
            return res.status(400).json({
              success: false,
              error: `El empleado ${employee.name} ya tiene una entrada registrada hoy a las ${existingEntryTime}. Registre la salida primero.`
            });
          }
        }

        // ✅ INSERTAR CON FECHA/HORA EXPLÍCITAS
        console.log('💾 Insertando nuevo registro de entrada...');
        
        const result = await client.query(
          `INSERT INTO attendance (employee_id, date, entry_time) 
           VALUES ($1, $2, $3) 
           RETURNING *`,
          [employee_id, today, currentTime]
        );

        await client.query('COMMIT');
        
        const newRecord = result.rows[0];
        console.log('✅ Entrada registrada exitosamente:', {
          id: newRecord.id,
          employee: employee.name,
          date: newRecord.date,
          entry_time: newRecord.entry_time
        });
        
        pendingRequests.delete(req.requestKey);
        
        res.json({
          success: true,
          message: `Entrada registrada para ${employee.name} a las ${displayTime}`,
          data: {
            ...newRecord,
            formatted_entry_time: displayTime, // ✅ HORA FORMATEADA PARA FRONTEND
            employee_name: employee.name
          }
        });
        
      } catch (transactionError) {
        await client.query('ROLLBACK');
        throw transactionError;
      } finally {
        client.release();
      }
    } else {
      // SQLite (desarrollo)
      const existingRecord = await getQuery(
        `SELECT id, entry_time, exit_time 
         FROM attendance 
         WHERE employee_id = $1 AND date = $2`,
        [employee_id, today]
      );

      if (existingRecord) {
        console.log('ℹ️ Registro existente encontrado:', existingRecord);
        
        const existingEntryTime = existingRecord.entry_time ? 
          formatTimeForDisplay(existingRecord.entry_time) : '--:--';
        
        pendingRequests.delete(req.requestKey);
        
        if (existingRecord.exit_time) {
          return res.status(400).json({
            success: false,
            error: `El empleado ${employee.name} ya completó su jornada hoy. No puede registrar otra entrada.`
          });
        } else {
          return res.status(400).json({
            success: false,
            error: `El empleado ${employee.name} ya tiene una entrada registrada hoy a las ${existingEntryTime}. Registre la salida primero.`
          });
        }
      }

      const result = await runQuery(
        `INSERT INTO attendance (employee_id, date, entry_time) 
         VALUES ($1, $2, $3) 
         RETURNING *`,
        [employee_id, today, currentTime]
      );

      console.log('✅ Entrada registrada exitosamente');
      
      pendingRequests.delete(req.requestKey);
      
      res.json({
        success: true,
        message: `Entrada registrada para ${employee.name} a las ${displayTime}`,
        data: {
          ...result,
          formatted_entry_time: displayTime, // ✅ HORA FORMATEADA PARA FRONTEND
          employee_name: employee.name
        }
      });
    }

  } catch (error) {
    console.error('❌ Error registrando entrada:', error);
    
    // Limpiar request pendiente
    pendingRequests.delete(req.requestKey);
    
    // Rollback en caso de error
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error en rollback:', rollbackError);
      }
      client.release();
    }
    
    // Manejo específico de duplicados
    if (error.code === '23505') {
      // Consultar el estado actual
      const { date: today } = getCurrentLocalDateTime();
      try {
        const existingRecord = await getQuery(
          `SELECT a.*, e.name 
           FROM attendance a 
           JOIN employees e ON a.employee_id = e.id 
           WHERE a.employee_id = $1 AND a.date = $2`,
          [employee_id, today]
        );

        if (existingRecord) {
          const existingEntryTime = existingRecord.entry_time ? 
            formatTimeForDisplay(existingRecord.entry_time) : '--:--';
            
          if (existingRecord.exit_time) {
            return res.status(400).json({
              success: false,
              error: `El empleado ${existingRecord.name} ya completó su jornada hoy. No puede registrar otra entrada.`
            });
          } else {
            return res.status(400).json({
              success: false,
              error: `El empleado ${existingRecord.name} ya tiene una entrada registrada hoy a las ${existingEntryTime}. Registre la salida primero.`
            });
          }
        }
      } catch (queryError) {
        console.error('Error consultando registro duplicado:', queryError);
      }
      
      return res.status(400).json({
        success: false,
        error: 'Ya existe un registro de asistencia para este empleado hoy'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Error al registrar entrada: ' + error.message
    });
  }
});

// ✅ FUNCIÓN AUXILIAR MEJORADA para formatear tiempo
function formatTimeForDisplay(timeString) {
  if (!timeString) return '--:--';
  try {
    if (typeof timeString === 'string') {
      // Si es un string de tiempo (HH:MM:SS)
      if (timeString.match(/^\d{1,2}:\d{2}:\d{2}/)) {
        return timeString.substring(0, 5); // Extraer HH:MM
      }
    }
    
    // Si es un objeto Date
    const date = new Date(timeString);
    if (!isNaN(date.getTime())) {
      return date.toLocaleTimeString('es-HN', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      });
    }
    
    return '--:--';
  } catch (error) {
    console.error('Error formateando tiempo:', error);
    return '--:--';
  }
}

// GET /api/attendance/today - RUTA CORREGIDA
router.get('/today', authenticateToken, async (req, res) => {
  try {
    console.log('📅 Obteniendo registros de hoy...');
    
    let records;
    let today;

    if (process.env.NODE_ENV === 'production') {
      // PostgreSQL
      records = await allQuery(`
        SELECT 
          a.*,
          e.name as employee_name,
          e.dni as employee_dni, 
          e.type as employee_type
        FROM attendance a
        JOIN employees e ON a.employee_id = e.id
        WHERE a.date = CURRENT_DATE
        ORDER BY a.entry_time DESC
      `);
      
      // Obtener fecha actual para el mensaje
      const dateResult = await getQuery('SELECT CURRENT_DATE as today');
      today = dateResult.today;
    } else {
      // SQLite
      today = new Date().toISOString().split('T')[0];
      records = await allQuery(
        `SELECT 
          a.*,
          e.name as employee_name,
          e.dni as employee_dni, 
          e.type as employee_type
        FROM attendance a
        JOIN employees e ON a.employee_id = e.id
        WHERE a.date = $1
        ORDER BY a.entry_time DESC`,
        [today]
      );
    }

    console.log(`✅ Encontrados ${records.length} registros para hoy (${today})`);
    
    res.json({
      success: true,
      data: records,
      count: records.length,
      current_date: today
    });

  } catch (error) {
    console.error('❌ Error obteniendo registros de hoy:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener registros de hoy: ' + error.message
    });
  }
});

module.exports = router;