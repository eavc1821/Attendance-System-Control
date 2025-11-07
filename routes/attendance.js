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

// POST /api/attendance/entry - Registrar entrada CON FECHA/HORA MEJORADA
router.post('/entry', authenticateToken, requireAdminOrScanner, async (req, res) => {
  try {
    const { employee_id } = req.body;
     const today = getLocalDate();

    console.log('📥 Recibiendo solicitud de entrada:', { employee_id, today });

    if (!employee_id) {
      return res.status(400).json({
        success: false,
        error: 'ID de empleado es requerido'
      });
    }

    // Verificar si el empleado existe y está activo
    const employee = await getQuery(
      'SELECT id, name, type FROM employees WHERE id = ? AND is_active = 1',
      [employee_id]
    );

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado o inactivo'
      });
    }

    // Verificar si ya existe registro para hoy
    const existingRecord = await getQuery(
      'SELECT id, exit_time FROM attendance WHERE employee_id = ? AND date = ?',
      [employee_id, today]
    );

    if (existingRecord) {
      if (!existingRecord.exit_time) {
        return res.status(400).json({
          success: false,
          error: 'Ya existe una entrada activa para hoy. Registre la salida primero.'
        });
      } else {
        return res.status(400).json({
          success: false,
          error: 'El empleado ya completó su jornada hoy. No puede registrar otra entrada.'
        });
      }
    }

    // Obtener fecha y hora actual en formato completo
    const now = new Date();
    const entryTime = now.toLocaleTimeString('es-HN', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const entryDateTime = now.toISOString(); // Guardar timestamp completo

    console.log('⏰ Registrando entrada:', { entryTime, entryDateTime });

    // Registrar entrada
    const result = await runQuery(
      'INSERT INTO attendance (employee_id, date, entry_time, created_at) VALUES (?, ?, ?, ?)',
      [employee_id, today, entryTime, entryDateTime]
    );

    console.log('✅ Entrada registrada con ID:', result.id);

    res.status(201).json({
      success: true,
      message: `✅ Entrada registrada exitosamente para ${employee.name} a las ${entryTime}`,
      data: {
        id: result.id,
        employee_id,
        employee_name: employee.name,
        employee_type: employee.type,
        date: today,
        entry_time: entryTime,
        entry_datetime: entryDateTime,
        status: 'active'
      }
    });

  } catch (error) {
    console.error('❌ Error registrando entrada:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor al registrar entrada'
    });
  }
});

// POST /api/attendance/exit - Registrar salida CON FECHA/HORA MEJORADA
// POST /api/attendance/exit - VERSIÓN CORREGIDA SIN updated_at
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

    // Verificar si el empleado existe
    const employee = await getQuery(
      'SELECT id, name, type, is_active FROM employees WHERE id = ?',
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

    // Buscar entrada pendiente
    const attendanceRecord = await getQuery(
      `SELECT a.*, e.name, e.type 
       FROM attendance a 
       JOIN employees e ON a.employee_id = e.id 
       WHERE a.employee_id = ? AND a.date = ? AND a.exit_time IS NULL`,
      [employeeIdNum, today]
    );

    if (!attendanceRecord) {
      return res.status(400).json({
        success: false,
        error: 'No existe una entrada pendiente para hoy. Registre la entrada primero.'
      });
    }

    // Convertir valores a números
    const hoursExtraNum = parseFloat(hours_extra) || 0;
    const despalilloNum = parseFloat(despalillo) || 0;
    const escogidaNum = parseFloat(escogida) || 0;
    const monadoNum = parseFloat(monado) || 0;

    // Calcular valores de producción
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
    
    // CONSULTA CORREGIDA - SIN updated_at
    const updateResult = await runQuery(
      `UPDATE attendance 
       SET exit_time = ?, 
           hours_extra = ?, 
           despalillo = ?, 
           escogida = ?, 
           monado = ?,
           t_despalillo = ?, 
           t_escogida = ?, 
           t_monado = ?, 
           prop_sabado = ?, 
           septimo_dia = ?
       WHERE id = ?`,
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

// GET /api/attendance/today - Obtener registros de hoy CON MEJOR FORMATO
router.get('/today', authenticateToken, async (req, res) => {
  try {
     const today = getLocalDate();
    
    console.log('📅 Obteniendo registros para:', today);

    const records = await allQuery(`
      SELECT 
        a.*,
        e.name as employee_name,
        e.dni as employee_dni,
        e.type as employee_type,
        e.photo,
        CASE 
          WHEN a.exit_time IS NULL THEN 'active'
          ELSE 'completed' 
        END as status
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      WHERE a.date = ?
      ORDER BY a.entry_time DESC
    `, [today]);

    console.log(`📊 ${records.length} registros encontrados para hoy`);

    // Procesar fechas para mejor formato
    const processedRecords = records.map(record => ({
      ...record,
      // Formatear fechas para mostrar
      entry_time_display: record.entry_time,
      exit_time_display: record.exit_time || '-',
      // Estado claro
      status: record.exit_time ? 'completed' : 'active',
      status_text: record.exit_time ? 'Completado' : 'En Trabajo'
    }));

    res.json({
      success: true,
      data: processedRecords,
      count: processedRecords.length
    });

  } catch (error) {
    console.error('❌ Error obteniendo registros de hoy:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener registros de hoy'
    });
  }
});

module.exports = router;