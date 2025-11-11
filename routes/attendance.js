const express = require('express');
const { getQuery, allQuery, runQuery } = require('../config/database');
const { authenticateToken, requireAdminOrScanner } = require('../middleware/auth');

const router = express.Router();

const getLocalDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};


// POST /api/attendance/entry
router.post('/entry', authenticateToken, requireAdminOrScanner, async (req, res) => {
  let client;
  
  try {
    console.log('📥 POST /api/attendance/entry - Body:', req.body);
    
    const { employee_id } = req.body;

    if (!employee_id) {
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
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado'
      });
    }

    if (!employee.is_active) {
      return res.status(400).json({
        success: false,
        error: 'Este empleado está inactivo'
      });
    }

    // ✅ SOLUCIÓN: Usar CURRENT_DATE de PostgreSQL (consistente)
    console.log('🔄 Verificando registro existente...');

    // ✅ USAR TRANSACCIÓN para evitar race conditions
    if (process.env.NODE_ENV === 'production') {
      const { Pool } = require('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      client = await pool.connect();
      
      await client.query('BEGIN');
      
      // Verificar dentro de la transacción
      const existingRecord = await client.query(
        `SELECT id, entry_time, exit_time 
         FROM attendance 
         WHERE employee_id = $1 AND date = CURRENT_DATE
         FOR UPDATE`, // 🔒 LOCK para prevenir race conditions
        [employee_id]
      );

      if (existingRecord.rows.length > 0) {
        const record = existingRecord.rows[0];
        console.log('ℹ️ Registro existente encontrado:', record);
        
        const entryTime = record.entry_time ? 
          record.entry_time.substring(0, 5) : '--:--';
        
        if (record.exit_time) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            error: `El empleado ${employee.name} ya completó su jornada hoy. No puede registrar otra entrada.`
          });
        } else {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            error: `El empleado ${employee.name} ya tiene una entrada registrada hoy a las ${entryTime}. Registre la salida primero.`
          });
        }
      }

      // ✅ INSERTAR con fecha/hora consistentes de PostgreSQL
      console.log('💾 Insertando nuevo registro de entrada...');
      
      const result = await client.query(
        `INSERT INTO attendance (employee_id, date, entry_time) 
         VALUES ($1, CURRENT_DATE, CURRENT_TIME) 
         RETURNING *`,
        [employee_id]
      );

      await client.query('COMMIT');
      
      const newRecord = result.rows[0];
      console.log('✅ Entrada registrada exitosamente:', {
        id: newRecord.id,
        employee: employee.name,
        date: newRecord.date,
        entry_time: newRecord.entry_time
      });
      
      res.json({
        success: true,
        message: `Entrada registrada para ${employee.name}`,
        data: newRecord
      });
      
    } else {
      // SQLite (desarrollo)
      const today = new Date().toISOString().split('T')[0];
      
      const existingRecord = await getQuery(
        `SELECT id, entry_time, exit_time 
         FROM attendance 
         WHERE employee_id = $1 AND date = $2`,
        [employee_id, today]
      );

      if (existingRecord) {
        console.log('ℹ️ Registro existente encontrado:', existingRecord);
        
        const entryTime = existingRecord.entry_time ? 
          existingRecord.entry_time.substring(0, 5) : '--:--';
        
        if (existingRecord.exit_time) {
          return res.status(400).json({
            success: false,
            error: `El empleado ${employee.name} ya completó su jornada hoy. No puede registrar otra entrada.`
          });
        } else {
          return res.status(400).json({
            success: false,
            error: `El empleado ${employee.name} ya tiene una entrada registrada hoy a las ${entryTime}. Registre la salida primero.`
          });
        }
      }

      const result = await runQuery(
        `INSERT INTO attendance (employee_id, date, entry_time) 
         VALUES ($1, $2, TIME('now')) 
         RETURNING *`,
        [employee_id, today]
      );

      console.log('✅ Entrada registrada exitosamente');
      
      res.json({
        success: true,
        message: `Entrada registrada para ${employee.name}`,
        data: result
      });
    }

  } catch (error) {
    console.error('❌ Error registrando entrada:', error);
    
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
      // Si es un string de tiempo PostgreSQL (HH:MM:SS)
      if (timeString.match(/^\d{1,2}:\d{2}:\d{2}$/)) {
        return timeString.substring(0, 5); // Extraer HH:MM
      }
    }
    
    // Si es un objeto Date o string ISO
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

