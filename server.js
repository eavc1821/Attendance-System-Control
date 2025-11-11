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

// ✅ CONFIGURACIÓN CORS MEJORADA Y MÁS PERMISIVA
const allowedOrigins = [
  'https://gjd78.com',
  'https://www.gjd78.com',
  'https://attendance-system-control-production.up.railway.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5000'
];

// ✅ MIDDLEWARE CORS SIMPLIFICADO Y ROBUSTO
app.use(cors({
  origin: function (origin, callback) {
    // Permitir requests sin origin (como mobile apps o Postman)
    if (!origin) return callback(null, true);
    
    // En desarrollo, permitir todos los orígenes
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    // En producción, verificar contra la lista
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('🚫 Origen bloqueado por CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// ✅ MANEJAR PREFLIGHT REQUESTS EXPLÍCITAMENTE
app.options('*', cors());

// Security Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false // Deshabilitar CSP temporalmente para testing
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000
});
app.use('/api/', limiter);
app.set('trust proxy', 1);

// ✅ MIDDLEWARE PERSONALIZADO PARA HEADERS CORS (backup)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 
    'Content-Type, Authorization, X-Requested-With, Accept, Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
  
  // Responder inmediatamente a preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// ✅ SERVIR ARCHIVOS ESTÁTICOS - CRÍTICO PARA FOTOS
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health Check con información CORS
app.get('/api/health', async (req, res) => {
  try {
    const dbHealth = await dbConfig.healthCheck();
    
    // Headers adicionales para CORS
    res.header('Access-Control-Expose-Headers', 'X-CORS-Info');
    res.header('X-CORS-Info', 'CORS-enabled');
    
    res.json({ 
      status: 'OK', 
      environment: process.env.NODE_ENV,
      database: dbHealth,
      cors: {
        allowedOrigins: allowedOrigins,
        frontendUrl: process.env.FRONTEND_URL,
        nodeEnv: process.env.NODE_ENV
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      error: error.message
    });
  }
});

// Resto del código permanece igual...
console.log('🚀 Iniciando servidor...');
console.log('Modo:', process.env.NODE_ENV);
console.log('Orígenes CORS permitidos:', allowedOrigins);

dbConfig.initializeDatabase().then(() => {
  console.log(`✅ Base de datos inicializada correctamente`);
  
  // Rutas API
  const authRoutes = require('./routes/auth');
  const employeeRoutes = require('./routes/employees');
  const userRoutes = require('./routes/users');
  const attendanceRoutes = require('./routes/attendance');
  const reportRoutes = require('./routes/reports');
  const dashboardRoutes = require('./routes/dashboard');
  const devRoutes = require('./routes/dev');

  app.use('/api/auth', authRoutes);
  app.use('/api/employees', employeeRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/dev', devRoutes);

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
    console.log(`🌐 CORS habilitado para: ${allowedOrigins.join(', ')}`);
  });
}).catch(error => {
  console.error('❌ Error crítico inicializando base de datos:', error.message);
  process.exit(1);
});