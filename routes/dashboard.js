const express = require('express');
const { getQuery, allQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// 📊 GET /api/dashboard/stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [
      totalEmployeesArr,
      todayAttendanceArr,
      pendingExitsArr,
      weeklyStatsArr,
      recentActivity
    ] = await Promise.all([
      getQuery('SELECT COUNT(*) AS count FROM employees WHERE is_active = true'),
      getQuery('SELECT COUNT(*) AS count FROM attendance WHERE date = $1', [today]),
      getQuery(`
        SELECT COUNT(*) AS count 
        FROM attendance 
        WHERE date = $1 AND exit_time IS NULL
      `, [today]),
      getQuery(`
        SELECT 
          COUNT(DISTINCT employee_id) AS employees_this_week,
          SUM(
            CASE 
              WHEN exit_time IS NOT NULL THEN 
                EXTRACT(EPOCH FROM (exit_time::time - entry_time::time)) / 3600
              ELSE 0 
            END
          ) AS total_hours
        FROM attendance 
        WHERE date BETWEEN CURRENT_DATE - INTERVAL '7 days' AND $1
      `, [today]),
      allQuery(`
        SELECT 
          e.name AS employee_name,
          a.date,
          a.entry_time,
          a.exit_time,
          CASE 
            WHEN a.exit_time IS NULL THEN 'Entrada'
            ELSE 'Salida'
          END AS action_type
        FROM attendance a
        JOIN employees e ON a.employee_id = e.id
        WHERE a.date = $1
        ORDER BY a.entry_time DESC
        LIMIT 5
      `, [today])
    ]);

    // ✅ Normalización de datos
    const totalEmployees = parseInt(totalEmployeesArr[0]?.count || 0);
    const todayAttendance = parseInt(todayAttendanceArr[0]?.count || 0);
    const pendingExits = parseInt(pendingExitsArr[0]?.count || 0);
    const weeklyStats = weeklyStatsArr[0] || {};
    const weeklyHours = Math.round((weeklyStats.total_hours || 0) * 10) / 10;

    res.status(200).json({
      success: true,
      data: {
        totalEmployees,
        todayAttendance,
        pendingExits,
        weeklyHours,
        weeklyEmployees: weeklyStats.employees_this_week || 0,
        recentActivity: recentActivity || []
      },
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error obteniendo estadísticas del dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener estadísticas del dashboard',
      details: error.message
    });
  }
});

// 📅 GET /api/dashboard/attendance-today
router.get('/attendance-today', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const attendance = await allQuery(`
      SELECT 
        e.name,
        e.type,
        e.photo,
        a.entry_time,
        a.exit_time,
        a.hours_extra,
        CASE 
          WHEN a.exit_time IS NULL THEN 'working'
          ELSE 'completed'
        END AS status
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      WHERE a.date = $1
      ORDER BY a.entry_time DESC
    `, [today]);

    res.status(200).json({
      success: true,
      data: attendance,
      date: today,
      count: attendance.length
    });

  } catch (error) {
    console.error('❌ Error obteniendo asistencia de hoy:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener asistencia de hoy',
      details: error.message
    });
  }
});

module.exports = router;
