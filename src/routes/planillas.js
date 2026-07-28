const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/planillaController');

router.get('/', ctrl.index);
router.get('/nueva', ctrl.nuevaForm);
router.post('/', ctrl.crear);
router.get('/:id/procesar', ctrl.procesar);
router.post('/:id/procesar', ctrl.guardarDetalle);
router.get('/:id/reporte', ctrl.reporte);
router.delete('/:id', ctrl.eliminar);

module.exports = router;
