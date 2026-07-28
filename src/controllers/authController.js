const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { checkLoginAttempts, registerFailedLogin, resetLoginAttempts } = require('../middlewares/auth');

const AuthController = {
    mostrarLogin(req, res) {
        if (req.session && req.session.userId) return res.redirect('/planillas');
        res.render('auth/login', { title: 'Iniciar Sesion', error: null, next: req.query.next || '/planillas', layout: false });
    },

    async procesarLogin(req, res) {
        const { username, password, next: siguiente } = req.body;
        const render = (error) => res.status(400).render('auth/login', { title: 'Iniciar Sesion', error, next: siguiente || '/planillas', layout: false });

        if (!username || !password) {
            return render('Por favor ingresa tu usuario y contraseña.');
        }

        const check = checkLoginAttempts(username);
        if (!check.allowed) return render(check.message);

        const user = db.prepare('SELECT * FROM usuarios WHERE username = ?').get(username);
        if (!user) {
            registerFailedLogin(username);
            return render('Usuario o contraseña incorrectos.');
        }
        if (!user.activo) {
            return render('Este usuario esta desactivado. Contacta al administrador.');
        }

        const passwordOk = await bcrypt.compare(password, user.password_hash);
        if (!passwordOk) {
            const result = registerFailedLogin(username);
            const msg = result.blocked
                ? `Demasiados intentos fallidos. Cuenta bloqueada por ${result.minutes} minutos.`
                : `Usuario o contraseña incorrectos. Te quedan ${result.intentosRestantes} intento(s).`;
            return render(msg);
        }

        resetLoginAttempts(username);

        req.session.userId = user.id;
        req.session.nombreCompleto = user.nombre_completo;
        req.session.rol = user.rol;

        res.redirect(siguiente && siguiente.startsWith('/') ? siguiente : '/planillas');
    },

    logout(req, res) {
        req.session.destroy(() => {
            res.redirect('/login');
        });
    }
};

module.exports = AuthController;
