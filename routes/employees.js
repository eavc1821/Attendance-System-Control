const express = require('express');
const router = express.Router();
const upload = require('../config/upload');
const { getQuery, allQuery, runQuery } = require('../config/database');
const QRCode = require('qrcode');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});


// ===============================
// 🔥 CREAR EMPLEADO (Optimizado)
// ===============================
router.post('/', upload.single('photo'), async (req, res) => {
  try {
    const { name, dni, type, monthly_salary } = req.body;

    const photoUrl = req.file ? req.file.path : null;

    // 1️⃣ Insertar empleado
    const insertSql = `
      INSERT INTO employees (name, dni, type, monthly_salary, photo)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;
    const inserted = await runQuery(insertSql, [
      name,
      dni,
      type,
      monthly_salary,
      photoUrl
    ]);;

    if (!inserted.rows || !inserted.rows[0]) {
      console.error("❌ INSERT SIN FILAS:", inserted);
      throw new Error("No se devolvió ID después del INSERT");
    }

    const employeeId = inserted.rows[0].id;
    console.log("🆔 employeeId:", employeeId);

    // 2️⃣ Texto dentro del QR  (YA DEFINIDO AQUÍ, ANTES DE GENERARLO)
    const qrPayload = `employee:${employeeId}`;
    console.log("📌 QR PAYLOAD:", qrPayload);

    // GENERAR QR GRANDE Y ROBUSTO (NO MICRO QR)
      const qrBuffer = await QRCode.toBuffer(qrPayload, {
        type: "png",
        version: 6,               // ← OBLIGA A QR COMPLETO
        errorCorrectionLevel: "H",
        width: 600,
        margin: 4
      });

      // SUBIR VIA STREAM
      const qrUpload = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: "attendance-system/qrs",
            public_id: `qr-${employeeId}`,
            overwrite: true,
            resource_type: "image",
            format: "png"
          },
          (err, result) => {
            if (err) reject(err);
            else resolve(result);
          }
        );
        uploadStream.end(qrBuffer);
      });

    console.log("📌 QR SUBIDO:", qrUpload.secure_url);

    // 5️⃣ Guardar QR en DB
    await runQuery(
      "UPDATE employees SET qr_code = $1 WHERE id = $2",
      [qrUpload.secure_url, employeeId]
    );

    res.status(201).json({
      success: true,
      employeeId,
      photo: photoUrl,
      qr: qrUpload.secure_url
    });

  } catch (err) {
    console.error("❌ Error creando empleado:", err);
    res.status(500).json({
      success: false,
      message: "Error creando empleado",
      error: err.message
    });
  }
});


// ===============================
// 🔹 OBTENER TODOS LOS EMPLEADOS
// ===============================
router.get('/', async (req, res) => {
  try {
    const employees = await allQuery(`
      SELECT id, name, dni, type, monthly_salary, photo, qr_code, is_active
      FROM employees
      ORDER BY id ASC
    `);

    res.json({ success: true, data: employees });

  } catch (err) {
    console.error("❌ Error obteniendo empleados:", err);
    res.status(500).json({ success: false, message: "Error obteniendo empleados" });
  }
});


// ===============================
// 🔹 OBTENER UN EMPLEADO POR ID
// ===============================
router.get('/:id', async (req, res) => {
  try {
    const employee = await getQuery(`
      SELECT id, name, dni, type, monthly_salary, photo, qr_code, is_active
      FROM employees WHERE id = $1
    `, [req.params.id]);

    if (!employee)
      return res.status(404).json({ success: false, message: "Empleado no encontrado" });

    res.json({ success: true, data: employee });

  } catch (err) {
    console.error("❌ Error obteniendo empleado:", err);
    res.status(500).json({ success: false, message: "Error obteniendo empleado" });
  }
});


// ===============================
// 🔹 ACTUALIZAR EMPLEADO
// ===============================
router.put('/:id', upload.single('photo'), async (req, res) => {
  try {
    const { name, dni, type, monthly_salary, is_active } = req.body;

    const photoUrl = req.file ? req.file.path : null;

    const updated = await getQuery(`
      UPDATE employees
      SET name = $1,
          dni = $2,
          type = $3,
          monthly_salary = $4,
          is_active = $5,
          photo = COALESCE($6, photo),
          updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `, [
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
      message: "Empleado actualizado",
      data: updated
    });

  } catch (err) {
    console.error("❌ Error actualizando:", err);
    res.status(500).json({ success: false, message: "Error actualizando empleado" });
  }
});



// ===============================
// 🔹 DESCARGAR QR COMO IMAGEN PNG
// ===============================
router.get('/:id/qr', async (req, res) => {
  try {
    const employee = await getQuery(
      "SELECT qr_code FROM employees WHERE id = $1",
      [req.params.id]
    );

    if (!employee?.qr_code)
      return res.status(404).json({ success: false, message: "QR no encontrado" });

    const response = await axios.get(employee.qr_code, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data, "binary");

    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename=qr-${req.params.id}.png`,
      "Content-Length": buffer.length
    });

    res.end(buffer);

  } catch (err) {
    console.error("❌ Error descargando QR:", err);
    res.status(500).json({ success: false, message: "Error descargando QR" });
  }
});


// =====================================
// 🔹 OBTENER ESTADÍSTICAS DEL EMPLEADO
// =====================================
router.get('/:id/stats', async (req, res) => {
  try {
    const id = req.params.id;

    const days = await getQuery(
      "SELECT COUNT(*) AS dias FROM attendance WHERE employee_id = $1",
      [id]
    );

    const production = await getQuery(`
      SELECT 
        COALESCE(SUM(despalillo),0) AS total_despalillo,
        COALESCE(SUM(escogida),0) AS total_escogida,
        COALESCE(SUM(monado),0) AS total_monado
      FROM attendance WHERE employee_id = $1
    `, [id]);

    const he = await getQuery(`
      SELECT COALESCE(SUM(hours_extra),0) AS horas_extras
      FROM attendance WHERE employee_id = $1
    `, [id]);

    res.json({
      success: true,
      data: {
        dias_trabajados: Number(days?.dias || 0),
        total_despalillo: Number(production?.total_despalillo || 0),
        total_escogida: Number(production?.total_escogida || 0),
        total_monado: Number(production?.total_monado || 0),
        horas_extras: Number(he?.horas_extras || 0),
        t_despalillo: 0,
        t_escogida: 0,
        t_monado: 0,
        prop_sabado: 0,
        septimo_dia: 0,
        neto_pagar: 0
      }
    });

  } catch (err) {
    console.error("❌ Error stats:", err);
    res.status(500).json({ success: false, message: "Error obteniendo estadísticas" });
  }
});


// ===============================
// 🔥 ELIMINAR EMPLEADO
// ===============================
router.delete('/:id', async (req, res) => {
  try {
    await runQuery("DELETE FROM employees WHERE id = $1", [req.params.id]);

    res.json({
      success: true,
      message: "Empleado eliminado correctamente"
    });

  } catch (err) {
    console.error("❌ Error eliminando empleado:", err);
    res.status(500).json({ success: false, message: "Error eliminando empleado" });
  }
});


module.exports = router;
