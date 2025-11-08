const express = require('express');
const bcrypt = require('bcryptjs');
const { getQuery, allQuery, runQuery } = require('../config/database');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/users - CORREGIDO
router.get('/', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    // ✅ CORREGIDO: is_active = 1 → is_active = true
    const users = await allQuery(`
      SELECT 
        id, 
        username, 
        role, 
        is_active,
        created_at,
        updated_at
      FROM users 
      WHERE is_active = true
      ORDER BY created_at DESC
    `);

    res.json({
      success: true,
      data: users,
      count: users.length
    });

  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener usuarios'
    });
  }
});

// GET /api/users/:id - CORREGIDO
router.get('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    // ✅ CORREGIDO: ? → $1, is_active = 1 → is_active = true
    const user = await getQuery(
      `SELECT id, username, role, created_at, updated_at 
       FROM users WHERE id = $1 AND is_active = true`,
      [req.params.id]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    res.json({
      success: true,
      data: user
    });

  } catch (error) {
    console.error('Error obteniendo usuario:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener usuario'
    });
  }
});

// POST /api/users - CORREGIDO
router.post('/', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({
        success: false,
        error: 'Usuario, contraseña y rol son campos requeridos'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'La contraseña debe tener al menos 6 caracteres'
      });
    }

    const allowedRoles = ['scanner', 'viewer'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Rol no válido. Los roles permitidos son: scanner, viewer'
      });
    }

    // ✅ CORREGIDO: ? → $1, is_active = 1 → is_active = true
    const existingUser = await getQuery(
      'SELECT id FROM users WHERE username = $1 AND is_active = true',
      [username]
    );

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe un usuario con este nombre'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ CORREGIDO: ? → $1, $2, $3
    const result = await runQuery(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
      [username, hashedPassword, role]
    );

    // ✅ CORREGIDO: ? → $1
    const newUser = await getQuery(
      'SELECT id, username, role, created_at FROM users WHERE id = $1',
      [result.id]
    );

    res.status(201).json({
      success: true,
      message: 'Usuario creado exitosamente',
      data: newUser
    });

  } catch (error) {
    console.error('Error creando usuario:', error);
    res.status(500).json({
      success: false,
      error: 'Error al crear usuario'
    });
  }
});

// PUT /api/users/:id - CORREGIDO
router.put('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const userId = req.params.id;

    if (!username || !role) {
      return res.status(400).json({
        success: false,
        error: 'Usuario y rol son campos requeridos'
      });
    }

    const allowedRoles = ['scanner', 'viewer'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Rol no válido. Los roles permitidos son: scanner, viewer'
      });
    }

    // ✅ CORREGIDO: ? → $1, is_active = 1 → is_active = true
    const existingUser = await getQuery(
      'SELECT id FROM users WHERE id = $1 AND is_active = true',
      [userId]
    );

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    // ✅ CORREGIDO: ? → $1, $2
    const duplicateUser = await getQuery(
      'SELECT id FROM users WHERE username = $1 AND id != $2 AND is_active = true',
      [username, userId]
    );

    if (duplicateUser) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe otro usuario con este nombre'
      });
    }

    let updateQuery = 'UPDATE users SET username = $1, role = $2, updated_at = CURRENT_TIMESTAMP';
    let queryParams = [username, role];

    if (password && password.trim() !== '') {
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'La contraseña debe tener al menos 6 caracteres'
        });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      updateQuery += ', password = $3';
      queryParams.push(hashedPassword);
    }

    updateQuery += ' WHERE id = $' + (queryParams.length + 1);
    queryParams.push(userId);

    await runQuery(updateQuery, queryParams);

    // ✅ CORREGIDO: ? → $1
    const updatedUser = await getQuery(
      'SELECT id, username, role, created_at, updated_at FROM users WHERE id = $1',
      [userId]
    );

    res.json({
      success: true,
      message: 'Usuario actualizado exitosamente',
      data: updatedUser
    });

  } catch (error) {
    console.error('Error actualizando usuario:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar usuario: ' + error.message
    });
  }
});

// DELETE /api/users/:id - CORREGIDO
router.delete('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    // ✅ CORREGIDO: ? → $1, is_active = 1 → is_active = true
    const existingUser = await getQuery(
      'SELECT id, role FROM users WHERE id = $1 AND is_active = true',
      [userId]
    );

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    if (existingUser.role === 'super_admin') {
      return res.status(400).json({
        success: false,
        error: 'No se puede eliminar un Super Administrador'
      });
    }

    // ✅ CORREGIDO: ? → $1, is_active = 0 → is_active = false
    await runQuery(
      'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [userId]
    );

    res.json({
      success: true,
      message: 'Usuario eliminado exitosamente'
    });

  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar usuario'
    });
  }
});

module.exports = router;