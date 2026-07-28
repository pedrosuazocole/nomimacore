const db = require('../config/db');

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;

/**
 * Verifica si el usuario puede intentar iniciar sesion (no esta
 * bloqueado por exceso de intentos fallidos).
 */
function checkLoginAttempts(username) {
    const user = db.prepare('SELECT bloqueado_hasta FROM usuarios WHERE username = ?').get(username);
    if (!user || !user.bloqueado_hasta) return { allowed: true };

    const bloqueadoHasta = new Date(user.bloqueado_hasta);
    if (bloqueadoHasta > new Date()) {
        const minutosRestantes = Math.ceil((bloqueadoHasta - new Date()) / 60000);
        return {
            allowed: false,
            message: `Cuenta bloqueada temporalmente por demasiados intentos fallidos. Intenta de nuevo en ${minutosRestantes} minuto(s).`
        };
    }
    return { allowed: true };
}

/**
 * Registra un intento fallido de login. Si se alcanza el limite,
 * bloquea la cuenta temporalmente (protege contra fuerza bruta).
 */
function registerFailedLogin(username) {
    const user = db.prepare('SELECT id, intentos_fallidos FROM usuarios WHERE username = ?').get(username);
    if (!user) return { blocked: false };

    const intentos = (user.intentos_fallidos || 0) + 1;

    if (intentos >= MAX_INTENTOS) {
        const bloqueadoHasta = new Date(Date.now() + MINUTOS_BLOQUEO * 60000);
        db.prepare(`UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
            .run(intentos, bloqueadoHasta.toISOString(), user.id);
        return { blocked: true, minutes: MINUTOS_BLOQUEO };
    }

    db.prepare(`UPDATE usuarios SET intentos_fallidos = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(intentos, user.id);
    return { blocked: false, intentosRestantes: MAX_INTENTOS - intentos };
}

function resetLoginAttempts(username) {
    db.prepare(`UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = datetime('now','localtime') WHERE username = ?`).run(username);
}

/**
 * Exige sesion activa. Si no hay usuario logueado, redirige a /login
 * (o responde 401 JSON si la peticion espera JSON, ej. fetch de turnos).
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) return next();
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ ok: false, error: 'Sesion expirada, inicia sesion de nuevo.' });
    }
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

/**
 * Exige un rol especifico (ej. solo ADMIN puede entrar a Usuarios o
 * cambiar Configuracion sensible).
 */
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.session || !req.session.userId) return res.redirect('/login');
        if (!roles.includes(req.session.rol)) {
            return res.status(403).render('error', {
                title: 'Acceso denegado',
                mensaje: 'No tienes permisos para acceder a esta seccion.'
            });
        }
        next();
    };
}

module.exports = { checkLoginAttempts, registerFailedLogin, resetLoginAttempts, requireAuth, requireRole, MAX_INTENTOS };
