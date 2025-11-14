const express = require('express');
const router = express.Router();
const { allQuery, getQuery, runQuery } = require('../config/database');

// ===========================================
// 📅 OBTENER REGISTROS DEL DÍA
// ===========================================
router.get('/today', async (req, res) => {
  try {
    const today = new Date().toISOString().substring(0, 10);

    const records = await allQuery(`
      SELECT 
        a.*, 
        e.name AS employee_name, 
        e.dni AS employee_dni, 
        e.type AS employee_type
      FROM attendance a
      INNER JOIN employees e ON e.id = a.employee_id
      WHERE a.date = $1
      ORDER BY a.entry_time DESC
    `, [today]);

    res.json({ success: true, data: records });

  } catch (error) {
    console.error("❌ Error obteniendo registros del día:", error);
    res.status(500).json({
      success: false,
      message: "Error obteniendo registros del día"
    });
  }
});


// ===========================================
// 🕐 REGISTRAR ENTRADA
// ===========================================
router.post('/entry', async (req, res) => {
  try {
    const { employee_id } = req.body;

    if (!employee_id)
      return res.status(400).json({ success: false, message: "Falta employee_id" });

    const today = new Date().toISOString().substring(0, 10);
    const now = new Date().toLocaleTimeString("es-HN", { hour12: false });

    const result = await runQuery(`
      INSERT INTO attendance (employee_id, date, entry_time, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (employee_id, date)
      DO UPDATE SET entry_time = EXCLUDED.entry_time, updated_at = NOW()
      RETURNING *;
    `, [employee_id, today, now]);

    res.json({
      success: true,
      message: "Entrada registrada correctamente",
      data: result
    });

  } catch (error) {
    console.error("❌ Error registrando entrada:", error);
    res.status(500).json({
      success: false,
      message: "Error registrando entrada",
      error: error.message
    });
  }
});


// ===========================================
// ⏰ REGISTRAR SALIDA + CÁLCULOS
// ===========================================
router.post('/exit', async (req, res) => {
  try {
    const {
      employee_id,
      hours_extra = 0,
      despalillo = 0,
      escogida = 0,
      monado = 0
    } = req.body;

    if (!employee_id)
      return res.status(400).json({ success: false, message: "Falta employee_id" });

    const today = new Date().toISOString().substring(0, 10);
    const now = new Date().toLocaleTimeString("es-HN", { hour12: false });

    // Obtener empleado
    const emp = await getQuery(`
      SELECT id, type, monthly_salary
      FROM employees
      WHERE id = $1
    `, [employee_id]);

    if (!emp)
      return res.status(404).json({ success: false, message: "Empleado no encontrado" });

    // Normalizar valores numéricos
    const hoursExtra = Number(hours_extra) || 0;
    const despalilloNum = Number(despalillo) || 0;
    const escogidaNum = Number(escogida) || 0;
    const monadoNum = Number(monado) || 0;

    // Valores finales
    let t_despalillo = 0,
        t_escogida  = 0,
        t_monado    = 0,
        sabado      = 0,
        septimo_dia = 0,
        he_dinero   = 0;

    // ===========================================
    // 👷 PRODUCCIÓN
    // ===========================================
    if (emp.type === "Producción") {
      t_despalillo = Number((despalilloNum * 80).toFixed(2));
      t_escogida   = Number((escogidaNum * 70).toFixed(2));
      t_monado     = Number((monadoNum * 1).toFixed(2));

      const subtotal = t_despalillo + t_escogida + t_monado;

      sabado      = Number((subtotal * 0.090909).toFixed(2));
      septimo_dia = Number((subtotal * 0.181818).toFixed(2));
      he_dinero   = 0;
    }

    // ===========================================
    // 💵 EMPLEADO "AL DÍA"
    // ===========================================
    else {
      const salary = Number(emp.monthly_salary) || 0;
      const salario_diario = salary / 30;
      const pago_hora = salario_diario / 8;

      he_dinero = Number(((pago_hora + pago_hora * 0.25) * hoursExtra).toFixed(2));

      // No se calculan prop_sabado ni séptimo día aquí
      sabado = 0;
      septimo_dia = 0;
    }

    // ===========================================
    // 📝 ACTUALIZAR REGISTRO
    // ===========================================
    const updated = await runQuery(`
      UPDATE attendance
      SET
        exit_time = $1,
        hours_extra = $2,
        despalillo = $3,
        escogida = $4,
        monado = $5,
        t_despalillo = $6,
        t_escogida   = $7,
        t_monado     = $8,
        prop_sabado  = $9,
        septimo_dia  = $10,
        updated_at   = NOW()
      WHERE employee_id = $11 AND date = $12
      RETURNING *;
    `, [
      now,
      hoursExtra,
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

    res.json({
      success: true,
      message: "Salida registrada correctamente",
      data: updated,
      calculations: {
        t_despalillo,
        t_escogida,
        t_monado,
        sabado,
        septimo_dia,
        he_dinero
      }
    });

  } catch (error) {
    console.error("❌ Error registrando salida:", error);
    res.status(500).json({
      success: false,
      message: "Error registrando salida",
      error: error.message
    });
  }
});

// ===========================================
// 📸 ESCANEO QR -> REGISTRA AUTOMÁTICAMENTE
// ===========================================
router.post('/scan', async (req, res) => {
  try {
    const { qr } = req.body;

    if (!qr)
      return res.status(400).json({ success: false, message: "Falta QR" });

    // Acepta formatos como:
    // "employee:5"
    // "EMPLOYEE:5"
    // "employee: 5"
    const regex = /^employee[:\s]*([0-9]+)$/i;
    const match = qr.match(regex);

    if (!match)
      return res.status(400).json({ success: false, message: "QR inválido" });

    const employee_id = Number(match[1]);

    console.log("📌 Escaneo recibido -> employee_id:", employee_id);

    // Validar empleado
    const employee = await getQuery(
      "SELECT * FROM employees WHERE id = $1",
      [employee_id]
    );

    if (!employee)
      return res.status(404).json({ success: false, message: "Empleado no encontrado" });

    // Registrar automáticamente entrada o salida
    const today = new Date().toISOString().substring(0, 10);

    const existing = await getQuery(`
      SELECT * FROM attendance
      WHERE employee_id = $1 AND date = $2
    `, [employee_id, today]);

    if (!existing) {
      // Registrar entrada
      const now = new Date().toLocaleTimeString("es-HN", { hour12: false });

      const entry = await runQuery(`
        INSERT INTO attendance (employee_id, date, entry_time, created_at, updated_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        RETURNING *;
      `, [employee_id, today, now]);

      return res.json({
        success: true,
        action: "entry",
        message: "Entrada registrada",
        data: entry
      });
    }

    // Registrar salida
    const now = new Date().toLocaleTimeString("es-HN", { hour12: false });

    const exit = await runQuery(`
      UPDATE attendance
      SET exit_time = $1, updated_at = NOW()
      WHERE employee_id = $2 AND date = $3
      RETURNING *;
    `, [now, employee_id, today]);

    res.json({
      success: true,
      action: "exit",
      message: "Salida registrada",
      data: exit
    });

  } catch (error) {
    console.error("❌ Error en /scan:", error);
    res.status(500).json({
      success: false,
      message: "Error procesando escaneo",
      error: error.message
    });
  }
});



module.exports = router;
