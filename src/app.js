const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');

const empleadosRouter = require('./routes/empleados');
const turnosRouter = require('./routes/turnos');
const planillasRouter = require('./routes/planillas');
const configuracionRouter = require('./routes/configuracion');
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

// Inyecta datos de configuracion globales (nombre empresa, whatsapp, etc.)
// disponibles en todas las vistas sin tener que pasarlos manualmente.
app.use((req, res, next) => {
    res.locals.appConfig = db.prepare('SELECT * FROM configuracion WHERE id = 1').get() || {};
    res.locals.currentPath = req.path;
    next();
});

// ---- Rutas ----
app.get('/', (req, res) => res.redirect('/planillas'));
app.use('/empleados', empleadosRouter);
app.use('/turnos', turnosRouter);
app.use('/planillas', planillasRouter);
app.use('/configuracion', configuracionRouter);

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
