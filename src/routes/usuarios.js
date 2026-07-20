const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/usuarioController');
const { requireRole } = require('../middlewares/auth');

// Solo ADMIN puede gestionar usuarios
router.use(requireRole('ADMIN'));

router.get('/', ctrl.index);
router.get('/nuevo', ctrl.nuevoForm);
router.post('/', ctrl.crear);
router.get('/:id/editar', ctrl.editarForm);
router.put('/:id', ctrl.actualizar);

module.exports = router;
