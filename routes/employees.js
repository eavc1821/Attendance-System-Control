const express = require('express');
const qr = require('qr-image');
const path = require('path');
const fs = require('fs');
const { getQuery, allQuery, runQuery } = require('../config/database');
const { authenticateToken, requireAdminOrScanner } = require('../middleware/auth');
const upload = require('../config/upload');

const router = express.Router();



// GET /api/employees - Obtener todos los empleados activos
router.get('/', authenticateToken, async (req, res) => {
  try {
    const employees = await allQuery(`
      SELECT 
        id, 
        name, 
        dni, 
        type, 
        monthly_salary,
        photo,
        qr_code,
        is_active,
        created_at
      FROM employees 
      WHERE is_active = 1
      ORDER BY name
    `);

    // Convertir photo a URL completa para cada empleado
    const employeesWithFullPhoto = employees.map(employee => ({
      ...employee,
      photo: employee.photo ? `http://localhost:5000${employee.photo}` : null
    }));

    // CORRECCIÓN: Devuelve employeesWithFullPhoto en lugar de employees
    res.json({
      success: true,
      data: employeesWithFullPhoto,  // ← CAMBIA employees por employeesWithFullPhoto
      count: employeesWithFullPhoto.length
    });

  } catch (error) {
    console.error('Error obteniendo empleados:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener la lista de empleados'
    });
  }
});

// POST /api/employees - Crear nuevo empleado con imagen
router.post('/', authenticateToken, requireAdminOrScanner, upload.single('photo'), async (req, res) => {
  try {
    const { name, dni, type, monthly_salary } = req.body;
    const photoFile = req.file;

    // Validaciones
    if (!name || !dni || !type) {
      // Si se subió un archivo pero hay error, eliminarlo
      if (photoFile) {
        fs.unlinkSync(photoFile.path);
      }
      return res.status(400).json({
        success: false,
        error: 'Nombre, DNI y tipo son campos requeridos'
      });
    }

    if (dni.length !== 13) {
      if (photoFile) {
        fs.unlinkSync(photoFile.path);
      }
      return res.status(400).json({
        success: false,
        error: 'El DNI debe tener exactamente 13 dígitos'
      });
    }

    if (type === 'Al Dia' && (!monthly_salary || monthly_salary <= 0)) {
      if (photoFile) {
        fs.unlinkSync(photoFile.path);
      }
      return res.status(400).json({
        success: false,
        error: 'Los empleados tipo "Al Dia" requieren un salario mensual válido'
      });
    }

    // Verificar si el DNI ya existe
    const existingEmployee = await getQuery(
      'SELECT id FROM employees WHERE dni = ? AND is_active = 1',
      [dni]
    );

    if (existingEmployee) {
      if (photoFile) {
        fs.unlinkSync(photoFile.path);
      }
      return res.status(400).json({
        success: false,
        error: 'Ya existe un empleado con este DNI'
      });
    }

    // Generar código QR
    const qrData = JSON.stringify({ 
      id: Date.now(), 
      name, 
      dni, 
      type 
    });
    const qrCode = qr.imageSync(qrData, { type: 'png' }).toString('base64');

    // Preparar datos para la base de datos
    const photoPath = photoFile ? `/uploads/${photoFile.filename}` : null;

    // Insertar empleado
    const result = await runQuery(
      `INSERT INTO employees (name, dni, type, monthly_salary, photo, qr_code) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, dni, type, monthly_salary || 0, photoPath, qrCode]
    );

    // Obtener el empleado creado
    const newEmployee = await getQuery(
      'SELECT * FROM employees WHERE id = ?',
      [result.id]
    );

    // Convertir photo a URL completa
    if (newEmployee.photo) {
      newEmployee.photo = `http://localhost:5000${newEmployee.photo}`;
    }

    res.status(201).json({
      success: true,
      message: 'Empleado creado exitosamente',
      data: newEmployee
    });

  } catch (error) {
    // Limpiar archivo subido en caso de error
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error creando empleado:', error);
    res.status(500).json({
      success: false,
      error: 'Error al crear empleado: ' + error.message
    });
  }
});

