const EmpresaModel = require('../models/empresaModel');

const EmpresaController = {
    index(req, res) {
        const empresas = EmpresaModel.listar();
        const empresasConConteo = empresas.map(emp => ({
            ...emp,
            totalEmpleados: EmpresaModel.contarEmpleados(emp.id)
        }));
        res.render('empresas/index', { title: 'Empresas', empresas: empresasConConteo, ok: req.query.ok });
    },

    nuevoForm(req, res) {
        res.render('empresas/form', { title: 'Nueva Empresa', empresa: {}, errores: [] });
    },

    crear(req, res) {
        try {
            validar(req.body);
            const empresa = EmpresaModel.crear(req.body);
            res.redirect(`/empresas?ok=Empresa ${empresa.nombre} creada correctamente`);
        } catch (err) {
            res.status(400).render('empresas/form', { title: 'Nueva Empresa', empresa: req.body, errores: [err.message] });
        }
    },

    editarForm(req, res) {
        const empresa = EmpresaModel.obtener(req.params.id);
        if (!empresa) return res.status(404).send('Empresa no encontrada');
        res.render('empresas/form', { title: 'Editar Empresa', empresa, errores: [] });
    },

    actualizar(req, res) {
        try {
            validar(req.body);
            const empresa = EmpresaModel.actualizar(req.params.id, req.body);
            res.redirect(`/empresas?ok=Empresa ${empresa.nombre} actualizada`);
        } catch (err) {
            res.status(400).render('empresas/form', {
                title: 'Editar Empresa',
                empresa: { ...req.body, id: req.params.id },
                errores: [err.message]
            });
        }
    },

    darDeBaja(req, res) {
        EmpresaModel.darDeBaja(req.params.id);
        res.redirect('/empresas?ok=Empresa dada de baja');
    }
};

function validar(data) {
    if (!data.nombre || data.nombre.trim().length < 2) {
        throw new Error('El nombre de la empresa es obligatorio (minimo 2 caracteres).');
    }
}

module.exports = EmpresaController;
