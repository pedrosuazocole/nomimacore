const UsuarioModel = require('../models/usuarioModel');

const UsuarioController = {
    index(req, res) {
        const usuarios = UsuarioModel.listar();
        res.render('usuarios/index', { title: 'Usuarios', usuarios });
    },

    nuevoForm(req, res) {
        res.render('usuarios/form', { title: 'Nuevo Usuario', usuario: {}, errores: [] });
    },

    async crear(req, res) {
        try {
            const { username, password, nombre_completo, rol } = req.body;
            if (!username || !password || !nombre_completo) throw new Error('Todos los campos son obligatorios.');
            if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
            if (UsuarioModel.existeUsername(username)) throw new Error('Ese usuario ya existe.');

            await UsuarioModel.crear({ username, password, nombre_completo, rol });
            res.redirect('/usuarios?ok=Usuario creado correctamente');
        } catch (err) {
            res.status(400).render('usuarios/form', { title: 'Nuevo Usuario', usuario: req.body, errores: [err.message] });
        }
    },

    editarForm(req, res) {
        const usuario = UsuarioModel.obtener(req.params.id);
        if (!usuario) return res.status(404).send('Usuario no encontrado');
        res.render('usuarios/form', { title: 'Editar Usuario', usuario, errores: [] });
    },

    async actualizar(req, res) {
        try {
            const { nombre_completo, rol, activo, password } = req.body;
            if (password && password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
            await UsuarioModel.actualizar(req.params.id, { nombre_completo, rol, activo: activo === '1', password });
            res.redirect('/usuarios?ok=Usuario actualizado');
        } catch (err) {
            res.status(400).render('usuarios/form', {
                title: 'Editar Usuario',
                usuario: { ...req.body, id: req.params.id },
                errores: [err.message]
            });
        }
    }
};

module.exports = UsuarioController;
