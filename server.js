const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// Google Analytics Measurement ID
const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID || '';
app.locals.gaMeasurementId = GA_MEASUREMENT_ID;
app.locals.gaCookieDomain = GA_MEASUREMENT_ID ? (process.env.GA_COOKIE_DOMAIN || 'chekamicuaderno.up.railway.app') : '';
const PORT = process.env.PORT || 3000;

// Detectar Volume de Railway montado en /data (no depende de env vars)
const VOLUME_MOUNT = fs.existsSync('/data') ? '/data' : '';
const UPLOADS_BASE = VOLUME_MOUNT
  ? path.join(VOLUME_MOUNT, 'uploads')
  : path.join(__dirname, 'public', 'uploads');

// Config dentro del Volume (persiste entre redeploys)
const CONFIG_DIR = VOLUME_MOUNT
  ? path.join(VOLUME_MOUNT, 'config')
  : path.join(__dirname, 'config');
const PASSWORD_FILE = path.join(CONFIG_DIR, 'password.json');

// Asegurar directorios
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_BASE)) {
  fs.mkdirSync(UPLOADS_BASE, { recursive: true });
}

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));
if (VOLUME_MOUNT) {
  app.use('/uploads', express.static(UPLOADS_BASE, { maxAge: '1d' }));
}

// Configuración de EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configuración de Sesiones
app.use(session({
  secret: process.env.SESSION_SECRET || 'clave-secreta-preuniversitaria',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 día
}));

// Leer contraseña de configuración
function getAdminPassword() {
  const envPw = process.env.ADMIN_PASSWORD;
  if (envPw) return envPw;
  if (fs.existsSync(PASSWORD_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(PASSWORD_FILE, 'utf8'));
      if (data.password) return data.password;
    } catch (e) { /* ignorar */ }
  }
  return 'admin';
}

function isPasswordConfigured() {
  return !!(process.env.ADMIN_PASSWORD || (fs.existsSync(PASSWORD_FILE) && JSON.parse(fs.readFileSync(PASSWORD_FILE, 'utf8')).password));
}

// Middleware para proteger rutas de admin
function requireLogin(req, res, next) {
  if (req.session.loggedIn) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Middleware que redirige a setup si no hay contraseña configurada
function requireSetup(req, res, next) {
  if (!isPasswordConfigured()) {
    return res.redirect('/setup-password');
  }
  next();
}

// Configuración de Multer para subida dinámica
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const course = req.body.course || 'aritmetica';
    let weekNum = parseInt(req.body.week);
    if (isNaN(weekNum)) weekNum = 1;
    const weekFolder = 'semana' + String(weekNum).padStart(2, '0');
    
    const dir = path.join(UPLOADS_BASE, course, weekFolder);
    
    // Crear directorio si no existe
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // Sanitizar nombre de archivo agregando timestamp para evitar duplicados
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, baseName + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|webp|gif/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Solo se permiten imágenes (jpg, jpeg, png, webp, gif)"));
  }
});

// Helper para obtener fotos de una semana
function getPhotosForWeek(course, weekNum) {
  const weekFolder = 'semana' + String(weekNum).padStart(2, '0');
  const dir = path.join(UPLOADS_BASE, course, weekFolder);
  if (fs.existsSync(dir)) {
    try {
      const files = fs.readdirSync(dir).sort();
      // Filtrar por extensiones comunes de imágenes
      return files.filter(file => /\.(jpg|jpeg|png|webp|gif)$/i.test(file))
                  .map(file => `/uploads/${course}/${weekFolder}/${file}`);
    } catch (e) {
      console.error(e);
      return [];
    }
  }
  return [];
}

// === DIAGNÓSTICO ===
app.get('/debug-env', (req, res) => {
  const allKeys = Object.keys(process.env).sort();
  const pwKeys = allKeys.filter(k => /pass|admin|key|secret/i.test(k));
  res.json({
    GA_MEASUREMENT_ID_SET: !!process.env.GA_MEASUREMENT_ID,
    ADMIN_PASSWORD_SET: !!process.env.ADMIN_PASSWORD,
    HAS_PASSWORD_FILE: fs.existsSync(PASSWORD_FILE),
    ADMIN_LENGTH: process.env.ADMIN_PASSWORD ? process.env.ADMIN_PASSWORD.length : 0,
    VOLUME_MOUNT: VOLUME_MOUNT,
    VOLUME_EXISTS: fs.existsSync('/data'),
    VOLUME_WRITABLE: (() => { try { fs.writeFileSync('/data/.test', ''); fs.unlinkSync('/data/.test'); return true; } catch(e) { return false; } })(),
    UPLOADS_BASE: UPLOADS_BASE,
    TOTAL_ENV_KEYS: allKeys.length,
    ENV_KEYS_FILTERED: pwKeys,
    RAILWAY_KEYS: allKeys.filter(k => /RAILWAY|RAIL/i.test(k)),
    VOLUME_KEYS: allKeys.filter(k => /VOLUME|MOUNT|VOL/i.test(k)),
    ADMIN_KEYS: allKeys.filter(k => /ADMIN/i.test(k)),
    NODE_ENV: process.env.NODE_ENV || 'no definido'
  });
});

// === RUTAS PÚBLICAS ===

// Setup - Configurar contraseña por primera vez
app.get('/setup-password', (req, res) => {
  if (isPasswordConfigured()) {
    if (req.session.loggedIn) return res.redirect('/admin');
    return res.redirect('/login');
  }
  res.render('setup-password', { error: null });
});

