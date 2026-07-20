const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/turnoController');

router.get('/', ctrl.matriz);
router.post('/dia', ctrl.guardarDia);

module.exports = router;
