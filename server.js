const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Asegurar que el directorio de uploads existe (Railway Volume mount)
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configuración de EJS y archivos estáticos
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
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
  return process.env.ADMIN_PASSWORD || 'admin';
}

// Middleware para proteger rutas de admin
function requireLogin(req, res, next) {
  if (req.session.loggedIn) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Configuración de Multer para subida dinámica
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const course = req.body.course || 'aritmetica';
    let weekNum = parseInt(req.body.week);
    if (isNaN(weekNum)) weekNum = 1;
    const weekFolder = 'semana' + String(weekNum).padStart(2, '0');
    
    const dir = path.join(__dirname, 'public', 'uploads', course, weekFolder);
    
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
  const dir = path.join(__dirname, 'public', 'uploads', course, weekFolder);
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

// === RUTAS PÚBLICAS ===

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
app.get('/login', (req, res) => {
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

  // Asegurarse de que el path de la foto está dentro del directorio public para seguridad
  const safePath = path.join(__dirname, 'public', photoPath);
  
  if (safePath.startsWith(path.join(__dirname, 'public', 'uploads'))) {
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
