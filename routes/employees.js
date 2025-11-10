const express = require('express');
const qr = require('qr-image');
const path = require('path');
const fs = require('fs');
const { getQuery, allQuery, runQuery } = require('../config/database');
const { authenticateToken, requireAdminOrScanner } = require('../middleware/auth');
const upload = require('../config/upload');

const router = express.Router();

// GET /api/employees - MEJORADO PARA FOTOS
router.get('/', authenticateToken, async (req, res) => {
  try {
    console.log('📥 GET /api/employees - Usuario:', req.user?.username);
    
    const employees = await allQuery(`
      SELECT 
        id, 
        name, 
        dni, 
        type, 
        monthly_salary,
        photo,
        qr_code,
        is_active,
        created_at
      FROM employees 
      WHERE is_active = true
      ORDER BY name
    `);

    console.log(`✅ Encontrados ${employees.length} empleados activos`);

    // ✅ CORREGIDO: URL dinámica para Railway
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? process.env.RAILWAY_STATIC_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` || 'https://gjd78.com'
      : 'http://localhost:5000';

    console.log('🌐 Base URL para fotos:', baseUrl);

    const employeesWithFullPhoto = employees.map(employee => {
      // ✅ MEJORADO: Manejo robusto de fotos
      let photoUrl = null;
      if (employee.photo) {
        // Si ya es una URL completa, mantenerla
        if (employee.photo.startsWith('http')) {
          photoUrl = employee.photo;
        } else {
          // Si es una ruta relativa, construir URL completa
          photoUrl = `${baseUrl}${employee.photo}`;
        }
      }
      
      return {
        ...employee,
        photo: photoUrl
      };
    });

    res.json({
      success: true,
      data: employeesWithFullPhoto,
      count: employeesWithFullPhoto.length
    });

  } catch (error) {
    console.error('❌ Error obteniendo empleados:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener la lista de empleados: ' + error.message
    });
  }
});

// POST /api/employees - MEJORADO SUBIDA DE FOTOS
router.post('/', authenticateToken, requireAdminOrScanner, upload.single('photo'), async (req, res) => {
  let photoFile = null;
  
  try {
    console.log('📥 POST /api/employees - Body:', req.body);
    console.log('📸 Archivo recibido:', req.file);
    console.log('👤 Usuario:', req.user?.username);

    const { name, dni, type, monthly_salary } = req.body;
    photoFile = req.file;

    // Validaciones
    if (!name || !dni || !type) {
      console.log('❌ Validación fallida - Campos requeridos faltantes');
      if (photoFile) {
        try { fs.unlinkSync(photoFile.path); } catch (e) { console.error('Error eliminando archivo:', e); }
      }
      return res.status(400).json({
        success: false,
        error: 'Nombre, DNI y tipo son campos requeridos'
      });
    }

    if (dni.length !== 13) {
      console.log('❌ Validación fallida - DNI incorrecto:', dni);
      if (photoFile) {
        try { fs.unlinkSync(photoFile.path); } catch (e) { console.error('Error eliminando archivo:', e); }
      }
      return res.status(400).json({
        success: false,
        error: 'El DNI debe tener exactamente 13 dígitos'
      });
    }

    const salaryValue = parseFloat(monthly_salary) || 0;
    if (type === 'Al Dia' && salaryValue <= 0) {
      console.log('❌ Validación fallida - Salario inválido para Al Dia');
      if (photoFile) {
        try { fs.unlinkSync(photoFile.path); } catch (e) { console.error('Error eliminando archivo:', e); }
      }
      return res.status(400).json({
        success: false,
        error: 'Los empleados tipo "Al Dia" requieren un salario mensual válido mayor a 0'
      });
    }

    // Verificar DNI existente
    let existingEmployee;
    try {
      existingEmployee = await getQuery(
        'SELECT id FROM employees WHERE dni = $1 AND is_active = true',
        [dni]
      );
      console.log('🔍 Resultado de búsqueda de DNI existente:', existingEmployee);
    } catch (dbError) {
      console.error('❌ Error en consulta de DNI existente:', dbError);
      if (photoFile) {
        try { fs.unlinkSync(photoFile.path); } catch (e) { console.error('Error eliminando archivo:', e); }
      }
      return res.status(500).json({
        success: false,
        error: 'Error al verificar DNI en la base de datos'
      });
    }

    if (existingEmployee) {
      console.log('❌ DNI ya existe:', dni);
      if (photoFile) {
        try { fs.unlinkSync(photoFile.path); } catch (e) { console.error('Error eliminando archivo:', e); }
      }
      return res.status(400).json({
        success: false,
        error: 'Ya existe un empleado activo con este DNI'
      });
    }

    // Generar QR
    const qrData = JSON.stringify({ 
      id: Date.now(), 
      name, 
      dni, 
      type 
    });
    const qrCode = qr.imageSync(qrData, { type: 'png' }).toString('base64');

    const photoPath = photoFile ? `/uploads/${photoFile.filename}` : null;

    console.log('💾 Insertando empleado en BD...');
    
    // ✅ CORRECCIÓN: runQuery devuelve un objeto con propiedad 'rows'
    let newEmployee;
    try {
      const result = await runQuery(
        `INSERT INTO employees (name, dni, type, monthly_salary, photo, qr_code) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [name.trim(), dni, type, salaryValue, photoPath, qrCode]
      );
      
      console.log('✅ Resultado completo de runQuery:', result);
      
      // ✅ CORRECCIÓN: Acceder a result.rows[0] para PostgreSQL
      if (result && result.rows && result.rows.length > 0) {
        newEmployee = result.rows[0];
        console.log('✅ Empleado insertado con ID:', newEmployee.id);
      } else {
        console.error('❌ No se pudo obtener el empleado insertado. Resultado:', result);
        throw new Error('No se pudo recuperar el empleado recién creado de la base de datos');
      }
      
    } catch (insertError) {
      console.error('❌ Error insertando empleado:', insertError);
      if (photoFile) {
        try { fs.unlinkSync(photoFile.path); } catch (e) { console.error('Error eliminando archivo:', e); }
      }
      return res.status(500).json({
        success: false,
        error: 'Error al insertar empleado en la base de datos: ' + insertError.message
      });
    }

    // Verificar que newEmployee existe
    if (!newEmployee) {
      console.error('❌ newEmployee es undefined después de la inserción');
      if (photoFile) {
        try { fs.unlinkSync(photoFile.path); } catch (e) { console.error('Error eliminando archivo:', e); }
      }
      return res.status(500).json({
        success: false,
        error: 'Empleado creado pero no se pudo recuperar los datos'
      });
    }

    console.log('✅ Empleado recuperado después de crear:', newEmployee);

    // Generar URL completa
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://gjd78.com' 
      : 'http://localhost:5000';

    if (newEmployee.photo) {
      newEmployee.photo = `${baseUrl}${newEmployee.photo}`;
    }

    console.log('✅ Empleado creado exitosamente:', newEmployee.name);

    res.status(201).json({
      success: true,
      message: 'Empleado creado exitosamente',
      data: newEmployee
    });

  } catch (error) {
    console.error('❌ Error general creando empleado:', error);
    console.error('🔍 Stack trace:', error.stack);
    
    // Limpiar archivo subido en caso de error
    if (photoFile) {
      try { 
        fs.unlinkSync(photoFile.path); 
        console.log('🗑️ Archivo temporal eliminado por error');
      } catch (e) { 
        console.error('Error eliminando archivo temporal:', e); 
      }
    }
    
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor al crear empleado: ' + error.message
    });
  }
});

