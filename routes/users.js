const express = require('express');
const bcrypt = require('bcryptjs');
const { getQuery, allQuery, runQuery } = require('../config/database');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/users - Obtener todos los usuarios
router.get('/', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const users = await allQuery(`
      SELECT 
        id, 
        username, 
        role, 
        is_active,
        created_at,
        updated_at
      FROM users 
      WHERE is_active = 1
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

// GET /api/users/:id - Obtener usuario por ID
router.get('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const user = await getQuery(
      `SELECT id, username, role, created_at, updated_at 
       FROM users WHERE id = ? AND is_active = 1`,
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

// POST /api/users - Crear nuevo usuario
router.post('/', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;

    // Validaciones
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

    // Verificar si el usuario ya existe
    const existingUser = await getQuery(
      'SELECT id FROM users WHERE username = ? AND is_active = 1',
      [username]
    );

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe un usuario con este nombre'
      });
    }

    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insertar usuario
    const result = await runQuery(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, hashedPassword, role]
    );

    // Obtener el usuario creado (sin password)
    const newUser = await getQuery(
      'SELECT id, username, role, created_at FROM users WHERE id = ?',
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

// PUT /api/users/:id - Actualizar usuario
router.put('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const userId = req.params.id;

    // Validaciones
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

    // Verificar si el usuario existe
    const existingUser = await getQuery(
      'SELECT id FROM users WHERE id = ? AND is_active = 1',
      [userId]
    );

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    // Verificar si el username ya existe en otro usuario
    const duplicateUser = await getQuery(
      'SELECT id FROM users WHERE username = ? AND id != ? AND is_active = 1',
      [username, userId]
    );

    if (duplicateUser) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe otro usuario con este nombre'
      });
    }

    // Preparar query de actualización
    let updateQuery = 'UPDATE users SET username = ?, role = ?, updated_at = CURRENT_TIMESTAMP';
    let queryParams = [username, role];

    // Si se proporciona nueva contraseña
    if (password && password.trim() !== '') {
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'La contraseña debe tener al menos 6 caracteres'
        });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      updateQuery += ', password = ?';
      queryParams.push(hashedPassword);
    }

    updateQuery += ' WHERE id = ?';
    queryParams.push(userId);

    // Actualizar usuario
    await runQuery(updateQuery, queryParams);

    // Obtener el usuario actualizado
    const updatedUser = await getQuery(
      'SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?',
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

// DELETE /api/users/:id - Eliminar usuario (soft delete)
router.delete('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    // Verificar si el usuario existe y no es super_admin
    const existingUser = await getQuery(
      'SELECT id, role FROM users WHERE id = ? AND is_active = 1',
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

    // Soft delete
    await runQuery(
      'UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
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