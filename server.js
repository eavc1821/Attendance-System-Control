const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Importar configuración de base de datos según entorno
const dbConfig = process.env.NODE_ENV === 'production' 
  ? require('./config/database-pg')
  : require('./config/database');

const app = express();
const PORT = process.env.PORT || 5000;

// Security Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

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
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    environment: process.env.NODE_ENV,
    database: process.env.NODE_ENV === 'production' ? 'PostgreSQL' : 'SQLite',
    timestamp: new Date().toISOString()
  });
});

// Inicializar base de datos
const initializeDB = process.env.NODE_ENV === 'production' 
  ? dbConfig.initializePostgreSQL 
  : dbConfig.initializeDatabase;

initializeDB().then(() => {
  console.log(`✅ Base de datos inicializada en modo ${process.env.NODE_ENV}`);
  
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
    console.log(`📊 Modo: ${process.env.NODE_ENV}`);
    console.log(`📍 Health: http://localhost:${PORT}/api/health`);
  });
}).catch(error => {
  console.error('❌ Error inicializando base de datos:', error);
  process.exit(1);
});