const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/reporteController');

router.get('/', ctrl.index);
router.get('/planillas', ctrl.planillas);
router.get('/contable', ctrl.contable);
router.get('/asiento', ctrl.asiento);
router.get('/horas-extra', ctrl.horasExtra);
router.get('/deducciones', ctrl.deducciones);
router.get('/empleado', ctrl.empleado);
router.get('/padron', ctrl.padron);

module.exports = router;
