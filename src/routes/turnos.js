const express = require('express');
const multer = require('multer');
const router = express.Router();
const ctrl = require('../controllers/turnoController');

// Subida en memoria (no se escribe a disco): archivos pequeños (plantillas
// de horarios), maximo 5MB, solo .xlsx/.xls. Mismo patron que Empleados.
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

// IMPORTANTE: estas rutas van ANTES de "/" generica para no chocar con
// la matriz principal.
router.get('/plantilla', ctrl.descargarPlantilla);
router.get('/importar', ctrl.importarForm);
router.post('/importar', (req, res, next) => {
    upload.single('archivo')(req, res, (err) => {
        if (err) {
            return res.status(400).render('turnos/importar', {
                title: 'Importar Horarios',
                resultado: null,
                errorGeneral: err.message
            });
        }
        next();
    });
}, ctrl.importar);

router.get('/', ctrl.matriz);
router.post('/dia', ctrl.guardarDia);
router.get('/foto/:archivo', ctrl.verFoto);

module.exports = router;
