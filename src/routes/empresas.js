const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/empresaController');

router.get('/', ctrl.index);
router.get('/nuevo', ctrl.nuevoForm);
router.post('/', ctrl.crear);
router.get('/:id/editar', ctrl.editarForm);
router.put('/:id', ctrl.actualizar);
router.delete('/:id', ctrl.darDeBaja);

module.exports = router;
