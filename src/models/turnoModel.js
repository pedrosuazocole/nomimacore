const db = require('../config/db');
const { calcularHorasTrabajadas } = require('../services/calculoService');

const TurnoModel = {
    // Matriz semanal: todos los turnos de todos los empleados activos
    // entre fecha_inicio y fecha_fin (para la vista de calendario).
    matrizSemana(fechaInicio, fechaFin) {
        return db.prepare(`
            SELECT t.*, e.nombre_completo, e.departamento, e.tipo_jornada
            FROM turnos_horarios t
            JOIN empleados e ON e.id = t.empleado_id
            WHERE t.fecha BETWEEN ? AND ?
            ORDER BY e.nombre_completo, t.fecha
        `).all(fechaInicio, fechaFin);
    },

    porEmpleadoYRango(empleadoId, fechaInicio, fechaFin) {
        return db.prepare(`
            SELECT * FROM turnos_horarios
            WHERE empleado_id = ? AND fecha BETWEEN ? AND ?
            ORDER BY fecha
        `).all(empleadoId, fechaInicio, fechaFin);
    },

    // Crea o actualiza el turno de un dia especifico (upsert por
    // empleado+fecha), recalculando horas trabajadas automaticamente.
    guardarDia(data) {
        const horas = data.es_dia_libre
            ? 0
            : calcularHorasTrabajadas(data.hora_entrada_real || data.hora_entrada_programada, data.hora_salida_real || data.hora_salida_programada);

        const stmt = db.prepare(`
            INSERT INTO turnos_horarios
                (empleado_id, fecha, dia_semana, hora_entrada_programada, hora_salida_programada,
                 hora_entrada_real, hora_salida_real, horas_trabajadas, tipo_turno, es_dia_libre, observaciones)
            VALUES
                (@empleado_id, @fecha, @dia_semana, @hora_entrada_programada, @hora_salida_programada,
                 @hora_entrada_real, @hora_salida_real, @horas_trabajadas, @tipo_turno, @es_dia_libre, @observaciones)
            ON CONFLICT(empleado_id, fecha) DO UPDATE SET
                dia_semana = excluded.dia_semana,
                hora_entrada_programada = excluded.hora_entrada_programada,
                hora_salida_programada = excluded.hora_salida_programada,
                hora_entrada_real = excluded.hora_entrada_real,
                hora_salida_real = excluded.hora_salida_real,
                horas_trabajadas = excluded.horas_trabajadas,
                tipo_turno = excluded.tipo_turno,
                es_dia_libre = excluded.es_dia_libre,
                observaciones = excluded.observaciones,
                updated_at = datetime('now','localtime')
        `);

        stmt.run({
            empleado_id: data.empleado_id,
            fecha: data.fecha,
            dia_semana: data.dia_semana || null,
            hora_entrada_programada: data.hora_entrada_programada || null,
            hora_salida_programada: data.hora_salida_programada || null,
            hora_entrada_real: data.hora_entrada_real || null,
            hora_salida_real: data.hora_salida_real || null,
            horas_trabajadas: horas,
            tipo_turno: data.tipo_turno || 'DIARIO',
            es_dia_libre: data.es_dia_libre ? 1 : 0,
            observaciones: data.observaciones || null
        });

        return db.prepare('SELECT * FROM turnos_horarios WHERE empleado_id = ? AND fecha = ?').get(data.empleado_id, data.fecha);
    },

    totalHorasSemana(empleadoId, fechaInicio, fechaFin) {
        const row = db.prepare(`
            SELECT COALESCE(SUM(horas_trabajadas), 0) AS total
            FROM turnos_horarios
            WHERE empleado_id = ? AND fecha BETWEEN ? AND ?
        `).get(empleadoId, fechaInicio, fechaFin);
        return row.total;
    },

    diasTrabajados(empleadoId, fechaInicio, fechaFin) {
        const row = db.prepare(`
            SELECT COUNT(*) AS dias
            FROM turnos_horarios
            WHERE empleado_id = ? AND fecha BETWEEN ? AND ? AND es_dia_libre = 0 AND horas_trabajadas > 0
        `).get(empleadoId, fechaInicio, fechaFin);
        return row.dias;
    },

    // =====================================================================
    // RELOJ DE ASISTENCIA
    // Reutiliza la misma tabla turnos_horarios (hora_entrada_real,
    // hora_salida_real) — por eso lo que se marca aqui aparece automatico
    // en la matriz de Horarios y al Procesar Planilla, sin capturar nada
    // dos veces. La hora SIEMPRE se toma del reloj del servidor (zona
    // Honduras, UTC-6 fijo, sin horario de verano), nunca del dispositivo
    // del empleado, para que no se pueda adelantar/atrasar la marca.
    // =====================================================================

    obtenerHoy(empleadoId) {
        const fecha = fechaHondurasHoy();
        return db.prepare('SELECT * FROM turnos_horarios WHERE empleado_id = ? AND fecha = ?').get(empleadoId, fecha);
    },

    marcarEntrada(empleadoId) {
        const fecha = fechaHondurasHoy();
        const hora = horaHondurasAhora();
        const existente = db.prepare('SELECT * FROM turnos_horarios WHERE empleado_id = ? AND fecha = ?').get(empleadoId, fecha);

        if (existente && existente.hora_entrada_real) {
            return { ok: false, mensaje: `Ya marcaste entrada hoy a las ${existente.hora_entrada_real}.`, turno: existente };
        }

        db.prepare(`
            INSERT INTO turnos_horarios (empleado_id, fecha, hora_entrada_real, tipo_turno, es_dia_libre)
            VALUES (?, ?, ?, 'DIARIO', 0)
            ON CONFLICT(empleado_id, fecha) DO UPDATE SET
                hora_entrada_real = excluded.hora_entrada_real,
                es_dia_libre = 0,
                updated_at = datetime('now','localtime')
        `).run(empleadoId, fecha, hora);

        const turno = db.prepare('SELECT * FROM turnos_horarios WHERE empleado_id = ? AND fecha = ?').get(empleadoId, fecha);
        return { ok: true, mensaje: `Entrada marcada a las ${hora}.`, turno };
    },

    marcarSalida(empleadoId) {
        const fecha = fechaHondurasHoy();
        const hora = horaHondurasAhora();
        const existente = db.prepare('SELECT * FROM turnos_horarios WHERE empleado_id = ? AND fecha = ?').get(empleadoId, fecha);

        if (!existente || !existente.hora_entrada_real) {
            return { ok: false, mensaje: 'Primero debes marcar tu entrada de hoy.', turno: existente || null };
        }
        if (existente.hora_salida_real) {
            return { ok: false, mensaje: `Ya marcaste salida hoy a las ${existente.hora_salida_real}.`, turno: existente };
        }

        const horas = calcularHorasTrabajadas(existente.hora_entrada_real, hora);

        db.prepare(`
            UPDATE turnos_horarios SET
                hora_salida_real = ?, horas_trabajadas = ?, updated_at = datetime('now','localtime')
            WHERE empleado_id = ? AND fecha = ?
        `).run(hora, horas, empleadoId, fecha);

        const turno = db.prepare('SELECT * FROM turnos_horarios WHERE empleado_id = ? AND fecha = ?').get(empleadoId, fecha);
        return { ok: true, mensaje: `Salida marcada a las ${hora}. Trabajaste ${horas} h hoy.`, turno };
    },

    // El empleado (o el staff) declara cual de los 3 turnos de tienda le
    // toca HOY. Se guarda en hora_entrada_programada/hora_salida_programada
    // (el turno "planeado"), sin tocar hora_entrada_real/hora_salida_real
    // (que siguen siendo el marcaje honesto del reloj). Asi se puede
    // comparar despues turno asignado vs. hora real de llegada.
    asignarTurnoHoy(empleadoId, horaInicio, horaFin) {
        const fecha = fechaHondurasHoy();
        db.prepare(`
            INSERT INTO turnos_horarios (empleado_id, fecha, hora_entrada_programada, hora_salida_programada, tipo_turno, es_dia_libre)
            VALUES (?, ?, ?, ?, 'DIARIO', 0)
            ON CONFLICT(empleado_id, fecha) DO UPDATE SET
                hora_entrada_programada = excluded.hora_entrada_programada,
                hora_salida_programada = excluded.hora_salida_programada,
                updated_at = datetime('now','localtime')
        `).run(empleadoId, fecha, horaInicio, horaFin);

        return db.prepare('SELECT * FROM turnos_horarios WHERE empleado_id = ? AND fecha = ?').get(empleadoId, fecha);
    }
};

// Honduras esta siempre en UTC-6 (no usa horario de verano), asi que un
// desfase fijo es seguro sin importar en que zona horaria corra el
// servidor (ej. Railway suele correr en UTC).
function ahoraHonduras() {
    const ahoraUTC = new Date();
    return new Date(ahoraUTC.getTime() - 6 * 60 * 60 * 1000);
}
function fechaHondurasHoy() {
    return ahoraHonduras().toISOString().slice(0, 10);
}
function horaHondurasAhora() {
    return ahoraHonduras().toISOString().slice(11, 16);
}

module.exports = TurnoModel;
