const EmpleadoModel = require('../models/empleadoModel');
const { generarPlantilla, procesarImportacion } = require('../services/empleadoImportService');

const EmpleadoController = {
    index(req, res) {
        const { estado, departamento, q } = req.query;
        const empleados = EmpleadoModel.listar({ estado, departamento, q });
        const departamentos = EmpleadoModel.departamentos();
        res.render('empleados/index', {
            title: 'Empleados',
            empleados,
            departamentos,
            filtros: { estado, departamento, q }
        });
    },

    nuevoForm(req, res) {
        res.render('empleados/form', { title: 'Nuevo Empleado', empleado: {}, errores: [] });
    },

    async crear(req, res) {
        try {
            validar(req.body);
            const empleado = EmpleadoModel.crear(req.body);
            res.redirect(`/empleados?ok=Empleado ${empleado.nombre_completo} creado correctamente`);
        } catch (err) {
            res.status(400).render('empleados/form', {
                title: 'Nuevo Empleado',
                empleado: req.body,
                errores: [err.message]
            });
        }
    },

    editarForm(req, res) {
        const empleado = EmpleadoModel.obtener(req.params.id);
        if (!empleado) return res.status(404).send('Empleado no encontrado');
        res.render('empleados/form', { title: 'Editar Empleado', empleado, errores: [] });
    },

    async actualizar(req, res) {
        try {
            validar(req.body);
            const empleado = EmpleadoModel.actualizar(req.params.id, req.body);
            res.redirect(`/empleados?ok=Empleado ${empleado.nombre_completo} actualizado`);
        } catch (err) {
            res.status(400).render('empleados/form', {
                title: 'Editar Empleado',
                empleado: { ...req.body, id: req.params.id },
                errores: [err.message]
            });
        }
    },

    eliminar(req, res) {
        EmpleadoModel.eliminar(req.params.id);
        res.redirect('/empleados?ok=Empleado dado de baja');
    },

    /**
     * Genera y descarga el archivo .xlsx de plantilla para carga masiva.
     */
    descargarPlantilla(req, res) {
        const buffer = generarPlantilla();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="plantilla-empleados-nominacore.xlsx"');
        res.send(buffer);
    },

    importarForm(req, res) {
        res.render('empleados/importar', { title: 'Importar Empleados', resultado: null, errorGeneral: null });
    },

    importar(req, res) {
        if (!req.file) {
            return res.status(400).render('empleados/importar', {
                title: 'Importar Empleados',
                resultado: null,
                errorGeneral: 'Debes seleccionar un archivo .xlsx o .xls antes de continuar.'
            });
        }

        const resultado = procesarImportacion(req.file.buffer);

        res.render('empleados/importar', {
            title: 'Importar Empleados',
            resultado: resultado.ok ? resultado.resultados : null,
            errorGeneral: resultado.ok ? null : resultado.errorGeneral
        });
    }
};

function validar(data) {
    if (!data.nombre_completo || data.nombre_completo.trim().length < 3) {
        throw new Error('El nombre completo es obligatorio (minimo 3 caracteres).');
    }
    if (data.salario_base === undefined || Number(data.salario_base) < 0) {
        throw new Error('El salario base debe ser un numero positivo.');
    }
}

module.exports = EmpleadoController;
