const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/authController');

router.get('/login', ctrl.mostrarLogin);
router.post('/login', ctrl.procesarLogin);
router.post('/logout', ctrl.logout);

module.exports = router;