// POST /api/attendance/exit - CORREGIDO
router.post('/exit', authenticateToken, requireAdminOrScanner, async (req, res) => {
  console.log('🚨 ===== INICIANDO REGISTRO DE SALIDA =====');
  console.log('📥 DATOS RECIBIDOS:', JSON.stringify(req.body, null, 2));

  try {
    const { employee_id, hours_extra = 0, despalillo = 0, escogida = 0, monado = 0 } = req.body;
    const today = getLocalDate();

    if (!employee_id) {
      return res.status(400).json({
        success: false,
        error: 'ID de empleado es requerido'
      });
    }

    const employeeIdNum = parseInt(employee_id);
    if (isNaN(employeeIdNum) || employeeIdNum <= 0) {
      return res.status(400).json({
        success: false,
        error: 'ID de empleado no es válido'
      });
    }

    // ✅ CORREGIDO: ? → $1
    const employee = await getQuery(
      'SELECT id, name, type, is_active FROM employees WHERE id = $1',
      [employeeIdNum]
    );

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado'
      });
    }

    if (!employee.is_active) {
      return res.status(400).json({
        success: false,
        error: 'Empleado está inactivo'
      });
    }

    // ✅ CORREGIDO: ? → $1, $2
    const attendanceRecord = await getQuery(
      `SELECT a.*, e.name, e.type 
       FROM attendance a 
       JOIN employees e ON a.employee_id = e.id 
       WHERE a.employee_id = $1 AND a.date = $2 AND a.exit_time IS NULL`,
      [employeeIdNum, today]
    );

    if (!attendanceRecord) {
      return res.status(400).json({
        success: false,
        error: 'No existe una entrada pendiente para hoy. Registre la entrada primero.'
      });
    }

    const hoursExtraNum = parseFloat(hours_extra) || 0;
    const despalilloNum = parseFloat(despalillo) || 0;
    const escogidaNum = parseFloat(escogida) || 0;
    const monadoNum = parseFloat(monado) || 0;

    let t_despalillo = 0;
    let t_escogida = 0;
    let t_monado = 0;
    let prop_sabado = 0;
    let septimo_dia = 0;

    if (employee.type === 'Producción') {
      t_despalillo = despalilloNum * 80;
      t_escogida = escogidaNum * 70;
      t_monado = monadoNum * 1;
      const total_produccion = t_despalillo + t_escogida + t_monado;
      prop_sabado = total_produccion * 0.90909;
      septimo_dia = total_produccion * 0.181818;
    }

    const exitTime = new Date().toLocaleTimeString('es-HN', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    console.log('🔄 Ejecutando UPDATE...');
    
    // ✅ CORREGIDO: ? → $1, $2, etc.
    const updateResult = await runQuery(
      `UPDATE attendance 
       SET exit_time = $1, 
           hours_extra = $2, 
           despalillo = $3, 
           escogida = $4, 
           monado = $5,
           t_despalillo = $6, 
           t_escogida = $7, 
           t_monado = $8, 
           prop_sabado = $9, 
           septimo_dia = $10
       WHERE id = $11`,
      [
        exitTime, 
        hoursExtraNum, 
        despalilloNum, 
        escogidaNum, 
        monadoNum,
        t_despalillo, 
        t_escogida, 
        t_monado, 
        prop_sabado, 
        septimo_dia,
        attendanceRecord.id
      ]
    );

    console.log('✅ UPDATE exitoso:', updateResult);

    res.json({
      success: true,
      message: `✅ Salida registrada exitosamente para ${employee.name} a las ${exitTime}`,
      data: {
        employee_id: employeeIdNum,
        employee_name: employee.name,
        employee_type: employee.type,
        date: today,
        entry_time: attendanceRecord.entry_time,
        exit_time: exitTime,
        hours_extra: hoursExtraNum,
        despalillo: despalilloNum,
        escogida: escogidaNum,
        monado: monadoNum,
        t_despalillo,
        t_escogida,
        t_monado,
        prop_sabado,
        septimo_dia,
        status: 'completed'
      }
    });

  } catch (error) {
    console.error('🚨 ERROR en registro de salida:', error.message);
    
    res.status(500).json({
      success: false,
      error: `Error al registrar salida: ${error.message}`
    });
  }
});

// GET /api/attendance/today - CORREGIDO
router.get('/today', authenticateToken, async (req, res) => {
  try {
    console.log('📅 Obteniendo registros de hoy...');
    
    // ✅ USAR CURRENT_DATE de PostgreSQL (timezone del servidor)
    const records = await allQuery(`
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

    console.log(`✅ Encontrados ${records.length} registros para hoy`);
    
    res.json({
      success: true,
      data: records,
      count: records.length
    });

  } catch (error) {
    console.error('Error obteniendo registros de hoy:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener registros de hoy'
    });
  }
});

module.exports = router;                