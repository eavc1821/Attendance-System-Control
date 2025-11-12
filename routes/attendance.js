const express = require('express');
const router = express.Router();
const { runQuery, allQuery, getQuery } = require('../config/database');


// Registrar entrada o salida
router.post('/', async (req, res) => {
  const { employee_id, type } = req.body;

  try {
    if (!employee_id) return res.status(400).json({ success: false, message: 'Falta employee_id' });

    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toLocaleTimeString('es-HN', { hour12: false });

    const employee = await getQuery('SELECT * FROM employees WHERE id = $1', [employee_id]);
    if (!employee.length) {
      return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
    }

    // Determinar si es entrada o salida
    const isEntry = type === 'entrada';
    const isExit = type === 'salida';

    // ⚙️ Inserción atómica con UPSERT
    const insertSql = `
      INSERT INTO attendance (employee_id, date, entry_time, exit_time, created_at, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (employee_id, date)
      DO UPDATE SET
        entry_time = COALESCE(attendance.entry_time, EXCLUDED.entry_time),
        exit_time = COALESCE(attendance.exit_time, EXCLUDED.exit_time),
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const values = [employee_id, today, isEntry ? now : null, isExit ? now : null];
    const result = await runQuery(insertSql, values);
    const record = result.rows[0];

    // Emitir evento de actualización en tiempo real
    const io = req.app.get('io');
    if (io) io.emit('attendance:updated', record);

    res.status(200).json({
      success: true,
      message: `Registro de ${isEntry ? 'entrada' : 'salida'} actualizado correctamente`,
      data: record
    });
  } catch (error) {
    console.error('❌ Error registrando asistencia:', error);
    res.status(500).json({ success: false, message: 'Error registrando asistencia', error: error.message });
  }
});

// Obtener todos los registros
router.get('/', async (req, res) => {
  try {
    const records = await getQuery(
      `SELECT a.*, e.name, e.type, e.dni
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       ORDER BY a.date DESC, a.entry_time DESC`
    );
    res.json({ success: true, data: records });
  } catch (error) {
    console.error('❌ Error obteniendo registros:', error);
    res.status(500).json({ success: false, message: 'Error obteniendo registros' });
  }
});

module.exports = router;
