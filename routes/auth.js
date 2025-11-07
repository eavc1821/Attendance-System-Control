const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getQuery, runQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth'); // Importar el middleware
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Usuario y contraseña son requeridos'
      });
    }

    // Buscar usuario
    const user = await getQuery(
      'SELECT * FROM users WHERE username = ? AND is_active = 1',
      [username]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Credenciales inválidas'
      });
    }

    // Verificar contraseña
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Credenciales inválidas'
      });
    }

    // Generar token
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        role: user.role 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

// Verificar token
router.post('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token no proporcionado'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verificar que el usuario aún existe
    const user = await getQuery(
      'SELECT id, username, role FROM users WHERE id = ? AND is_active = 1',
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    res.json({
      success: true,
      user
    });

  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Token inválido'
    });
  }
});

// PUT /api/auth/update-profile - Actualizar perfil del usuario actual
router.put('/update-profile', authenticateToken, async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!username) {
      return res.status(400).json({
        success: false,
        error: 'El nombre de usuario es requerido'
      });
    }

    // Obtener usuario actual
    const user = await getQuery(
      'SELECT * FROM users WHERE id = ? AND is_active = 1',
      [userId]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    // Verificar si el nuevo username ya existe en otro usuario
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

    let updateQuery = 'UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP';
    let queryParams = [username];

    // Si se proporciona nueva contraseña
    if (newPassword && newPassword.trim() !== '') {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          error: 'La contraseña actual es requerida para cambiar la contraseña'
        });
      }

      // Verificar contraseña actual
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({
          success: false,
          error: 'La contraseña actual es incorrecta'
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'La nueva contraseña debe tener al menos 6 caracteres'
        });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      updateQuery += ', password = ?';
      queryParams.push(hashedPassword);
    }

    updateQuery += ' WHERE id = ?';
    queryParams.push(userId);

    // Actualizar usuario
    await runQuery(updateQuery, queryParams);

    // Obtener usuario actualizado
    const updatedUser = await getQuery(
      'SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?',
      [userId]
    );

    res.json({
      success: true,
      message: 'Perfil actualizado exitosamente',
      data: updatedUser
    });

  } catch (error) {
    console.error('Error actualizando perfil:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar perfil: ' + error.message
    });
  }
});

module.exports = router;