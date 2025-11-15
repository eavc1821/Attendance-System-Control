require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// 🔧 Importar rutas
const employeesRoutes = require('./routes/employees');
const attendanceRoutes = require('./routes/attendance');
const reportsRoutes = require('./routes/reports');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const dashboardRoutes = require('./routes/dashboard');
const devRoutes = require('./routes/dev');

// 📁 Ruta de uploads
const uploadsPath = path.join(__dirname, 'uploads');

// Inicializar Express
const app = express();

// 🏷️ Identificador de petición
app.use((req, res, next) => {
  req.requestId = `${Date.now()}-${Math.random().toString(36).substring(2,8)}`;
  console.log(`➡️ REQ ${req.method} ${req.url} id=${req.requestId} pid=${process.pid}`);
  next();
});

// 🌐 CORS – orígenes permitidos
const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://gjd78.com',
  'https://www.gjd78.com',
  `https://${process.env.RAILWAY_STATIC_URL}`,
  `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`,
  'https://attendance-system-control-production.up.railway.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

// CORS principal para Express
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Postman, server-to-server
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.warn('❌ CORS bloqueado para origen:', origin);
    return callback(new Error('No autorizado por CORS'));
  },
  credentials: true
}));

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 📁 Servir archivos estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 🔌 Rutas API
app.use('/api/employees', employeesRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/dev', devRoutes);

// Health check
app.get('/', (req, res) => {
  res.send(`<h3>🚀 Backend Activo - ${new Date().toLocaleString()}</h3>`);
});

// 🚀 Iniciar servidor
const PORT = process.env.PORT || 5000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en puerto ${PORT} — pid=${process.pid}`);
  });
}

module.exports = app;
