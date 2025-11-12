require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// 🔧 Importar rutas
const employeesRoutes = require('./routes/employees');
const attendanceRoutes = require('./routes/attendance');
const reportsRoutes = require('./routes/reports');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const dashboardRoutes = require('./routes/dashboard');
const uploadsPath = path.join(__dirname, 'uploads');


// Inicializar app Express
const app = express();

// CORS
const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://gjd78.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    // Permitir peticiones sin origin (como desde Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      console.warn('❌ CORS bloqueado para origen:', origin);
      return callback(new Error('No autorizado por CORS'));
    }
  },
  credentials: true
}));

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 📁 Servir archivos estáticos (uploads)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ⚙️ Rutas
app.use('/api/employees', employeesRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.use('/uploads', (req, res, next) => {
  const filePath = path.join(uploadsPath, req.path);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ success: false, message: 'Archivo no encontrado' });
  }
});

// ⚠️ SOLO PARA EJECUTAR UNA VEZ - ELIMINAR DESPUÉS
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});

app.get('/api/fix/attendance-columns', async (req, res) => {
  try {
    await pool.query(`
      ALTER TABLE attendance ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE attendance ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);
    res.json({ success: true, message: 'Columnas creadas correctamente ✅' });
  } catch (error) {
    console.error('❌ Error ejecutando SQL:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// Health check
app.get('/', (req, res) => {
  res.send(`<h3>🚀 Backend Activo - ${new Date().toLocaleString()}</h3>`);
});

// Crear servidor HTTP + Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }
});

// Guardar referencia de io en la app para usar dentro de rutas
app.set('io', io);

// Eventos Socket.IO
io.on('connection', (socket) => {
  console.log('🟢 Cliente conectado:', socket.id);

  socket.on('disconnect', () => {
    console.log('🔴 Cliente desconectado:', socket.id);
  });
});

// Puerto
const PORT = process.env.PORT || 3001;

// Iniciar servidor
server.listen(PORT, () => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${PORT}`;
  console.log(`✅ Servidor corriendo en ${backendUrl}`);
  console.log(`✅ Socket.IO habilitado`);
});

module.exports = app;
