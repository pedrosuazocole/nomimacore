const fs = require('fs');
const sharp = require('sharp');
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
                horasHoy: hoy ? hoy.horas_trabajadas : null,
                turnoInicio: hoy ? hoy.hora_entrada_programada : null,
                turnoFin: hoy ? hoy.hora_salida_programada : null
            };
        });

        res.render('reloj/index', {
            title: 'Reloj de Asistencia',
            layout: false,
            empleados: empleadosConEstado
        });
    },

    async marcar(req, res) {
        const { empleado_id, tipo } = req.body;
        const empleado = EmpleadoModel.obtener(empleado_id);

        if (!empleado || empleado.estado !== 'ACTIVO') {
            if (req.file) fs.unlink(req.file.path, () => {});
            return res.status(404).json({ ok: false, mensaje: 'Empleado no encontrado o inactivo.' });
        }

        // La foto es obligatoria: es la evidencia de la marca. Si no
        // llego el archivo (ej. el empleado nego el permiso de camara),
        // no se registra la marca.
        if (!req.file) {
            return res.status(400).json({ ok: false, mensaje: 'Debes tomar una foto para marcar tu asistencia.' });
        }

        // Optimizar la foto: las selfies de celular normalmente pesan
        // 2-6 MB a resolucion completa (innecesario para una foto de
        // evidencia). Se reduce a un ancho maximo de 480px y se
        // recomprime a JPEG calidad 72 — de varios MB a ~20-40 KB, sin
        // que se pierda la posibilidad de reconocer a la persona.
        // rotate() sin argumentos auto-orienta segun el EXIF de la
        // camara (muy comun que las fotos de celular vengan "acostadas"
        // si no se corrige esto).
        try {
            const bufferOptimizado = await sharp(req.file.path)
                .rotate()
                .resize({ width: 480, withoutEnlargement: true })
                .jpeg({ quality: 72 })
                .toBuffer();
            fs.writeFileSync(req.file.path, bufferOptimizado);
        } catch (err) {
            console.error('⚠️ No se pudo optimizar la foto de asistencia, se guarda tal cual:', err.message);
        }

        const nombreArchivo = req.file.filename;
        const resultado = tipo === 'salida'
            ? TurnoModel.marcarSalida(empleado_id, nombreArchivo)
            : TurnoModel.marcarEntrada(empleado_id, nombreArchivo);

        // Si el modelo rechazo la marca (ej. "ya marcaste"), la foto que
        // se acaba de subir no sirve para nada — se borra para no dejar
        // archivos huerfanos en el volumen.
        if (!resultado.ok) {
            fs.unlink(req.file.path, () => {});
        }

        res.json(resultado);
    },

    asignarTurno(req, res) {
        const { empleado_id, inicio, fin } = req.body;
        const empleado = EmpleadoModel.obtener(empleado_id);

        if (!empleado || empleado.estado !== 'ACTIVO') {
            return res.status(404).json({ ok: false, mensaje: 'Empleado no encontrado o inactivo.' });
        }
        if (!inicio || !fin) {
            return res.status(400).json({ ok: false, mensaje: 'Turno invalido.' });
        }

        const turno = TurnoModel.asignarTurnoHoy(empleado_id, inicio, fin);
        res.json({ ok: true, mensaje: `Turno de hoy asignado: ${inicio} a ${fin}.`, turno });
    }
};

module.exports = RelojController;
