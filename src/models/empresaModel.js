const db = require('../config/db');

const EmpresaModel = {
    listar({ estado } = {}) {
        let sql = 'SELECT * FROM empresas WHERE 1=1';
        const params = [];
        if (estado) { sql += ' AND estado = ?'; params.push(estado); }
        sql += ' ORDER BY nombre ASC';
        return db.prepare(sql).all(...params);
    },

    obtener(id) {
        return db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
    },

    crear(data) {
        const info = db.prepare(`
            INSERT INTO empresas (nombre, rtn, direccion, telefono, estado)
            VALUES (@nombre, @rtn, @direccion, @telefono, @estado)
        `).run(normalize(data));
        return this.obtener(info.lastInsertRowid);
    },

    actualizar(id, data) {
        const nombreAnterior = this.obtener(id)?.nombre;
        db.prepare(`
            UPDATE empresas SET
                nombre = @nombre, rtn = @rtn, direccion = @direccion,
                telefono = @telefono, estado = @estado,
                updated_at = datetime('now','localtime')
            WHERE id = @id
        `).run({ ...normalize(data), id });

        // Si el nombre cambio, se propaga a los campos de texto que se
        // mantienen sincronizados en empleados/planillas (para que los
        // reportes existentes, que todavia leen el texto, no queden
        // desactualizados).
        const nuevoNombre = normalize(data).nombre;
        if (nombreAnterior && nombreAnterior !== nuevoNombre) {
            db.prepare('UPDATE empleados SET empresa = ? WHERE empresa_id = ?').run(nuevoNombre, id);
            db.prepare('UPDATE planillas SET empresa = ? WHERE empresa_id = ?').run(nuevoNombre, id);
        }

        return this.obtener(id);
    },

    darDeBaja(id) {
        db.prepare(`UPDATE empresas SET estado = 'INACTIVA', updated_at = datetime('now','localtime') WHERE id = ?`).run(id);
    },

    contarEmpleados(id) {
        return db.prepare('SELECT COUNT(*) c FROM empleados WHERE empresa_id = ? AND estado = ?').get(id, 'ACTIVO').c;
    }
};

function normalize(data) {
    return {
        nombre: (data.nombre || '').trim(),
        rtn: data.rtn || null,
        direccion: data.direccion || null,
        telefono: data.telefono || null,
        estado: data.estado || 'ACTIVA'
    };
}

module.exports = EmpresaModel;