// PUT /api/employees/:id - Actualizar empleado con imagen
router.put('/:id', authenticateToken, requireAdminOrScanner, upload.single('photo'), async (req, res) => {
  try {
    const { name, dni, type, monthly_salary, remove_photo } = req.body;
    const photoFile = req.file;
    const employeeId = req.params.id;

    // Validaciones
    if (!name || !dni || !type) {
      if (photoFile) {
        fs.unlinkSync(photoFile.path);
      }
      return res.status(400).json({
        success: false,
        error: 'Nombre, DNI y tipo son campos requeridos'
      });
    }

    if (dni.length !== 13) {
      if (photoFile) {
        fs.unlinkSync(photoFile.path);
      }
      return res.status(400).json({
        success: false,
        error: 'El DNI debe tener exactamente 13 dígitos'
      });
    }

    // Verificar si el empleado existe
    const existingEmployee = await getQuery(
      'SELECT id, photo FROM employees WHERE id = ? AND is_active = 1',
      [employeeId]
    );

    if (!existingEmployee) {
      if (photoFile) {
        fs.unlinkSync(photoFile.path);
      }
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado'
      });
    }

    // Verificar si el DNI ya existe en otro empleado
    const duplicateDni = await getQuery(
      'SELECT id FROM employees WHERE dni = ? AND id != ? AND is_active = 1',
      [dni, employeeId]
    );

    if (duplicateDni) {
      if (photoFile) {
        fs.unlinkSync(photoFile.path);
      }
      return res.status(400).json({
        success: false,
        error: 'Ya existe otro empleado con este DNI'
      });
    }

    // Manejar la foto
    let photoPath = existingEmployee.photo;
    
    // Si se solicita eliminar la foto existente
    if (remove_photo === 'true' && existingEmployee.photo) {
      const oldPhotoPath = path.join(__dirname, '..', existingEmployee.photo);
      if (fs.existsSync(oldPhotoPath)) {
        fs.unlinkSync(oldPhotoPath);
      }
      photoPath = null;
    }
    
    // Si se subió una nueva foto
    if (photoFile) {
      // Eliminar foto anterior si existe
      if (existingEmployee.photo) {
        const oldPhotoPath = path.join(__dirname, '..', existingEmployee.photo);
        if (fs.existsSync(oldPhotoPath)) {
          fs.unlinkSync(oldPhotoPath);
        }
      }
      photoPath = `/uploads/${photoFile.filename}`;
    }

    // Actualizar empleado
    await runQuery(
      `UPDATE employees 
       SET name = ?, dni = ?, type = ?, monthly_salary = ?, photo = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [name, dni, type, monthly_salary || 0, photoPath, employeeId]
    );

    // Obtener el empleado actualizado
    const updatedEmployee = await getQuery(
      'SELECT * FROM employees WHERE id = ?',
      [employeeId]
    );

    // Convertir photo a URL completa
    if (updatedEmployee.photo) {
      updatedEmployee.photo = `http://localhost:5000${updatedEmployee.photo}`;
    }

    res.json({
      success: true,
      message: 'Empleado actualizado exitosamente',
      data: updatedEmployee
    });

  } catch (error) {
    // Limpiar archivo subido en caso de error
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error actualizando empleado:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar empleado: ' + error.message
    });
  }
});

// DELETE /api/employees/:id - Eliminar empleado (soft delete)
router.delete('/:id', authenticateToken, requireAdminOrScanner, async (req, res) => {
  try {
    const employeeId = req.params.id;

    // Verificar si el empleado existe
    const existingEmployee = await getQuery(
      'SELECT id, photo FROM employees WHERE id = ? AND is_active = 1',
      [employeeId]
    );

    if (!existingEmployee) {
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado'
      });
    }

    // Eliminar foto si existe
    if (existingEmployee.photo) {
      const photoPath = path.join(__dirname, '..', existingEmployee.photo);
      if (fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
    }

    // Soft delete
    await runQuery(
      'UPDATE employees SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [employeeId]
    );

    res.json({
      success: true,
      message: 'Empleado eliminado exitosamente'
    });

  } catch (error) {
    console.error('Error eliminando empleado:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar empleado'
    });
  }
});

// GET /api/employees/:id/qr - Obtener QR del empleado
router.get('/:id/qr', authenticateToken, async (req, res) => {
  try {
    const employee = await getQuery(
      'SELECT qr_code FROM employees WHERE id = ? AND is_active = 1',
      [req.params.id]
    );

    if (!employee || !employee.qr_code) {
      return res.status(404).json({
        success: false,
        error: 'QR no encontrado'
      });
    }

    const qrBuffer = Buffer.from(employee.qr_code, 'base64');
    
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': qrBuffer.length,
      'Content-Disposition': `attachment; filename="qr-${req.params.id}.png"`
    });
    
    res.end(qrBuffer);

  } catch (error) {
    console.error('Error obteniendo QR:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener QR'
    });
  }
});