// PUT /api/employees/:id - CORREGIDO para trabajar con tu database.js
router.put('/:id', authenticateToken, requireAdminOrScanner, upload.single('photo'), async (req, res) => {
  let photoFile = null;
  
  try {
    console.log('📥 PUT /api/employees/:id - ID:', req.params.id);

    const { name, dni, type, monthly_salary, remove_photo } = req.body;
    photoFile = req.file;
    const employeeId = req.params.id;

    // Validaciones
    if (!name || !dni || !type) {
      if (photoFile) {
        try { fs.unlinkSync(photoFile.path); } catch (e) { console.error('Error eliminando archivo:', e); }
      }
      return res.status(400).json({
        success: false,
        error: 'Nombre, DNI y tipo son campos requeridos'
      });
    }

    if (dni.length !== 13) {
      if (photoFile) {
        try { fs.unlinkSync(photoFile.path); } catch (e) { console.error('Error eliminando archivo:', e); }
      }
      return res.status(400).json({
        success: false,
        error: 'El DNI debe tener exactamente 13 dígitos'
      });
    }

    // Verificar que el empleado exista
    let existingEmployee;
    try {
      existingEmployee = await getQuery(
        'SELECT id, photo FROM employees WHERE id = $1 AND is_active = true',
        [employeeId]
      );
      console.log('🔍 Empleado existente encontrado:', existingEmployee);
    } catch (dbError) {
      console.error('❌ Error buscando empleado existente:', dbError);
      if (photoFile) {
        try { fs.unlinkSync(photoFile.path); } catch (e) { console.error('Error eliminando archivo:', e); }
      }
      return res.status(500).json({
        success: false,
        error: 'Error al buscar empleado en la base de datos'
      });
    }

    if (!existingEmployee) {
      console.log('❌ Empleado no encontrado:', employeeId);
      if (photoFile) {
        try { fs.unlinkSync(photoFile.path); } catch (e) { console.error('Error eliminando archivo:', e); }
      }
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado'
      });
    }

    // Verificar DNI duplicado
    let duplicateDni;
    try {
      duplicateDni = await getQuery(
        'SELECT id FROM employees WHERE dni = $1 AND id != $2 AND is_active = true',
        [dni, employeeId]
      );
    } catch (dbError) {
      console.error('❌ Error verificando DNI duplicado:', dbError);
      if (photoFile) {
        try { fs.unlinkSync(photoFile.path); } catch (e) { console.error('Error eliminando archivo:', e); }
      }
      return res.status(500).json({
        success: false,
        error: 'Error al verificar DNI duplicado'
      });
    }

    if (duplicateDni) {
      console.log('❌ DNI duplicado:', dni);
      if (photoFile) {
        try { fs.unlinkSync(photoFile.path); } catch (e) { console.error('Error eliminando archivo:', e); }
      }
      return res.status(400).json({
        success: false,
        error: 'Ya existe otro empleado activo con este DNI'
      });
    }

    // Manejo de foto
     let photoPath = existingEmployee.photo;
    
    if (remove_photo === 'true' && existingEmployee.photo) {
      // Extraer solo el nombre del archivo de la URL
      const filename = path.basename(existingEmployee.photo);
      const oldPhotoPath = path.join(__dirname, '..', 'uploads', filename);
      if (fs.existsSync(oldPhotoPath)) {
        try {
          fs.unlinkSync(oldPhotoPath);
          console.log('🗑️ Foto anterior eliminada:', filename);
        } catch (e) {
          console.error('Error eliminando foto anterior:', e);
        }
      }
      photoPath = null;
    }
    
    if (photoFile) {
      // Eliminar foto anterior si existe
      if (existingEmployee.photo) {
        const filename = path.basename(existingEmployee.photo);
        const oldPhotoPath = path.join(__dirname, '..', 'uploads', filename);
        if (fs.existsSync(oldPhotoPath)) {
          try {
            fs.unlinkSync(oldPhotoPath);
            console.log('🗑️ Foto anterior reemplazada:', filename);
          } catch (e) {
            console.error('Error eliminando foto anterior:', e);
          }
        }
      }
      photoPath = `/uploads/${photoFile.filename}`;
      console.log('📁 Nueva ruta de foto:', photoPath);
    }

    const salaryValue = parseFloat(monthly_salary) || 0;

    // ✅ CORRECCIÓN: runQuery devuelve un objeto con propiedad 'rows'
    let updatedEmployee;
    try {
      const result = await runQuery(
        `UPDATE employees 
         SET name = $1, dni = $2, type = $3, monthly_salary = $4, photo = $5, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $6
         RETURNING *`,
        [name.trim(), dni, type, salaryValue, photoPath, employeeId]
      );
      
      console.log('✅ Resultado completo de runQuery:', result);
      
      // ✅ CORRECCIÓN: Acceder a result.rows[0] para PostgreSQL
      if (result && result.rows && result.rows.length > 0) {
        updatedEmployee = result.rows[0];
        console.log('✅ Empleado actualizado:', updatedEmployee);
      } else {
        console.error('❌ No se pudo obtener el empleado actualizado. Resultado:', result);
        throw new Error('No se pudo recuperar el empleado actualizado de la base de datos');
      }
    } catch (updateError) {
      console.error('❌ Error actualizando empleado:', updateError);
      if (photoFile) {
        try { fs.unlinkSync(photoFile.path); } catch (e) { console.error('Error eliminando archivo:', e); }
      }
      return res.status(500).json({
        success: false,
        error: 'Error al actualizar empleado en la base de datos: ' + updateError.message
      });
    }

    // Verificar que updatedEmployee existe
    if (!updatedEmployee) {
      console.error('❌ updatedEmployee es undefined después de la actualización');
      return res.status(500).json({
        success: false,
        error: 'Empleado actualizado pero no se pudo recuperar los datos'
      });
    }

    // Generar URL completa
   const baseUrl = process.env.NODE_ENV === 'production' 
      ? process.env.RAILWAY_STATIC_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` || 'https://gjd78.com'
      : 'http://localhost:5000';

    if (updatedEmployee.photo) {
      updatedEmployee.photo = `${baseUrl}${updatedEmployee.photo}`;
    }

    res.json({
      success: true,
      message: 'Empleado actualizado exitosamente',
      data: updatedEmployee
    });

  } catch (error) {
    console.error('❌ Error general actualizando empleado:', error);
    if (photoFile && photoFile.path) {
      try { 
        fs.unlinkSync(photoFile.path); 
        console.log('🗑️ Archivo temporal eliminado por error');
      } catch (e) { 
        console.error('Error eliminando archivo temporal:', e); 
      }
    }
    
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor al actualizar empleado: ' + error.message
    });
  }
});

// DELETE /api/employees/:id
router.delete('/:id', authenticateToken, requireAdminOrScanner, async (req, res) => {
  try {
    const employeeId = req.params.id;

    const existingEmployee = await getQuery(
      'SELECT id, photo FROM employees WHERE id = $1 AND is_active = true',
      [employeeId]
    );

    if (!existingEmployee) {
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado'
      });
    }

    if (existingEmployee.photo) {
      const photoPath = path.join(__dirname, '..', existingEmployee.photo);
      if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
    }

    await runQuery(
      'UPDATE employees SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [employeeId]
    );

    res.json({
      success: true,
      message: 'Empleado eliminado exitosamente'
    });

  } catch (error) {
    console.error('Error eliminando empleado:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar empleado'
    });
  }
});

// GET /api/employees/:id/qr
router.get('/:id/qr', authenticateToken, async (req, res) => {
  try {
    const employee = await getQuery(
      'SELECT qr_code FROM employees WHERE id = $1 AND is_active = true',
      [req.params.id]
    );

    if (!employee || !employee.qr_code) {
      return res.status(404).json({
        success: false,
        error: 'QR no encontrado'
      });
    }

    const qrBuffer = Buffer.from(employee.qr_code, 'base64');
    
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': qrBuffer.length,
      'Content-Disposition': `attachment; filename="qr-${req.params.id}.png"`
    });
    
    res.end(qrBuffer);

  } catch (error) {
    console.error('Error obteniendo QR:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener QR'
    });
  }
});

// GET /api/employees/:id/stats
router.get('/:id/stats', authenticateToken, async (req, res) => {
  try {
    const employeeId = req.params.id;
    console.log(`📊 Solicitando estadísticas para empleado ID: ${employeeId}`);

    const employee = await getQuery(
      'SELECT id, name, type, monthly_salary FROM employees WHERE id = $1 AND is_active = true',
      [employeeId]
    );

    console.log(`🔍 Empleado encontrado:`, employee);

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado'
      });
    }

    const today = new Date().toISOString().split('T')[0];
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    console.log(`📅 Mes actual para filtro: ${currentYear}-${currentMonth}`);

    if (employee.type === 'Producción') {
      console.log(`🔧 Calculando estadísticas para empleado de PRODUCCIÓN`);
      
      const stats = await getQuery(`
        SELECT 
          COUNT(*) as dias_trabajados,
          COALESCE(SUM(despalillo), 0) as total_despalillo,
          COALESCE(SUM(escogida), 0) as total_escogida,
          COALESCE(SUM(monado), 0) as total_monado,
          COALESCE(SUM(t_despalillo), 0) as t_despalillo,
          COALESCE(SUM(t_escogida), 0) as t_escogida,
          COALESCE(SUM(t_monado), 0) as t_monado,
          COALESCE(SUM(septimo_dia), 0) as septimo_dia
        FROM attendance 
        WHERE employee_id = $1 
        AND EXTRACT(YEAR FROM date) = $2
        AND EXTRACT(MONTH FROM date) = $3
        AND exit_time IS NOT NULL
      `, [employeeId, currentYear, currentMonth]);

      console.log(`📈 Estadísticas de producción:`, stats);

      const propSabado = (stats.t_despalillo + stats.t_escogida + stats.t_monado) * 0.090909;
      const netoPagar = stats.t_despalillo + stats.t_escogida + stats.t_monado + propSabado + stats.septimo_dia;

      res.json({
        success: true,
        data: {
          ...stats,
          prop_sabado: Math.round(propSabado * 100) / 100,  
          neto_pagar: Math.round(netoPagar * 100) / 100,    
          type: 'production'
        }
      });

    } else {
      console.log(`🔧 Calculando estadísticas para empleado AL DÍA`);
      
      const stats = await getQuery(`
        SELECT 
          COUNT(*) as dias_trabajados,
          COALESCE(SUM(hours_extra), 0) as horas_extras
        FROM attendance 
        WHERE employee_id = $1 
        AND EXTRACT(YEAR FROM date) = $2
        AND EXTRACT(MONTH FROM date) = $3
        AND exit_time IS NOT NULL
      `, [employeeId, currentYear, currentMonth]);

      console.log(`📈 Estadísticas base al día:`, stats);

      const salarioDiario = (employee.monthly_salary || 0) / 30;
      const valorHoraNormal = salarioDiario / 8;
      const valorHoraExtra = valorHoraNormal * 1.25;
      const heDinero = stats.horas_extras * valorHoraExtra;
      const sabado = salarioDiario;
      const septimoDia = (stats.dias_trabajados >= 5) ? salarioDiario : 0;
      const netoPagar = (stats.dias_trabajados * salarioDiario) + heDinero + sabado + septimoDia;

      console.log(`🧮 Cálculos adicionales:`, {
        salarioDiario,
        heDinero,
        sabado,
        septimoDia,
        netoPagar
      });

      res.json({
        success: true,
        data: {
          dias_trabajados: stats.dias_trabajados,
          horas_extras: stats.horas_extras,
          he_dinero: Math.round(heDinero * 100) / 100,
          salario_diario: Math.round(salarioDiario * 100) / 100,
          sabado: Math.round(sabado * 100) / 100,
          septimo_dia: Math.round(septimoDia * 100) / 100,
          neto_pagar: Math.round(netoPagar * 100) / 100,
          type: 'al_dia'
        }
      });
    }

  } catch (error) {
    console.error('❌ Error obteniendo estadísticas del empleado:', error);
    console.error('🔍 Stack trace:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Error al obtener estadísticas del empleado: ' + error.message
    });
  }
});

module.exports = router;