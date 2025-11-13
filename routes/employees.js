const express = require('express');
const router = express.Router();
const upload = require('../config/upload');
const { getQuery, allQuery, runQuery } = require('../config/database');
const QRCode = require('qrcode');

// ===============================
// 🔹 CREAR EMPLEADO
// ===============================
router.post('/', upload.single('photo'), async (req, res) => {
  try {
    const { name, dni, type, monthly_salary } = req.body;

    // FOTO SUBIDA A CLOUDINARY
    let photoUrl = null;
    if (req.file) {
      photoUrl = req.file.path; // ← Cloudinary URL pública HTTPS
    }

    // INSERTAR EMPLEADO
    const insertSql = `
      INSERT INTO employees (name, dni, type, monthly_salary, photo)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;
    const result = await getQuery(insertSql, [
      name,
      dni,
      type,
      monthly_salary,
      photoUrl
    ]);

    const employeeId = result.id;

    // GENERAR QR COMO TEXTO SIMPLE QUE CONTIENE EL ID
    const qrData = `employee:${employeeId}`;
    const qrCodeBase64 = await QRCode.toDataURL(qrData);

    // GUARDAR QR EN LA BD
    await runQuery(
      'UPDATE employees SET qr_code = $1 WHERE id = $2',
      [qrCodeBase64, employeeId]
    );

    res.status(201).json({
      success: true,
      message: 'Empleado creado correctamente',
      employeeId,
      photo: photoUrl,
      qr: qrCodeBase64
    });

  } catch (error) {
    console.error('❌ Error creando empleado:', error);
    res.status(500).json({
      success: false,
      message: 'Error creando empleado',
      error: error.message
    });
  }
});

// ===============================
// 🔹 OBTENER TODOS LOS EMPLEADOS
// ===============================
router.get('/', async (req, res) => {
  try {
    const employees = await allQuery(`
      SELECT id, name, dni, type, monthly_salary, 
             photo, qr_code, is_active
      FROM employees
      ORDER BY id ASC
    `);

    res.json({ success: true, data: employees });
  } catch (error) {
    console.error('❌ Error obteniendo empleados:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo empleados'
    });
  }
});

// ===============================
// 🔹 OBTENER UN EMPLEADO POR ID
// ===============================
router.get('/:id', async (req, res) => {
  try {
    const result = await getQuery(`
      SELECT id, name, dni, type, monthly_salary, 
             photo, qr_code, is_active
      FROM employees
      WHERE id = $1
    `, [req.params.id]);

    if (!result) {
      return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
    }

    res.json({ success: true, data: result });

  } catch (error) {
    console.error('❌ Error obteniendo empleado:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo empleado'
    });
  }
});

// ===============================
// 🔹 ACTUALIZAR EMPLEADO
// ===============================
router.put('/:id', upload.single('photo'), async (req, res) => {
  try {
    const { name, dni, type, monthly_salary, is_active } = req.body;

    let photoUrl = null;
    if (req.file) {
      photoUrl = req.file.path; // CLOUDINARY URL
    }

    const updateSql = `
      UPDATE employees
      SET name = $1,
          dni = $2,
          type = $3,
          monthly_salary = $4,
          is_active = $5,
          photo = COALESCE($6, photo)
      WHERE id = $7
      RETURNING *
    `;

    const updated = await getQuery(updateSql, [
      name,
      dni,
      type,
      monthly_salary,
      is_active,
      photoUrl,
      req.params.id
    ]);

    res.json({
      success: true,
      message: 'Empleado actualizado correctamente',
      data: updated
    });

  } catch (error) {
    console.error('❌ Error actualizando empleado:', error);
    res.status(500).json({
      success: false,
      message: 'Error actualizando empleado',
      error: error.message
    });
  }
});

// ===============================
// 🔹 DESCARGAR QR COMO IMAGEN PNG
// ===============================
router.get('/:id/qr', async (req, res) => {
  try {
    const result = await getQuery(
      'SELECT qr_code FROM employees WHERE id = $1',
      [req.params.id]
    );

    if (!result?.qr_code) {
      return res.status(404).json({
        success: false,
        message: 'QR no encontrado para este empleado'
      });
    }

    const base64 = result.qr_code.replace(/^data:image\/png;base64,/, "");
    const qrBuffer = Buffer.from(base64, 'base64');

    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename=qr-${req.params.id}.png`,
      'Content-Length': qrBuffer.length
    });

    res.end(qrBuffer);

  } catch (error) {
    console.error('❌ Error descargando QR:', error);
    res.status(500).json({
      success: false,
      message: 'Error descargando QR',
      error: error.message
    });
  }
});

module.exports = router;
