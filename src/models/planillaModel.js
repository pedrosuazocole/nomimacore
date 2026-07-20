const db = require('../config/db');

const PlanillaModel = {
    listar({ tipoPeriodo } = {}) {
        let sql = 'SELECT * FROM planillas WHERE 1=1';
        const params = [];
        if (tipoPeriodo) { sql += ' AND tipo_periodo = ?'; params.push(tipoPeriodo); }
        sql += ' ORDER BY fecha_inicio DESC';
        return db.prepare(sql).all(...params);
    },

    obtener(id) {
        return db.prepare('SELECT * FROM planillas WHERE id = ?').get(id);
    },

    crear({ nombre, empresa, tipoPeriodo, fechaInicio, fechaFin }) {
        const info = db.prepare(`
            INSERT INTO planillas (nombre, empresa, tipo_periodo, fecha_inicio, fecha_fin, estado)
            VALUES (?, ?, ?, ?, ?, 'BORRADOR')
        `).run(nombre, empresa || '', tipoPeriodo, fechaInicio, fechaFin);
        return this.obtener(info.lastInsertRowid);
    },

    actualizarTotales(planillaId) {
        const totales = db.prepare(`
            SELECT
                COALESCE(SUM(salario_total), 0) AS total_salarios,
                COALESCE(SUM(horas_extras_pago), 0) AS total_extras,
                COALESCE(SUM(total_deducciones), 0) AS total_deducciones,
                COALESCE(SUM(total_pagar), 0) AS total_pagar
            FROM planilla_detalle WHERE planilla_id = ?
        `).get(planillaId);

        db.prepare(`
            UPDATE planillas SET
                total_salarios = ?, total_extras = ?, total_deducciones = ?, total_pagar = ?,
                updated_at = datetime('now','localtime')
            WHERE id = ?
        `).run(totales.total_salarios, totales.total_extras, totales.total_deducciones, totales.total_pagar, planillaId);
    },

    cambiarEstado(id, estado) {
        db.prepare(`UPDATE planillas SET estado = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(estado, id);
    },

    // ---- Detalle ----
    upsertDetalle(planillaId, empleadoId, calc) {
        db.prepare(`
            INSERT INTO planilla_detalle (
                planilla_id, empleado_id, salario_mensual, salario_diario, dias_trabajados,
                septimo_dia_procede, salario_ordinario, septimo_dia_pago, salario_total,
                horas_extras_horas, horas_extras_pago, sal_mas_he, ihss, rap, subtotal_neto,
                prestamos, vales, impuesto_vecinal, isr, total_deducciones, total_pagar
            ) VALUES (
                @planilla_id, @empleado_id, @salario_mensual, @salario_diario, @dias_trabajados,
                @septimo_dia_procede, @salario_ordinario, @septimo_dia_pago, @salario_total,
                @horas_extras_horas, @horas_extras_pago, @sal_mas_he, @ihss, @rap, @subtotal_neto,
                @prestamos, @vales, @impuesto_vecinal, @isr, @total_deducciones, @total_pagar
            )
            ON CONFLICT(planilla_id, empleado_id) DO UPDATE SET
                salario_mensual = excluded.salario_mensual,
                salario_diario = excluded.salario_diario,
                dias_trabajados = excluded.dias_trabajados,
                septimo_dia_procede = excluded.septimo_dia_procede,
                salario_ordinario = excluded.salario_ordinario,
                septimo_dia_pago = excluded.septimo_dia_pago,
                salario_total = excluded.salario_total,
                horas_extras_horas = excluded.horas_extras_horas,
                horas_extras_pago = excluded.horas_extras_pago,
                sal_mas_he = excluded.sal_mas_he,
                ihss = excluded.ihss,
                rap = excluded.rap,
                subtotal_neto = excluded.subtotal_neto,
                prestamos = excluded.prestamos,
                vales = excluded.vales,
                impuesto_vecinal = excluded.impuesto_vecinal,
                isr = excluded.isr,
                total_deducciones = excluded.total_deducciones,
                total_pagar = excluded.total_pagar
        `).run({ planilla_id: planillaId, empleado_id: empleadoId, ...calc });
    },

    detalle(planillaId) {
        return db.prepare(`
            SELECT pd.*, e.nombre_completo, e.departamento, e.codigo_contable, e.cuenta_contable, e.empresa
            FROM planilla_detalle pd
            JOIN empleados e ON e.id = pd.empleado_id
            WHERE pd.planilla_id = ?
            ORDER BY e.nombre_completo
        `).all(planillaId);
    },

    detalleEmpleado(planillaId, empleadoId) {
        return db.prepare('SELECT * FROM planilla_detalle WHERE planilla_id = ? AND empleado_id = ?').get(planillaId, empleadoId);
    },

    // Guarda el desglose de horas extra por franja horaria (25/50/75/100%)
    // de la semana que cubre la planilla. Separado de planilla_detalle
    // porque una planilla quincenal/mensual puede llegar a cubrir mas de
    // una semana calendario en el futuro; por ahora se guarda una fila
    // por planilla+empleado usando el rango completo de la planilla.
    upsertHorasExtraSemana(empleadoId, semanaInicio, semanaFin, tipoJornada, extras) {
        db.prepare(`
            INSERT INTO horas_extras_semanal (
                empleado_id, semana_inicio, semana_fin, horas_totales, tipo_jornada,
                horas_ordinarias, horas_extras_total,
                horas_bucket_25, horas_bucket_50, horas_bucket_75, horas_bucket_100,
                pago_bucket_25, pago_bucket_50, pago_bucket_75, pago_bucket_100,
                pago_total_extras, septimo_dia_procede
            ) VALUES (
                @empleado_id, @semana_inicio, @semana_fin, @horas_totales, @tipo_jornada,
                @horas_ordinarias, @horas_extras_total,
                @horas_bucket_25, @horas_bucket_50, @horas_bucket_75, @horas_bucket_100,
                @pago_bucket_25, @pago_bucket_50, @pago_bucket_75, @pago_bucket_100,
                @pago_total_extras, @septimo_dia_procede
            )
            ON CONFLICT(empleado_id, semana_inicio, semana_fin) DO UPDATE SET
                horas_totales = excluded.horas_totales,
                tipo_jornada = excluded.tipo_jornada,
                horas_ordinarias = excluded.horas_ordinarias,
                horas_extras_total = excluded.horas_extras_total,
                horas_bucket_25 = excluded.horas_bucket_25,
                horas_bucket_50 = excluded.horas_bucket_50,
                horas_bucket_75 = excluded.horas_bucket_75,
                horas_bucket_100 = excluded.horas_bucket_100,
                pago_bucket_25 = excluded.pago_bucket_25,
                pago_bucket_50 = excluded.pago_bucket_50,
                pago_bucket_75 = excluded.pago_bucket_75,
                pago_bucket_100 = excluded.pago_bucket_100,
                pago_total_extras = excluded.pago_total_extras,
                septimo_dia_procede = excluded.septimo_dia_procede
        `).run({
            empleado_id: empleadoId,
            semana_inicio: semanaInicio,
            semana_fin: semanaFin,
            tipo_jornada: tipoJornada,
            ...extras
        });
    },

    eliminarDetalle(planillaId, empleadoId) {
        db.prepare('DELETE FROM planilla_detalle WHERE planilla_id = ? AND empleado_id = ?').run(planillaId, empleadoId);
    },

    eliminar(id) {
        db.prepare('DELETE FROM planillas WHERE id = ?').run(id); // cascada borra el detalle
    }
};

module.exports = PlanillaModel;
