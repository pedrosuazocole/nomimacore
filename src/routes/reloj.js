const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const ctrl = require('../controllers/relojController');
const { carpetaAsistencia } = require('../config/uploads');

// La foto de evidencia se guarda en disco (no en memoria) porque son
// archivos de imagen que pueden pesar unos MB — directo al volumen
// persistente, sin pasar por RAM innecesariamente.
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, carpetaAsistencia()),
        filename: (req, file, cb) => {
            const empleadoId = req.body.empleado_id || 'sinid';
            const tipo = req.body.tipo === 'salida' ? 'salida' : 'entrada';
            const fecha = new Date().toISOString().slice(0, 10);
            const sello = Date.now();
            cb(null, `${empleadoId}_${fecha}_${tipo}_${sello}.jpg`);
        }
    }),
    limits: { fileSize: 8 * 1024 * 1024 }, // 8MB, suficiente para una selfie
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('El archivo debe ser una imagen.'));
        }
        cb(null, true);
    }
});

// IMPORTANTE: estas rutas son PUBLICAS a proposito (no llevan requireAuth)
// porque los empleados marcan desde su propio celular y no tienen cuenta
// de usuario de NominaCore. Solo permiten marcar entrada/salida de HOY —
// no exponen salarios, cuentas contables ni ningun otro dato sensible.
router.get('/', ctrl.index);
router.post('/marcar', (req, res, next) => {
    upload.single('foto')(req, res, (err) => {
        if (err) return res.status(400).json({ ok: false, mensaje: err.message });
        next();
    });
}, ctrl.marcar);
router.post('/turno', ctrl.asignarTurno);

module.exports = router;
