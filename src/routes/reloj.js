const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/relojController');

// IMPORTANTE: estas rutas son PUBLICAS a proposito (no llevan requireAuth)
// porque los empleados marcan desde su propio celular y no tienen cuenta
// de usuario de NominaCore. Solo permiten marcar entrada/salida de HOY —
// no exponen salarios, cuentas contables ni ningun otro dato sensible.
router.get('/', ctrl.index);
router.post('/marcar', ctrl.marcar);
router.post('/turno', ctrl.asignarTurno);

module.exports = router;
