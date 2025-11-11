const express = require('express');
const { getQuery, allQuery, runQuery } = require('../config/database');
const { authenticateToken, requireAdminOrScanner } = require('../middleware/auth');

const router = express.Router();

// ✅ CORREGIDO: Función mejorada para obtener fecha/hora local
const getLocalDateTime = () => {
  const now = new Date();
  
  // Ajustar a zona horaria de América Central (UTC-6)
  const offset = -6 * 60; // UTC-6 en minutos
  const localTime = new Date(now.getTime() + offset * 60 * 1000);
  
  const year = localTime.getUTCFullYear();
  const month = String(localTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(localTime.getUTCDate()).padStart(2, '0');
  const hours = String(localTime.getUTCHours()).padStart(2, '0');
  const minutes = String(localTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(localTime.getUTCSeconds()).padStart(2, '0');
  
  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}:${seconds}`
  };
};

// POST /api/attendance/entry - CORREGIDO
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

    // ✅ USAR FECHA/HORA LOCAL CORREGIDA
    const { date: today, time: currentTime } = getLocalDateTime();
    console.log('🕐 Fecha/hora local:', today, currentTime);

    if (process.env.NODE_ENV === 'production') {
      const { Pool } = require('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // ✅ VERIFICAR EXISTENCIA CON FECHA LOCAL
        const existingRecord = await client.query(
          `SELECT id, entry_time, exit_time 
           FROM attendance 
           WHERE employee_id = $1 AND date = $2`,
          [employee_id, today]
        );

        if (existingRecord.rows.length > 0) {
          const record = existingRecord.rows[0];
          console.log('ℹ️ Registro existente encontrado:', record);
          
          const entryTime = record.entry_time ? 
            formatTimeForDisplay(record.entry_time) : '--:--';
          
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

        // ✅ INSERTAR CON FECHA/HORA LOCAL EXPLÍCITA
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
        
        res.json({
          success: true,
          message: `Entrada registrada para ${employee.name} a las ${formatTimeForDisplay(currentTime)}`,
          data: newRecord
        });
        
      } catch (transactionError) {
        await client.query('ROLLBACK');
        throw transactionError;
      } finally {
        client.release();
      }
    } else {
      // SQLite (desarrollo)
      const { date: today, time: currentTime } = getLocalDateTime();
      
      const existingRecord = await getQuery(
        `SELECT id, entry_time, exit_time 
         FROM attendance 
         WHERE employee_id = $1 AND date = $2`,
        [employee_id, today]
      );

      if (existingRecord) {
        console.log('ℹ️ Registro existente encontrado:', existingRecord);
        
        const entryTime = existingRecord.entry_time ? 
          formatTimeForDisplay(existingRecord.entry_time) : '--:--';
        
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

      // ✅ USAR FECHA/HORA LOCAL PARA SQLITE
      const result = await runQuery(
        `INSERT INTO attendance (employee_id, date, entry_time) 
         VALUES ($1, $2, $3) 
         RETURNING *`,
        [employee_id, today, currentTime]
      );

      console.log('✅ Entrada registrada exitosamente');
      
      res.json({
        success: true,
        message: `Entrada registrada para ${employee.name} a las ${formatTimeForDisplay(currentTime)}`,
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
      // ✅ CONSULTAR REGISTRO EXISTENTE CON FECHA LOCAL
      const { date: today } = getLocalDateTime();
      try {
        const existingRecord = await getQuery(
          `SELECT a.*, e.name 
           FROM attendance a 
           JOIN employees e ON a.employee_id = e.id 
           WHERE a.employee_id = $1 AND a.date = $2`,
          [employee_id, today]
        );

        if (existingRecord) {
          if (existingRecord.exit_time) {
            return res.status(400).json({
              success: false,
              error: `El empleado ${existingRecord.name} ya completó su jornada hoy. No puede registrar otra entrada.`
            });
          } else {
            const entryTime = existingRecord.entry_time ? 
              formatTimeForDisplay(existingRecord.entry_time) : '--:--';
            
            return res.status(400).json({
              success: false,
              error: `El empleado ${existingRecord.name} ya tiene una entrada registrada hoy a las ${entryTime}. Registre la salida primero.`
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

// POST /api/attendance/exit - CORREGIDO CON ZONA HORARIA
router.post('/exit', authenticateToken, requireAdminOrScanner, async (req, res) => {
  console.log('🚨 ===== INICIANDO REGISTRO DE SALIDA =====');
  console.log('📥 DATOS RECIBIDOS:', JSON.stringify(req.body, null, 2));

  try {
    const { employee_id, hours_extra = 0, despalillo = 0, escogida = 0, monado = 0 } = req.body;
    
    // ✅ USAR FECHA LOCAL CORREGIDA
    const { date: today, time: exitTime } = getLocalDateTime();

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

    // ✅ USAR FECHA LOCAL EN LA CONSULTA
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

    console.log('🔄 Ejecutando UPDATE...');
    
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
      message: `✅ Salida registrada exitosamente para ${employee.name} a las ${formatTimeForDisplay(exitTime)}`,
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

// GET /api/attendance/today - CORREGIDO CON ZONA HORARIA
router.get('/today', authenticateToken, async (req, res) => {
  try {
    console.log('📅 Obteniendo registros de hoy...');
    
    // ✅ USAR FECHA LOCAL
    const { date: today } = getLocalDateTime();
    
    const records = await allQuery(
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

    console.log(`✅ Encontrados ${records.length} registros para hoy (${today})`);
    
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

// ✅ FUNCIÓN AUXILIAR MEJORADA para formatear tiempo
function formatTimeForDisplay(timeString) {
  if (!timeString) return '--:--';
  try {
    if (typeof timeString === 'string') {
      // Si es un string de tiempo (HH:MM:SS)
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

module.exports = router;