app.post('/setup-password', (req, res) => {
  if (isPasswordConfigured()) {
    if (req.session.loggedIn) return res.redirect('/admin');
    return res.redirect('/login');
  }
  const { password, confirm } = req.body;
  if (!password || password.length < 4) {
    return res.render('setup-password', { error: 'La contraseña debe tener al menos 4 caracteres' });
  }
  if (password !== confirm) {
    return res.render('setup-password', { error: 'Las contraseñas no coinciden' });
  }
  fs.writeFileSync(PASSWORD_FILE, JSON.stringify({ password }), 'utf8');
  req.session.loggedIn = true;
  res.redirect('/admin');
});

// Inicio
app.get('/', (req, res) => {
  const courses = [
    { id: 'aritmetica', name: 'Aritmética', description: 'Razones, proporciones, conjuntos, probabilidades y más.' },
    { id: 'algebra', name: 'Álgebra', description: 'Ecuaciones, funciones, matrices, programación lineal y más.' },
    { id: 'geometria', name: 'Geometría', description: 'Triángulos, circunferencia, geometría del espacio y más.' },
    { id: 'trigonometria', name: 'Trigonometría', description: 'Ángulos, identidades, funciones trigonométricas y más.' },
    { id: 'fisica', name: 'Física', description: 'Vectores, cinemática, electromagnetismo, óptica y más.' },
    { id: 'quimica', name: 'Química', description: 'Estructura atómica, enlaces, estequiometría, orgánica y más.' }
  ];
  res.render('index', { courses, loggedIn: req.session.loggedIn });
});

// Ver un Curso con todas sus semanas
app.get('/curso/:id', (req, res) => {
  const courseId = req.params.id;
  const jsonPath = path.join(__dirname, 'data', `${courseId}.json`);
  
  if (!fs.existsSync(jsonPath)) {
    return res.status(404).send('Curso no encontrado');
  }

  try {
    const courseData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    // Obtener fotos para cada semana en los datos
    const weeksWithPhotos = courseData.weeks.map(week => {
      const photos = getPhotosForWeek(courseId, week.num);
      return {
        ...week,
        photos: photos
      };
    });

    res.render('curso', { 
      courseName: courseData.courseName,
      courseId: courseId,
      weeks: weeksWithPhotos,
      loggedIn: req.session.loggedIn
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al cargar el curso');
  }
});

// === RUTAS DE AUTENTICACIÓN Y ADMIN ===

// Login Form
app.get('/login', requireSetup, (req, res) => {
  if (req.session.loggedIn) {
    return res.redirect('/admin');
  }
  res.render('login', { error: null });
});

// Login POST
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === getAdminPassword()) {
    req.session.loggedIn = true;
    res.redirect('/admin');
  } else {
    res.render('login', { error: 'Contraseña incorrecta' });
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Dashboard de Admin
app.get('/admin', requireLogin, (req, res) => {
  const courses = [
    { id: 'aritmetica', name: 'Aritmética' },
    { id: 'algebra', name: 'Álgebra' },
    { id: 'geometria', name: 'Geometría' },
    { id: 'trigonometria', name: 'Trigonometría' },
    { id: 'fisica', name: 'Física' },
    { id: 'quimica', name: 'Química' }
  ];
  res.render('admin', { courses });
});

// Admin de un curso específico
app.get('/admin/curso/:id', requireLogin, (req, res) => {
  const courseId = req.params.id;
  const jsonPath = path.join(__dirname, 'data', `${courseId}.json`);
  
  if (!fs.existsSync(jsonPath)) {
    return res.status(404).send('Curso no encontrado');
  }

  try {
    const courseData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    // Obtener las fotos cargadas para cada semana
    const weeksWithPhotos = courseData.weeks.map(week => {
      const photos = getPhotosForWeek(courseId, week.num);
      return {
        ...week,
        photos: photos
      };
    });

    res.render('admin-curso', { 
      courseName: courseData.courseName,
      courseId: courseId,
      weeks: weeksWithPhotos
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error de servidor');
  }
});

// Subida de archivos
app.post('/admin/upload', requireLogin, (req, res) => {
  upload.array('photos', 10)(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).send('Error de Multer: ' + err.message);
    } else if (err) {
      return res.status(400).send('Error: ' + err.message);
    }
    
    const courseId = req.body.course;
    res.redirect(`/admin/curso/${courseId}?success=upload`);
  });
});

// Eliminación de fotos
app.post('/admin/delete-photo', requireLogin, (req, res) => {
  const { photoPath, courseId } = req.body;
  
  if (!photoPath) {
    return res.status(400).send('Ruta de foto no proporcionada');
  }

  // Asegurarse de que el path de la foto está dentro del directorio permitido
  const safePath = VOLUME_MOUNT
    ? path.join(UPLOADS_BASE, photoPath.replace(/^\/uploads\//, ''))
    : path.join(__dirname, 'public', photoPath);
  const allowedBase = VOLUME_MOUNT ? UPLOADS_BASE : path.join(__dirname, 'public', 'uploads');
  
  if (safePath.startsWith(allowedBase)) {
    if (fs.existsSync(safePath)) {
      try {
        fs.unlinkSync(safePath);
        res.redirect(`/admin/curso/${courseId}?success=delete`);
      } catch (error) {
        console.error(error);
        res.status(500).send('Error al eliminar el archivo');
      }
    } else {
      res.status(404).send('La foto no existe');
    }
  } else {
    res.status(403).send('Acceso no autorizado');
  }
});

// Iniciar el servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`Servidor iniciado con éxito.`);
  console.log(`Acceso local: http://localhost:${PORT}`);
  console.log(`Acceso celular: Conéctate al mismo WiFi y abre http://[TU_IP_LOCAL]:${PORT}`);
  console.log(`=========================================`);
});
