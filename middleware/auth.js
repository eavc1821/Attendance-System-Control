const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'qr-attendance-secret-key-2024';

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false,
      error: 'Token de acceso requerido' 
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ 
        success: false,
        error: 'Token inválido o expirado' 
      });
    }
    req.user = user;
    next();
  });
};

const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ 
      success: false,
      error: 'Se requiere rol de Super Administrador para esta acción' 
    });
  }
  next();
};

const requireAdminOrScanner = (req, res, next) => {
  const allowedRoles = ['super_admin', 'scanner'];
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ 
      success: false,
      error: 'Permisos insuficientes para esta acción' 
    });
  }
  next();
};

module.exports = {
  authenticateToken,
  requireSuperAdmin,
  requireAdminOrScanner,
  JWT_SECRET
};