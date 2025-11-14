require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');


// 🔧 Importar rutas
const employeesRoutes = require('./routes/employees');
const attendanceRoutes = require('./routes/attendance');
const reportsRoutes = require('./routes/reports');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const dashboardRoutes = require('./routes/dashboard');
const devRoutes = require('./routes/dev');
const uploadsPath = path.join(__dirname, 'uploads');



// Inicializar app Express
const app = express();

app.use((req, res, next) => {
  // Generador simple sin dependencias
  req.requestId = `${Date.now()}-${Math.random().toString(36).substring(2,8)}`;

  console.log(`➡️ REQ ${req.method} ${req.url} id=${req.requestId} pid=${process.pid}`);

  next();
});
// CORS
// CORS: orígenes permitidos
const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://gjd78.com',

  // React (create-react-app)
  'http://localhost:3000',
  'http://127.0.0.1:3000',

  // Vite (puerto por defecto 5173)
  'http://localhost:5173',
  'http://127.0.0.1:5173'
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
app.use('/api/dev', devRoutes);

app.use('/uploads', (req, res, next) => {
  const filePath = path.join(uploadsPath, req.path);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ success: false, message: 'Archivo no encontrado' });
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


// al final de server.js
const PORT = process.env.PORT || 5000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT} — pid=${process.pid}`);
  });
}

module.exports = app;