// GET /api/employees/:id/stats - Obtener estadísticas del empleado
router.get('/:id/stats', authenticateToken, async (req, res) => {
  try {
    const employeeId = req.params.id;
    console.log(`📊 Solicitando estadísticas para empleado ID: ${employeeId}`);

    // Verificar si el empleado existe
    const employee = await getQuery(
      'SELECT id, name, type, monthly_salary FROM employees WHERE id = ? AND is_active = 1',
      [employeeId]
    );

    console.log(`🔍 Empleado encontrado:`, employee);

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado'
      });
    }

    // Obtener fecha actual para filtrar - FORMATO SQLite
    const today = new Date().toISOString().split('T')[0];
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1; // Mes actual (1-12)
    
    console.log(`📅 Mes actual para filtro: ${currentYear}-${currentMonth}`);

    if (employee.type === 'Producción') {
      console.log(`🔧 Calculando estadísticas para empleado de PRODUCCIÓN`);
      
      const stats = await getQuery(`
        SELECT 
          COUNT(*) as dias_trabajados,
          COALESCE(SUM(despalillo), 0) as total_despalillo,
          COALESCE(SUM(escogida), 0) as total_escogida,
          COALESCE(SUM(monado), 0) as total_monado,
          COALESCE(SUM(t_despalillo), 0) as t_despalillo,
          COALESCE(SUM(t_escogida), 0) as t_escogida,
          COALESCE(SUM(t_monado), 0) as t_monado,
          COALESCE(SUM(septimo_dia), 0) as septimo_dia
        FROM attendance 
        WHERE employee_id = ? 
        AND strftime('%Y', date) = ? 
        AND strftime('%m', date) = ?
        AND exit_time IS NOT NULL
      `, [employeeId, currentYear.toString(), currentMonth.toString().padStart(2, '0')]);

      console.log(`📈 Estadísticas de producción:`, stats);

      // Calcular prop_sabado y neto_pagar
      const propSabado = (stats.t_despalillo + stats.t_escogida + stats.t_monado) * 0.090909;
      const netoPagar = stats.t_despalillo + stats.t_escogida + stats.t_monado + propSabado + stats.septimo_dia;

      res.json({
        success: true,
        data: {
          ...stats,
          prop_sabado: Math.round(propSabado * 100) / 100,  
          neto_pagar: Math.round(netoPagar * 100) / 100,    
          type: 'production'
        }
      });

    } else {
      console.log(`🔧 Calculando estadísticas para empleado AL DÍA`);
      
      // 🔥 CORRECCIÓN: Solo 3 parámetros - employeeId, año y mes
      const stats = await getQuery(`
        SELECT 
          COUNT(*) as dias_trabajados,
          COALESCE(SUM(hours_extra), 0) as horas_extras
        FROM attendance 
        WHERE employee_id = ? 
        AND strftime('%Y', date) = ? 
        AND strftime('%m', date) = ?
        AND exit_time IS NOT NULL
      `, [employeeId, currentYear.toString(), currentMonth.toString().padStart(2, '0')]); // ← Solo 3 parámetros

      console.log(`📈 Estadísticas base al día:`, stats);

      // Calcular valores adicionales para al día
      const salarioDiario = (employee.monthly_salary || 0) / 30;
      const valorHoraNormal = salarioDiario / 8;
      const valorHoraExtra = valorHoraNormal * 1.25; // +25%
      const heDinero = stats.horas_extras * valorHoraExtra;
      const sabado = salarioDiario; // Prop. sábado
      const septimoDia = (stats.dias_trabajados >= 5) ? salarioDiario : 0; // 7mo día si trabajó 5+ días
      const netoPagar = (stats.dias_trabajados * salarioDiario) + heDinero + sabado + septimoDia;

      console.log(`🧮 Cálculos adicionales:`, {
        salarioDiario,
        heDinero,
        sabado,
        septimoDia,
        netoPagar
      });

      res.json({
        success: true,
        data: {
          dias_trabajados: stats.dias_trabajados,
          horas_extras: stats.horas_extras,
          he_dinero: Math.round(heDinero * 100) / 100,
          salario_diario: Math.round(salarioDiario * 100) / 100,
          sabado: Math.round(sabado * 100) / 100,
          septimo_dia: Math.round(septimoDia * 100) / 100,
          neto_pagar: Math.round(netoPagar * 100) / 100,
          type: 'al_dia'
        }
      });
    }

  } catch (error) {
    console.error('❌ Error obteniendo estadísticas del empleado:', error);
    console.error('🔍 Stack trace:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Error al obtener estadísticas del empleado: ' + error.message
    });
  }
});

module.exports = router;