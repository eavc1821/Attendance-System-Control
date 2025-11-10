const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Importar configuración unificada de base de datos
const dbConfig = require('./config/database');

const app = express();
const PORT = process.env.PORT || 5000;

// Security Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);
app.set('trust proxy', 1);

// ✅ SERVIR ARCHIVOS ESTÁTICOS - CRÍTICO PARA FOTOS
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// CORS Configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir archivos estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    const dbHealth = await dbConfig.healthCheck();
    res.json({ 
      status: 'OK', 
      environment: process.env.NODE_ENV,
      database: dbHealth,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      error: error.message
    });
  }
});

// Inicializar base de datos
console.log('🚀 Iniciando servidor...');
console.log('Modo:', process.env.NODE_ENV);

dbConfig.initializeDatabase().then(() => {
  console.log(`✅ Base de datos inicializada correctamente`);
  
  // Rutas API
  const authRoutes = require('./routes/auth');
  const employeeRoutes = require('./routes/employees');
  const userRoutes = require('./routes/users');
  const attendanceRoutes = require('./routes/attendance');
  const reportRoutes = require('./routes/reports');
  const dashboardRoutes = require('./routes/dashboard');

  app.use('/api/auth', authRoutes);
  app.use('/api/employees', employeeRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/dashboard', dashboardRoutes);

  // Manejo de errores 404
  app.use('*', (req, res) => {
    res.status(404).json({ 
      success: false,
      error: 'Ruta no encontrada' 
    });
  });

  // Manejo de errores global
  app.use((error, req, res, next) => {
    console.error('Error global:', error);
    res.status(500).json({ 
      success: false,
      error: process.env.NODE_ENV === 'production' 
        ? 'Error interno del servidor' 
        : error.message 
    });
  });

  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`📍 Health: http://localhost:${PORT}/api/health`);
  });
}).catch(error => {
  console.error('❌ Error crítico inicializando base de datos:', error.message);
  process.exit(1);
});