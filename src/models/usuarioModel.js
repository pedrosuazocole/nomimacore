const db = require('../config/db');
const bcrypt = require('bcryptjs');

const UsuarioModel = {
    listar() {
        return db.prepare('SELECT id, username, nombre_completo, rol, activo, ultimo_acceso, created_at FROM usuarios ORDER BY nombre_completo').all();
    },

    obtener(id) {
        return db.prepare('SELECT id, username, nombre_completo, rol, activo FROM usuarios WHERE id = ?').get(id);
    },

    async crear({ username, password, nombre_completo, rol }) {
        const hash = await bcrypt.hash(password, 10);
        const info = db.prepare(`
            INSERT INTO usuarios (username, password_hash, nombre_completo, rol, activo)
            VALUES (?, ?, ?, ?, 1)
        `).run(username.trim().toLowerCase(), hash, nombre_completo, rol || 'OPERADOR');
        return this.obtener(info.lastInsertRowid);
    },

    async actualizar(id, { nombre_completo, rol, activo, password }) {
        if (password) {
            const hash = await bcrypt.hash(password, 10);
            db.prepare(`UPDATE usuarios SET nombre_completo=?, rol=?, activo=?, password_hash=?, updated_at=datetime('now','localtime') WHERE id=?`)
                .run(nombre_completo, rol, activo ? 1 : 0, hash, id);
        } else {
            db.prepare(`UPDATE usuarios SET nombre_completo=?, rol=?, activo=?, updated_at=datetime('now','localtime') WHERE id=?`)
                .run(nombre_completo, rol, activo ? 1 : 0, id);
        }
        return this.obtener(id);
    },

    existeUsername(username) {
        return !!db.prepare('SELECT id FROM usuarios WHERE username = ?').get(username.trim().toLowerCase());
    }
};

module.exports = UsuarioModel;
