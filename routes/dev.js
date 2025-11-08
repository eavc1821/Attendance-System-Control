const express = require('express');
const router = express.Router();
const { runQuery, allQuery } = require('../config/database');

// Resetear base de datos (mantener usuarios) - CORREGIDO
router.delete('/reset-database', async (req, res) => {
  try {
    console.log('🧹 Iniciando reset de base de datos...');

    // ✅ CORREGIDO: Eliminar tablas específicas
    await runQuery('DELETE FROM attendance');
    console.log('✅ Registros de asistencia eliminados');

    await runQuery('DELETE FROM employees');
    console.log('✅ Empleados eliminados');

    // ✅ CORREGIDO: Reiniciar secuencias de PostgreSQL
    await runQuery('ALTER SEQUENCE employees_id_seq RESTART WITH 1');
    await runQuery('ALTER SEQUENCE attendance_id_seq RESTART WITH 1');
    console.log('✅ Secuencias reseteadas');

    res.json({
      success: true,
      message: 'Base de datos reseteada exitosamente. Usuarios mantienen intactos.',
      reset: {
        attendance: 'Todos los registros eliminados',
        employees: 'Todos los empleados eliminados',
        users: 'Mantenidos intactos'
      }
    });

  } catch (error) {
    console.error('❌ Error reseteando base de datos:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno al resetear la base de datos: ' + error.message
    });
  }
});

// Obtener estadísticas de la base de datos - CORREGIDO
router.get('/stats', async (req, res) => {
  try {
    const [users, employees, attendance] = await Promise.all([
      allQuery('SELECT COUNT(*) as count FROM users'),
      allQuery('SELECT COUNT(*) as count FROM employees'),
      allQuery('SELECT COUNT(*) as count FROM attendance')
    ]);

    res.json({
      users: users[0].count,
      employees: employees[0].count,
      attendance: attendance[0].count
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

module.exports = router;