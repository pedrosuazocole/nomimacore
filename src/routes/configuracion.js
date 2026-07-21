const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { migrarColumnasFaltantes } = require('../database/migrate-columns');

router.get('/', (req, res) => {
    const cfg = db.prepare('SELECT * FROM configuracion WHERE id = 1').get();
    res.render('configuracion', { title: 'Configuracion', cfg, ok: req.query.ok });
});

router.post('/', (req, res) => {
    const b = req.body;
    try {
        db.prepare(`
            UPDATE configuracion SET
                empresa_nombre = ?, empresa_rtn = ?,
                horas_jornada_diurna = ?, horas_jornada_nocturna = ?, horas_jornada_mixta = ?,
                recargo_25 = ?, recargo_50 = ?, recargo_75 = ?, recargo_100 = ?,
                ihss_porcentaje_empleado = ?, ihss_techo_salarial = ?,
                rap_porcentaje_empleado = ?, rap_techo_salarial = ?,
                dias_mes_planilla = ?, whatsapp_contacto = ?,
                vista_previa_impresion_default = ?,
                cuenta_salario_ordinario = ?, cuenta_salario_extraordinario = ?, cuenta_transporte = ?,
                cuenta_ihss = ?, cuenta_rap = ?, cuenta_impuesto_vecinal = ?, cuenta_isr = ?, cuenta_banco = ?,
                updated_at = datetime('now','localtime')
            WHERE id = 1
        `).run(
            b.empresa_nombre, b.empresa_rtn,
            Number(b.horas_jornada_diurna), Number(b.horas_jornada_nocturna), Number(b.horas_jornada_mixta),
            Number(b.recargo_25), Number(b.recargo_50), Number(b.recargo_75), Number(b.recargo_100),
            Number(b.ihss_porcentaje_empleado), Number(b.ihss_techo_salarial),
            Number(b.rap_porcentaje_empleado), Number(b.rap_techo_salarial),
            Number(b.dias_mes_planilla), b.whatsapp_contacto,
            b.vista_previa_impresion_default ? 1 : 0,
            b.cuenta_salario_ordinario, b.cuenta_salario_extraordinario, b.cuenta_transporte,
            b.cuenta_ihss, b.cuenta_rap, b.cuenta_impuesto_vecinal, b.cuenta_isr, b.cuenta_banco
        );
        res.redirect('/configuracion?ok=Configuracion guardada correctamente');
    } catch (err) {
        // Si la BD todavia no tiene alguna columna nueva (ej. porque el
        // servidor no se ha reiniciado desde el ultimo deploy), se
        // intenta migrar sobre la marcha UNA vez y reintentar, en vez
        // de mostrar un error generico y dejar al usuario sin saber
        // que paso.
        if (err.message && err.message.startsWith('no such column')) {
            console.log('⚠️ Columna faltante detectada al guardar Configuracion, migrando y reintentando:', err.message);
            migrarColumnasFaltantes(db);
            return res.redirect('/configuracion?ok=Se detecto una actualizacion pendiente y se aplico automaticamente. Por favor guarda de nuevo.');
        }
        throw err;
    }
});

module.exports = router;
