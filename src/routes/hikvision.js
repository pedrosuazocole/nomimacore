const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/hikvisionController');

// IMPORTANTE: esta ruta NO usa requireAuth (no hay sesion de un humano
// logueado) — el "puente" local que corre en la computadora del negocio
// es el que llama aqui, y se autentica con una API key propia (ver
// hikvisionController.js), no con usuario/contraseña.
router.post('/marcar', ctrl.marcar);

module.exports = router;
