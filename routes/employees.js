const express = require('express');
const router = express.Router();
const upload = require('../config/upload');
const { getQuery, allQuery, runQuery } = require('../config/database');
const QRCode = require('qrcode');
const axios = require('axios');

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});


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

    const inserted = await getQuery(insertSql, [
      name,
      dni,
      type,
      monthly_salary,
      photoUrl
    ]);

    console.log("📌 RESULTADO INSERTADO:", inserted);

    // ✅ NUEVO BLOQUE CORREGIDO PARA OBTENER EL ID DE FORMA UNIVERSAL
    const employeeId =
      inserted?.id ||
      inserted?.employee_id ||
      inserted?.rows?.[0]?.id;

    if (!employeeId) {
      throw new Error("No se pudo obtener el ID generado del empleado.");
    }

    // GENERAR EL TEXTO QUE IRÁ EN EL QR
    const qrPayload = `employee:${employeeId}`;

    // GENERAR QR EN BASE64
    const qrDataUrl = await QRCode.toDataURL(qrPayload);

    // SUBIR QR A CLOUDINARY
    const uploadQR = await cloudinary.uploader.upload(qrDataUrl, {
      folder: "attendance-system/qrs",
      public_id: `qr-${employeeId}`,
      overwrite: true,
      resource_type: "image"
    });

    // GUARDAR LA URL DEL QR EN LA BASE
    await runQuery(
      "UPDATE employees SET qr_code = $1 WHERE id = $2",
      [uploadQR.secure_url, employeeId]
    );

    // RESPUESTA FINAL
    res.status(201).json({
      success: true,
      employeeId,
      photo: photoUrl,
      qr: uploadQR.secure_url
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

    const qrUrl = result.qr_code;

    // 📌 Descargar el PNG desde Cloudinary
    const response = await axios.get(qrUrl, { responseType: 'arraybuffer' });
    const qrBuffer = Buffer.from(response.data, 'binary');

    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename=qr-${req.params.id}.png`,
      'Content-Length': qrBuffer.length
    });

    return res.end(qrBuffer);

  } catch (error) {
    console.error('❌ Error descargando QR:', error);
    return res.status(500).json({
      success: false,
      message: 'Error descargando QR',
      error: error.message
    });
  }
});

// =====================================
// 🔹 OBTENER ESTADÍSTICAS DEL EMPLEADO
// =====================================
router.get('/:id/stats', async (req, res) => {
  try {
    const employeeId = req.params.id;

    // TOTAL DE DÍAS TRABAJADOS
    const daysWorked = await getQuery(
      'SELECT COUNT(*) AS dias FROM attendance WHERE employee_id = $1',
      [employeeId]
    );

    // PRODUCCIÓN TOTAL POR RUBRO
    const production = await getQuery(
      `SELECT 
          COALESCE(SUM(despalillo), 0) AS total_despalillo,
          COALESCE(SUM(escogida), 0) AS total_escogida,
          COALESCE(SUM(monado), 0) AS total_monado
        FROM attendance
        WHERE employee_id = $1`,
      [employeeId]
    );

    // HORAS EXTRAS
    const hoursExtra = await getQuery(
      'SELECT COALESCE(SUM(hours_extra), 0) AS horas_extras FROM attendance WHERE employee_id = $1',
      [employeeId]
    );

    return res.json({
      success: true,
      data: {
        dias_trabajados: Number(daysWorked.dias),
        total_despalillo: Number(production.total_despalillo),
        total_escogida: Number(production.total_escogida),
        total_monado: Number(production.total_monado),
        horas_extras: Number(hoursExtra.horas_extras),
        // Valores adicionales con defaults
        t_despalillo: 0,
        t_escogida: 0,
        t_monado: 0,
        prop_sabado: 0,
        septimo_dia: 0,
        neto_pagar: 0,
        he_dinero: 0,
        sabado: 0,
        salario_diario: 0
      }
    });

  } catch (error) {
    console.error("❌ Error obteniendo stats:", error);
    return res.status(500).json({
      success: false,
      error: "Error obteniendo estadísticas"
    });
  }
});

// ===============================
// 🔥 ELIMINAR EMPLEADO
// ===============================
router.delete('/:id', async (req, res) => {
  try {
    const employeeId = req.params.id;

    // Eliminar registro
    const result = await runQuery(
      "DELETE FROM employees WHERE id = $1",
      [employeeId]
    );

    res.json({
      success: true,
      message: "Empleado eliminado correctamente"
    });

  } catch (error) {
    console.error("❌ Error eliminando empleado:", error);
    res.status(500).json({
      success: false,
      message: "Error eliminando empleado",
      error: error.message
    });
  }
});


// ===============================
// 🔥 ACTUALIZAR EMPLEADO
// ===============================
router.put('/:id', upload.single('photo'), async (req, res) => {
  try {
    const { name, dni, type, monthly_salary, is_active } = req.body;

    let photoUrl = null;

    if (req.file) {
      photoUrl = req.file.path; // URL Cloudinary
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
      message: "Empleado actualizado correctamente",
      data: updated
    });

  } catch (error) {
    console.error("❌ Error actualizando empleado:", error);
    res.status(500).json({
      success: false,
      message: "Error actualizando empleado",
      error: error.message
    });
  }
});


module.exports = router;
