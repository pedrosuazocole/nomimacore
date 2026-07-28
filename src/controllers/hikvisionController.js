const db = require('../config/db');
const EmpleadoModel = require('../models/empleadoModel');
const TurnoModel = require('../models/turnoModel');

const HikvisionController = {
    // Recibe un evento de marcaje enviado por el "puente" local que corre
    // en la computadora del negocio (ver script bridge-hikvision.js). No
    // usa sesion/login — se protege con una API key secreta que solo el
    // puente conoce (Configuracion > Integraciones).
    async marcar(req, res) {
        try {
            const apiKeyEnviada = req.headers['x-api-key'];
            const cfg = db.prepare('SELECT hikvision_api_key FROM configuracion WHERE id = 1').get();

            if (!cfg || !cfg.hikvision_api_key || apiKeyEnviada !== cfg.hikvision_api_key) {
                return res.status(401).json({ ok: false, mensaje: 'API key invalida o faltante.' });
            }

            const { codigo_hikvision, timestamp, tipo } = req.body;
            if (!codigo_hikvision || !timestamp) {
                return res.status(400).json({ ok: false, mensaje: 'Faltan datos: codigo_hikvision y timestamp son obligatorios.' });
            }

            const empleado = EmpleadoModel.obtenerPorCodigoHikvision(codigo_hikvision);
            if (!empleado) {
                return res.status(404).json({ ok: false, mensaje: `Ningun empleado activo tiene vinculado el codigo Hikvision "${codigo_hikvision}". Vinculalo en Empleados.` });
            }

            // El timestamp que manda el reloj se toma tal cual como hora
            // local de Honduras (se asume que el reloj fisico, instalado
            // en el negocio, ya esta configurado en su zona horaria real
            // — no se hace conversion de zona horaria adicional aqui).
            const fecha = timestamp.slice(0, 10);
            const hora = timestamp.slice(11, 16);
            const marcaExplicita = { fecha, hora };

            // El dispositivo no siempre distingue entrada de salida — si
            // no se especifica, se infiere: si todavia no hay entrada
            // marcada hoy, es entrada; si ya la hay, es salida.
            let tipoFinal = tipo;
            if (!tipoFinal) {
                const estadoHoy = TurnoModel.obtenerEstadoHoy(empleado.id, fecha);
                tipoFinal = (estadoHoy && estadoHoy.hora_entrada_real) ? 'salida' : 'entrada';
            }

            const resultado = tipoFinal === 'salida'
                ? TurnoModel.marcarSalida(empleado.id, null, null, marcaExplicita)
                : TurnoModel.marcarEntrada(empleado.id, null, null, marcaExplicita);

            res.json({ ...resultado, empleado: empleado.nombre_completo, tipo: tipoFinal });
        } catch (err) {
            console.error('💥 Error en integracion Hikvision:', err.message);
            res.status(500).json({ ok: false, mensaje: 'Error interno procesando el evento.' });
        }
    }
};

module.exports = HikvisionController;
