const EmpleadoModel = require('../models/empleadoModel');
const TurnoModel = require('../models/turnoModel');

const RelojController = {
    index(req, res) {
        const empleados = EmpleadoModel.listar({ estado: 'ACTIVO' });

        // Estado de hoy por cada empleado, para mostrar si ya marco
        // entrada/salida sin que tenga que adivinar.
        const empleadosConEstado = empleados.map(emp => {
            const hoy = TurnoModel.obtenerHoy(emp.id);
            return {
                ...emp,
                yaMarcoEntrada: !!(hoy && hoy.hora_entrada_real),
                yaMarcoSalida: !!(hoy && hoy.hora_salida_real),
                horaEntrada: hoy ? hoy.hora_entrada_real : null,
                horaSalida: hoy ? hoy.hora_salida_real : null,
                horasHoy: hoy ? hoy.horas_trabajadas : null
            };
        });

        res.render('reloj/index', {
            title: 'Reloj de Asistencia',
            layout: false,
            empleados: empleadosConEstado
        });
    },

    marcar(req, res) {
        const { empleado_id, tipo } = req.body;
        const empleado = EmpleadoModel.obtener(empleado_id);

        if (!empleado || empleado.estado !== 'ACTIVO') {
            return res.status(404).json({ ok: false, mensaje: 'Empleado no encontrado o inactivo.' });
        }

        const resultado = tipo === 'salida'
            ? TurnoModel.marcarSalida(empleado_id)
            : TurnoModel.marcarEntrada(empleado_id);

        res.json(resultado);
    }
};

module.exports = RelojController;
