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
    }
};

module.exports = TurnoModel;
