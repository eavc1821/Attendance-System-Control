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
  const { employee_id, hours_extra = 0, despalillo = 0, escogida = 0, monado = 0 } = req.body;
  if (!employee_id) return res.status(400).json({ success: false, message: 'Falta employee_id' });

  try {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toLocaleTimeString('es-HN', { hour12: false });

    // Obtener tipo y salario del empleado
    const emp = await getQuery('SELECT id, type, monthly_salary FROM employees WHERE id = $1', [employee_id]);
    if (!emp) return res.status(404).json({ success: false, message: 'Empleado no encontrado' });

    // Valores por defecto y conversión numérica
    const hoursExtraNum = parseFloat(hours_extra) || 0;
    const despalilloNum = parseFloat(despalillo) || 0;
    const escogidaNum = parseFloat(escogida) || 0;
    const monadoNum = parseFloat(monado) || 0;

    // Campos a actualizar
    let t_despalillo = 0, t_escogida = 0, t_monado = 0;
    let sabado = 0, septimo_dia = 0, he_dinero = 0;

    if (emp.type === 'Producción') {
      // Fórmulas que nos diste
      t_despalillo = Number((despalilloNum * 80).toFixed(2));
      t_escogida  = Number((escogidaNum * 70).toFixed(2));
      t_monado    = Number((monadoNum * 1).toFixed(2));

      const subtotal = t_despalillo + t_escogida + t_monado;
      sabado = Number((subtotal * 0.090909).toFixed(2));
      septimo_dia = Number((subtotal * 0.181818).toFixed(2));
      // en producción no hay he_dinero tipico, queda 0
      he_dinero = 0;
    } else {
      // Empleado "Al Dia"
      const monthly = parseFloat(emp.monthly_salary) || 0;
      const salario_diario = Number((monthly / 30).toFixed(2));
      // HE dinero: ((S.Diario/8) + (S.Diario/8)*25%) * H.Extras
      const s_por_hora = salario_diario / 8;
      he_dinero = Number((((s_por_hora) + (s_por_hora * 0.25)) * hoursExtraNum).toFixed(2));

      // séptimo dia: si trabajó >=5 días; lo calcularemos conservadoramente en reports (a nivel por-periodo)
      // Aquí guardamos septimo_dia y sabado como 0; reports semanal los sumará por empleado
      sabado = 0;
      septimo_dia = 0;
      // t_* quedan 0 para "Al Dia"
      t_despalillo = 0; t_escogida = 0; t_monado = 0;
    }

    // Actualizar attendance - asegurarse de existir la fila (entró previamente)
    const updateSql = `
      UPDATE attendance
      SET
        exit_time = $1,
        hours_extra = COALESCE($2, hours_extra),
        despalillo = COALESCE($3, despalillo),
        escogida = COALESCE($4, escogida),
        monado = COALESCE($5, monado),
        t_despalillo = COALESCE($6, t_despalillo),
        t_escogida = COALESCE($7, t_escogida),
        t_monado = COALESCE($8, t_monado),
        prop_sabado = COALESCE($9, prop_sabado),
        septimo_dia = COALESCE($10, septimo_dia),
        updated_at = CURRENT_TIMESTAMP
      WHERE employee_id = $11 AND date = $12
      RETURNING *;
    `;

    // prop_sabado: si quieres guardar el monto de sábado por registro, lo asignamos a sabado
    const result = await runQuery(updateSql, [
      now,
      hoursExtraNum,
      despalilloNum,
      escogidaNum,
      monadoNum,
      t_despalillo,
      t_escogida,
      t_monado,
      sabado,
      septimo_dia,
      employee_id,
      today
    ]);

    const record = result.rows ? result.rows[0] : result;

    // Responder con los cálculos aplicados
    res.status(200).json({
      success: true,
      message: 'Salida registrada correctamente',
      data: record,
      calculations: {
        t_despalillo, t_escogida, t_monado, sabado, septimo_dia, he_dinero
      }
    });
  } catch (error) {
    console.error('❌ Error registrando salida:', error);
    res.status(500).json({ success: false, message: 'Error registrando salida', error: error.message });
  }
});


module.exports = router;
