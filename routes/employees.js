const express = require('express');
const qr = require('qr-image');
const path = require('path');
const fs = require('fs');
const { getQuery, allQuery, runQuery } = require('../config/database');
const { authenticateToken, requireAdminOrScanner } = require('../middleware/auth');
const upload = require('../config/upload');

const router = express.Router();

// GET /api/employees - CORREGIDO
router.get('/', authenticateToken, async (req, res) => {
  try {
    // ✅ CORREGIDO: is_active = 1 → is_active = true
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
      WHERE is_active = true
      ORDER BY name
    `);

    // ✅ ACTUALIZAR: Cambiar localhost por tu dominio de producción
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://gjd78.com' 
      : 'http://localhost:5000';

    const employeesWithFullPhoto = employees.map(employee => ({
      ...employee,
      photo: employee.photo ? `${baseUrl}${employee.photo}` : null
    }));

    res.json({
      success: true,
      data: employeesWithFullPhoto,
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

// POST /api/employees - CORREGIDO
router.post('/', authenticateToken, requireAdminOrScanner, upload.single('photo'), async (req, res) => {
  try {
    const { name, dni, type, monthly_salary } = req.body;
    const photoFile = req.file;

    if (!name || !dni || !type) {
      if (photoFile) fs.unlinkSync(photoFile.path);
      return res.status(400).json({
        success: false,
        error: 'Nombre, DNI y tipo son campos requeridos'
      });
    }

    if (dni.length !== 13) {
      if (photoFile) fs.unlinkSync(photoFile.path);
      return res.status(400).json({
        success: false,
        error: 'El DNI debe tener exactamente 13 dígitos'
      });
    }

    if (type === 'Al Dia' && (!monthly_salary || monthly_salary <= 0)) {
      if (photoFile) fs.unlinkSync(photoFile.path);
      return res.status(400).json({
        success: false,
        error: 'Los empleados tipo "Al Dia" requieren un salario mensual válido'
      });
    }

    // ✅ CORREGIDO: ? → $1, is_active = 1 → is_active = true
    const existingEmployee = await getQuery(
      'SELECT id FROM employees WHERE dni = $1 AND is_active = true',
      [dni]
    );

    if (existingEmployee) {
      if (photoFile) fs.unlinkSync(photoFile.path);
      return res.status(400).json({
        success: false,
        error: 'Ya existe un empleado con este DNI'
      });
    }

    const qrData = JSON.stringify({ 
      id: Date.now(), 
      name, 
      dni, 
      type 
    });
    const qrCode = qr.imageSync(qrData, { type: 'png' }).toString('base64');

    const photoPath = photoFile ? `/uploads/${photoFile.filename}` : null;

    // ✅ CORREGIDO: ? → $1, $2, etc.
    const result = await runQuery(
      `INSERT INTO employees (name, dni, type, monthly_salary, photo, qr_code) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [name, dni, type, monthly_salary || 0, photoPath, qrCode]
    );

    // ✅ CORREGIDO: ? → $1
    const newEmployee = await getQuery(
      'SELECT * FROM employees WHERE id = $1',
      [result.id]
    );

    // ✅ ACTUALIZAR URL para producción
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://gjd78.com' 
      : 'http://localhost:5000';

    if (newEmployee.photo) {
      newEmployee.photo = `${baseUrl}${newEmployee.photo}`;
    }

    res.status(201).json({
      success: true,
      message: 'Empleado creado exitosamente',
      data: newEmployee
    });

  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    console.error('Error creando empleado:', error);
    res.status(500).json({
      success: false,
      error: 'Error al crear empleado: ' + error.message
    });
  }
});

