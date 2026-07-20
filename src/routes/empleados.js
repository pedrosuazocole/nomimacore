const express = require('express');
const multer = require('multer');
const router = express.Router();
const ctrl = require('../controllers/empleadoController');

// Subida en memoria (no se escribe a disco): archivos pequeños (plantillas
// de empleados), maximo 5MB, solo .xlsx/.xls.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const extensionesValidas = /\.(xlsx|xls)$/i;
        if (!extensionesValidas.test(file.originalname)) {
            return cb(new Error('Solo se aceptan archivos .xlsx o .xls'));
        }
        cb(null, true);
    }
});

// IMPORTANTE: estas rutas van ANTES de "/:id/editar" para que Express
// no interprete "plantilla" o "importar" como un :id.
router.get('/plantilla', ctrl.descargarPlantilla);
router.get('/importar', ctrl.importarForm);
router.post('/importar', (req, res, next) => {
    upload.single('archivo')(req, res, (err) => {
        if (err) {
            return res.status(400).render('empleados/importar', {
                title: 'Importar Empleados',
                resultado: null,
                errorGeneral: err.message
            });
        }
        next();
    });
}, ctrl.importar);

router.get('/', ctrl.index);
router.get('/nuevo', ctrl.nuevoForm);
router.post('/', ctrl.crear);
router.get('/:id/editar', ctrl.editarForm);
router.put('/:id', ctrl.actualizar);
router.delete('/:id', ctrl.eliminar);

module.exports = router;
