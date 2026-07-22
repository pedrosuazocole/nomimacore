const db = require('../config/db');

const EmpleadoModel = {
    listar({ estado, departamento, empresa_id, q } = {}) {
        let sql = 'SELECT * FROM empleados WHERE 1=1';
        const params = [];
        if (estado) { sql += ' AND estado = ?'; params.push(estado); }
        if (departamento) { sql += ' AND departamento = ?'; params.push(departamento); }
        if (empresa_id) { sql += ' AND empresa_id = ?'; params.push(empresa_id); }
        if (q) { sql += ' AND (nombre_completo LIKE ? OR codigo_contable LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
        sql += ' ORDER BY nombre_completo ASC';
        return db.prepare(sql).all(...params);
    },

    obtener(id) {
        return db.prepare('SELECT * FROM empleados WHERE id = ?').get(id);
    },

    crear(data) {
        const stmt = db.prepare(`
            INSERT INTO empleados
            (codigo_contable, nombre_completo, departamento, cargo, empresa_id, empresa, cuenta_contable,
             salario_base, tipo_pago, tipo_jornada, fecha_ingreso, estado)
            VALUES (@codigo_contable, @nombre_completo, @departamento, @cargo, @empresa_id, @empresa, @cuenta_contable,
                    @salario_base, @tipo_pago, @tipo_jornada, @fecha_ingreso, @estado)
        `);
        const info = stmt.run(normalize(data));
        return this.obtener(info.lastInsertRowid);
    },

    actualizar(id, data) {
        const stmt = db.prepare(`
            UPDATE empleados SET
                codigo_contable = @codigo_contable,
                nombre_completo = @nombre_completo,
                departamento = @departamento,
                cargo = @cargo,
                empresa_id = @empresa_id,
                empresa = @empresa,
                cuenta_contable = @cuenta_contable,
                salario_base = @salario_base,
                tipo_pago = @tipo_pago,
                tipo_jornada = @tipo_jornada,
                fecha_ingreso = @fecha_ingreso,
                estado = @estado,
                updated_at = datetime('now','localtime')
            WHERE id = @id
        `);
        stmt.run({ ...normalize(data), id });
        return this.obtener(id);
    },

    eliminar(id) {
        // Baja logica en vez de borrado fisico: preserva historial de planillas.
        db.prepare(`UPDATE empleados SET estado = 'INACTIVO', updated_at = datetime('now','localtime') WHERE id = ?`).run(id);
    },

    departamentos() {
        return db.prepare('SELECT DISTINCT departamento FROM empleados ORDER BY departamento').all().map(r => r.departamento);
    }
};

function normalize(data) {
    // El campo de texto "empresa" se mantiene sincronizado automaticamente
    // con el nombre real de la empresa elegida (empresa_id) — asi los
    // reportes que todavia filtran por el texto siguen funcionando sin
    // tener que tocarlos, mientras el modulo de Empresas es la fuente de
    // verdad real de aqui en adelante.
    const empresaId = data.empresa_id ? Number(data.empresa_id) : null;
    let nombreEmpresa = '';
    if (empresaId) {
        const empresa = db.prepare('SELECT nombre FROM empresas WHERE id = ?').get(empresaId);
        nombreEmpresa = empresa ? empresa.nombre : '';
    }

    return {
        codigo_contable: data.codigo_contable || null,
        nombre_completo: data.nombre_completo,
        departamento: data.departamento || 'General',
        cargo: data.cargo || null,
        empresa_id: empresaId,
        empresa: nombreEmpresa,
        cuenta_contable: data.cuenta_contable || null,
        salario_base: Number(data.salario_base) || 0,
        tipo_pago: data.tipo_pago || 'MENSUAL',
        tipo_jornada: data.tipo_jornada || 'DIURNA',
        fecha_ingreso: data.fecha_ingreso || null,
        estado: data.estado || 'ACTIVO'
    };
}

module.exports = EmpleadoModel;
