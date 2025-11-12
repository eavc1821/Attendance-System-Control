const express = require('express');
const router = express.Router();
const { allQuery, getQuery, runQuery } = require('../config/database');

// 📅 Obtener registros del día actual
router.get('/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const records = await allQuery(`
      SELECT 
        a.*, 
        e.name AS employee_name, 
        e.dni AS employee_dni, 
        e.type AS employee_type
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date = $1
      ORDER BY a.entry_time DESC
    `, [today]);

    res.json({ success: true, data: records });
  } catch (error) {
    console.error('❌ Error obteniendo registros de hoy:', error);
    res.status(500).json({ success: false, message: 'Error obteniendo registros de hoy' });
  }
});

// 🕐 Registrar entrada
router.post('/entry', async (req, res) => {
  const { employee_id } = req.body;
  if (!employee_id) return res.status(400).json({ success: false, message: 'Falta employee_id' });

  try {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toLocaleTimeString('es-HN', { hour12: false });

    // Registrar o actualizar asistencia
    const insertSql = `
      INSERT INTO attendance (employee_id, date, entry_time, created_at, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (employee_id, date)
      DO UPDATE SET entry_time = EXCLUDED.entry_time, updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const result = await runQuery(insertSql, [employee_id, today, now]);
    const record = result.rows[0];

    res.status(200).json({
      success: true,
      message: 'Entrada registrada correctamente',
      data: record
    });
  } catch (error) {
    console.error('❌ Error registrando entrada:', error);
    res.status(500).json({ success: false, message: 'Error registrando entrada', error: error.message });
  }
});

// ⏰ Registrar salida
router.post('/exit', async (req, res) => {
  const { employee_id, hours_extra, despalillo, escogida, monado } = req.body;
  if (!employee_id) return res.status(400).json({ success: false, message: 'Falta employee_id' });

  try {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toLocaleTimeString('es-HN', { hour12: false });

    const updateSql = `
      UPDATE attendance 
      SET 
        exit_time = $1,
        hours_extra = COALESCE($2, hours_extra),
        despalillo = COALESCE($3, despalillo),
        escogida = COALESCE($4, escogida),
        monado = COALESCE($5, monado),
        updated_at = CURRENT_TIMESTAMP
      WHERE employee_id = $6 AND date = $7
      RETURNING *;
    `;
    const result = await runQuery(updateSql, [now, hours_extra, despalillo, escogida, monado, employee_id, today]);
    const record = result.rows[0];

    res.status(200).json({
      success: true,
      message: 'Salida registrada correctamente',
      data: record
    });
  } catch (error) {
    console.error('❌ Error registrando salida:', error);
    res.status(500).json({ success: false, message: 'Error registrando salida', error: error.message });
  }
});

module.exports = router;
