const EmpleadoModel = require('../models/empleadoModel');
const TurnoModel = require('../models/turnoModel');
const { DIAS_SEMANA } = require('../config/constants');

function lunesDeLaSemana(fecha) {
    const d = new Date(fecha + 'T00:00:00');
    const dia = d.getDay(); // 0=domingo
    const diff = dia === 0 ? -6 : 1 - dia;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
}

function sumarDias(fechaISO, n) {
    const d = new Date(fechaISO + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}

const TurnoController = {
    matriz(req, res) {
        const base = req.query.semana || new Date().toISOString().slice(0, 10);
        const inicio = lunesDeLaSemana(base);
        const fin = sumarDias(inicio, 6);

        const empleados = EmpleadoModel.listar({ estado: 'ACTIVO' });
        const turnos = TurnoModel.matrizSemana(inicio, fin);

        // Indexar turnos por empleado+fecha para pintar la matriz facil
        const indice = {};
        for (const t of turnos) {
            indice[`${t.empleado_id}_${t.fecha}`] = t;
        }

        const dias = [];
        for (let i = 0; i < 7; i++) {
            const fecha = sumarDias(inicio, i);
            dias.push({ fecha, nombre: DIAS_SEMANA[i] });
        }

        res.render('turnos/index', {
            title: 'Programacion de Horarios',
            empleados,
            dias,
            indice,
            semanaInicio: inicio,
            semanaFin: fin,
            semanaAnterior: sumarDias(inicio, -7),
            semanaSiguiente: sumarDias(inicio, 7)
        });
    },

    guardarDia(req, res) {
        const turno = TurnoModel.guardarDia(req.body);
        res.json({ ok: true, turno });
    }
};

module.exports = TurnoController;
