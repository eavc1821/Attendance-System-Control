const express = require('express');
const router = express.Router();
const qr = require('qr-image');
const fs = require('fs');
const path = require('path');
const upload = require('../config/upload');
const { runQuery, allQuery, getQuery } = require('../config/database');


// Crear empleado
router.post('/', upload.single('photo'), async (req, res) => {
  try {
    const { name, dni, type, monthly_salary } = req.body;
    const photoFile = req.file;

    if (!name || !dni || !type || !monthly_salary) {
      return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios' });
    }

    const monthly_salary_value = parseFloat(monthly_salary);
    if (isNaN(monthly_salary_value)) {
      return res.status(400).json({ success: false, message: 'El salario mensual no es válido' });
    }

    // Construir la ruta absoluta de la foto
    let photoPath = null;
    if (photoFile) {
      const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
      photoPath = `${backendUrl}/uploads/${photoFile.filename}`;
    }

    // 1️⃣ Insertar el empleado (sin QR todavía)
    const insertSql = `
      INSERT INTO employees (name, dni, type, monthly_salary, photo, is_active, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      RETURNING id, name, dni, type, monthly_salary, photo
    `;
    const insertValues = [name.trim(), dni.trim(), type, monthly_salary_value, photoPath];
    const result = await runQuery(insertSql, insertValues);
    const employee = result.rows ? result.rows[0] : result;

    // 2️⃣ Generar QR con el ID real
    const qrPayload = JSON.stringify({
      employee_id: String(employee.id),
      name: employee.name,
      dni: employee.dni,
      type: employee.type
    });
    const qrBuffer = qr.imageSync(qrPayload, { type: 'png' });
    const qrBase64 = qrBuffer.toString('base64');

    // 3️⃣ Actualizar el QR en la BD
    await runQuery('UPDATE employees SET qr_code = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
      qrBase64,
      employee.id
    ]);

    // 4️⃣ Devolver empleado completo
    const newEmployee = await getQuery(
      'SELECT id, name, dni, type, monthly_salary, photo, qr_code FROM employees WHERE id = $1',
      [employee.id]
    );

    // Emitir evento (si socket está disponible)
    const io = req.app.get('io');
    if (io) io.emit('employee:created', newEmployee[0]);

    res.status(201).json({
      success: true,
      message: 'Empleado creado exitosamente',
      data: newEmployee[0]
    });
  } catch (error) {
    console.error('❌ Error creando empleado:', error);
    res.status(500).json({ success: false, message: 'Error al crear empleado', error: error.message });
  }
});

// Obtener todos los empleados
router.get('/', async (req, res) => {
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
        is_active 
      FROM employees 
      ORDER BY id ASC
    `);

    res.status(200).json({
      success: true,
      data: employees || [],
      count: employees?.length || 0
    });
  } catch (error) {
    console.error('❌ Error obteniendo empleados:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener empleados',
      error: error.message
    });
  }
});

// Actualizar empleado
router.put('/:id', upload.single('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, dni, type, monthly_salary, is_active } = req.body;
    const photoFile = req.file;

    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
    const photoPath = photoFile ? `${backendUrl}/uploads/${photoFile.filename}` : null;

    const updateSql = `
      UPDATE employees SET
        name = COALESCE($1, name),
        dni = COALESCE($2, dni),
        type = COALESCE($3, type),
        monthly_salary = COALESCE($4, monthly_salary),
        photo = COALESCE($5, photo),
        is_active = COALESCE($6, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING *
    `;

    const result = await runQuery(updateSql, [
      name,
      dni,
      type,
      monthly_salary ? parseFloat(monthly_salary) : null,
      photoPath,
      is_active,
      id
    ]);

    const updatedEmployee = result.rows[0];

    const io = req.app.get('io');
    if (io) io.emit('employee:updated', updatedEmployee);

    res.json({ success: true, data: updatedEmployee });
  } catch (error) {
    console.error('❌ Error actualizando empleado:', error);
    res.status(500).json({ success: false, message: 'Error actualizando empleado' });
  }
});

// Obtener estadísticas individuales del empleado (para asistencia)
router.get('/:id/stats', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await allQuery(`
      SELECT 
        e.id, e.name, e.type, e.dni,
        COUNT(a.id) AS total_attendance,
        SUM(CASE WHEN a.exit_time IS NULL THEN 1 ELSE 0 END) AS pending_exits
      FROM employees e
      LEFT JOIN attendance a ON e.id = a.employee_id
      WHERE e.id = $1
      GROUP BY e.id, e.name, e.type, e.dni
    `, [id]);

    if (!result.length) {
      return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
    }

    res.status(200).json({ success: true, data: result[0] });
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas del empleado:', error);
    res.status(500).json({ success: false, message: 'Error obteniendo estadísticas', error: error.message });
  }
});


// 📦 Descargar QR del empleado
router.get('/:id/qr', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await getQuery(
      'SELECT name, dni, qr_code FROM employees WHERE id = $1',
      [id]
    );

    if (!result) {
      return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
    }

    const { name, dni, qr_code } = result;

    if (!qr_code) {
      return res.status(404).json({ success: false, message: 'El empleado no tiene QR generado' });
    }

    // Convertir base64 a buffer y enviar como imagen
    const buffer = Buffer.from(qr_code, 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="qr-${dni}.png"`,
      'Content-Length': buffer.length
    });
    res.end(buffer);
  } catch (error) {
    console.error('❌ Error descargando QR:', error);
    res.status(500).json({ success: false, message: 'Error descargando QR', error: error.message });
  }
});


module.exports = router;
