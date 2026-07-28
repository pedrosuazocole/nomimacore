const path = require('path');
const fs = require('fs');
const EmpleadoModel = require('../models/empleadoModel');
const TurnoModel = require('../models/turnoModel');
const { DIAS_SEMANA } = require('../config/constants');
const { generarPlantilla, procesarImportacion } = require('../services/turnoImportService');
const { carpetaAsistencia } = require('../config/uploads');

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
    },

    /**
     * Genera y descarga el archivo .xlsx de plantilla para carga masiva de horarios.
     */
    descargarPlantilla(req, res) {
        const buffer = generarPlantilla();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="plantilla-horarios-nominacore.xlsx"');
        res.send(buffer);
    },

    importarForm(req, res) {
        res.render('turnos/importar', { title: 'Importar Horarios', resultado: null, errorGeneral: null });
    },

    importar(req, res) {
        if (!req.file) {
            return res.status(400).render('turnos/importar', {
                title: 'Importar Horarios',
                resultado: null,
                errorGeneral: 'Debes seleccionar un archivo .xlsx o .xls antes de continuar.'
            });
        }

        const resultado = procesarImportacion(req.file.buffer);

        res.render('turnos/importar', {
            title: 'Importar Horarios',
            resultado: resultado.ok ? resultado.resultados : null,
            errorGeneral: resultado.ok ? null : resultado.errorGeneral
        });
    },

    // Sirve una foto de evidencia del Reloj de Asistencia. Protegida por
    // requireAuth (ver routes/turnos.js) — a diferencia de /reloj, esta
    // NO es publica, porque son fotos de empleados reales.
    verFoto(req, res) {
        const nombreArchivo = req.params.archivo;
        // Evita path traversal (ej. "../../.env"): solo se permite el
        // nombre de archivo tal cual, sin separadores de carpeta.
        if (!nombreArchivo || nombreArchivo.includes('/') || nombreArchivo.includes('..')) {
            return res.status(400).send('Nombre de archivo invalido.');
        }
        const ruta = path.join(carpetaAsistencia(), nombreArchivo);
        if (!fs.existsSync(ruta)) return res.status(404).send('Foto no encontrada.');
        res.sendFile(ruta);
    }
};

module.exports = TurnoController;
