const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const session = require('express-session');

const authRouter = require('./routes/auth');
const usuariosRouter = require('./routes/usuarios');
const empleadosRouter = require('./routes/empleados');
const turnosRouter = require('./routes/turnos');
const planillasRouter = require('./routes/planillas');
const configuracionRouter = require('./routes/configuracion');
const { requireAuth } = require('./middlewares/auth');
const db = require('./config/db');

const app = express();

// ---- Vistas ----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'partials/layout');

// ---- Middlewares ----
app.use(bodyParser.urlencoded({ extended: true, limit: '2mb' }));
app.use(bodyParser.json({ limit: '2mb' }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Sesiones ----
// Se usa el MemoryStore por defecto de express-session: no requiere
// dependencias nativas adicionales (mas confiable en Railway) y es
// suficiente para una app de uso interno con una sola instancia.
// Costo aceptado: si el proceso se reinicia (redeploy), las sesiones
// activas se pierden y los usuarios deben iniciar sesion de nuevo.
app.use(session({
    secret: process.env.SESSION_SECRET || 'nominacore_dev_secret_cambia_esto',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 8 * 60 * 60 * 1000, // 8 horas
        secure: process.env.NODE_ENV === 'production' && process.env.APP_URL?.startsWith('https'),
        httpOnly: true
    }
}));

// Inyecta datos de configuracion y de sesion, disponibles en todas las
// vistas sin tener que pasarlos manualmente en cada render.
app.use((req, res, next) => {
    res.locals.appConfig = db.prepare('SELECT * FROM configuracion WHERE id = 1').get() || {};
    res.locals.currentPath = req.path;
    res.locals.usuarioActual = req.session && req.session.userId
        ? { nombre: req.session.nombreCompleto, rol: req.session.rol }
        : null;
    next();
});

// ---- Rutas publicas ----
app.use('/', authRouter);

// ---- Rutas protegidas (requieren sesion activa) ----
app.get('/', requireAuth, (req, res) => res.redirect('/planillas'));
app.use('/usuarios', requireAuth, usuariosRouter);
app.use('/empleados', requireAuth, empleadosRouter);
app.use('/turnos', requireAuth, turnosRouter);
app.use('/planillas', requireAuth, planillasRouter);
app.use('/configuracion', requireAuth, configuracionRouter);

// Endpoint de diagnostico (util para troubleshooting en Railway)
app.get('/api/diag', (req, res) => {
    try {
        const empleados = db.prepare('SELECT COUNT(*) c FROM empleados').get().c;
        const planillas = db.prepare('SELECT COUNT(*) c FROM planillas').get().c;
        res.json({
            ok: true,
            timestamp: new Date().toISOString(),
            db_path: process.env.DB_PATH || './data/nominacore.db',
            empleados_registrados: empleados,
            planillas_registradas: planillas
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ---- 404 ----
app.use((req, res) => {
    res.status(404).render('404', { title: 'No encontrado', layout: 'partials/layout' });
});

// ---- Manejador de errores central ----
app.use((err, req, res, next) => {
    console.error('💥 Error no controlado:', err);
    res.status(500).render('error', {
        title: 'Error',
        layout: 'partials/layout',
        mensaje: process.env.NODE_ENV === 'production' ? 'Ocurrio un error inesperado.' : err.message
    });
});

module.exports = app;