// PUT /api/employees/:id - CORREGIDO
router.put('/:id', authenticateToken, requireAdminOrScanner, upload.single('photo'), async (req, res) => {
  try {
    const { name, dni, type, monthly_salary, remove_photo } = req.body;
    const photoFile = req.file;
    const employeeId = req.params.id;

    if (!name || !dni || !type) {
      if (photoFile) fs.unlinkSync(photoFile.path);
      return res.status(400).json({
        success: false,
        error: 'Nombre, DNI y tipo son campos requeridos'
      });
    }

    if (dni.length !== 13) {
      if (photoFile) fs.unlinkSync(photoFile.path);
      return res.status(400).json({
        success: false,
        error: 'El DNI debe tener exactamente 13 dígitos'
      });
    }

    // ✅ CORREGIDO: ? → $1, is_active = 1 → is_active = true
    const existingEmployee = await getQuery(
      'SELECT id, photo FROM employees WHERE id = $1 AND is_active = true',
      [employeeId]
    );

    if (!existingEmployee) {
      if (photoFile) fs.unlinkSync(photoFile.path);
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado'
      });
    }

    // ✅ CORREGIDO: ? → $1, $2
    const duplicateDni = await getQuery(
      'SELECT id FROM employees WHERE dni = $1 AND id != $2 AND is_active = true',
      [dni, employeeId]
    );

    if (duplicateDni) {
      if (photoFile) fs.unlinkSync(photoFile.path);
      return res.status(400).json({
        success: false,
        error: 'Ya existe otro empleado con este DNI'
      });
    }

    let photoPath = existingEmployee.photo;
    
    if (remove_photo === 'true' && existingEmployee.photo) {
      const oldPhotoPath = path.join(__dirname, '..', existingEmployee.photo);
      if (fs.existsSync(oldPhotoPath)) fs.unlinkSync(oldPhotoPath);
      photoPath = null;
    }
    
    if (photoFile) {
      if (existingEmployee.photo) {
        const oldPhotoPath = path.join(__dirname, '..', existingEmployee.photo);
        if (fs.existsSync(oldPhotoPath)) fs.unlinkSync(oldPhotoPath);
      }
      photoPath = `/uploads/${photoFile.filename}`;
    }

    // ✅ CORREGIDO: ? → $1, $2, etc.
    await runQuery(
      `UPDATE employees 
       SET name = $1, dni = $2, type = $3, monthly_salary = $4, photo = $5, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $6`,
      [name, dni, type, monthly_salary || 0, photoPath, employeeId]
    );

    // ✅ CORREGIDO: ? → $1
    const updatedEmployee = await getQuery(
      'SELECT * FROM employees WHERE id = $1',
      [employeeId]
    );

    // ✅ ACTUALIZAR URL para producción
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://gjd78.com' 
      : 'http://localhost:5000';

    if (updatedEmployee.photo) {
      updatedEmployee.photo = `${baseUrl}${updatedEmployee.photo}`;
    }

    res.json({
      success: true,
      message: 'Empleado actualizado exitosamente',
      data: updatedEmployee
    });

  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    console.error('Error actualizando empleado:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar empleado: ' + error.message
    });
  }
});

// DELETE /api/employees/:id - CORREGIDO
router.delete('/:id', authenticateToken, requireAdminOrScanner, async (req, res) => {
  try {
    const employeeId = req.params.id;

    // ✅ CORREGIDO: ? → $1, is_active = 1 → is_active = true
    const existingEmployee = await getQuery(
      'SELECT id, photo FROM employees WHERE id = $1 AND is_active = true',
      [employeeId]
    );

    if (!existingEmployee) {
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado'
      });
    }

    if (existingEmployee.photo) {
      const photoPath = path.join(__dirname, '..', existingEmployee.photo);
      if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
    }

    // ✅ CORREGIDO: ? → $1, is_active = 0 → is_active = false
    await runQuery(
      'UPDATE employees SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
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

// GET /api/employees/:id/qr - CORREGIDO
router.get('/:id/qr', authenticateToken, async (req, res) => {
  try {
    // ✅ CORREGIDO: ? → $1, is_active = 1 → is_active = true
    const employee = await getQuery(
      'SELECT qr_code FROM employees WHERE id = $1 AND is_active = true',
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

// GET /api/employees/:id/stats - CORREGIDO
router.get('/:id/stats', authenticateToken, async (req, res) => {
  try {
    const employeeId = req.params.id;
    console.log(`📊 Solicitando estadísticas para empleado ID: ${employeeId}`);

    // ✅ CORREGIDO: ? → $1, is_active = 1 → is_active = true
    const employee = await getQuery(
      'SELECT id, name, type, monthly_salary FROM employees WHERE id = $1 AND is_active = true',
      [employeeId]
    );

    console.log(`🔍 Empleado encontrado:`, employee);

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado'
      });
    }

    const today = new Date().toISOString().split('T')[0];
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    console.log(`📅 Mes actual para filtro: ${currentYear}-${currentMonth}`);

    if (employee.type === 'Producción') {
      console.log(`🔧 Calculando estadísticas para empleado de PRODUCCIÓN`);
      
      // ✅ CORREGIDO: ? → $1, $2, $3 y funciones PostgreSQL
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
        WHERE employee_id = $1 
        AND EXTRACT(YEAR FROM date) = $2
        AND EXTRACT(MONTH FROM date) = $3
        AND exit_time IS NOT NULL
      `, [employeeId, currentYear, currentMonth]);

      console.log(`📈 Estadísticas de producción:`, stats);

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
      
      // ✅ CORREGIDO: ? → $1, $2, $3 y funciones PostgreSQL
      const stats = await getQuery(`
        SELECT 
          COUNT(*) as dias_trabajados,
          COALESCE(SUM(hours_extra), 0) as horas_extras
        FROM attendance 
        WHERE employee_id = $1 
        AND EXTRACT(YEAR FROM date) = $2
        AND EXTRACT(MONTH FROM date) = $3
        AND exit_time IS NOT NULL
      `, [employeeId, currentYear, currentMonth]);

      console.log(`📈 Estadísticas base al día:`, stats);

      const salarioDiario = (employee.monthly_salary || 0) / 30;
      const valorHoraNormal = salarioDiario / 8;
      const valorHoraExtra = valorHoraNormal * 1.25;
      const heDinero = stats.horas_extras * valorHoraExtra;
      const sabado = salarioDiario;
      const septimoDia = (stats.dias_trabajados >= 5) ? salarioDiario : 0;
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