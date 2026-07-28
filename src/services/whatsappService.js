// =====================================================================
// whatsappService.js
// Notificaciones automaticas por WhatsApp usando CallMeBot (100% gratis,
// sin limites de mensajes ni tarjeta de credito — a diferencia de
// TextMeBot que se usa en otras apps del portafolio y si tiene costo).
//
// Como activarlo (una sola vez, lo hace el dueno del numero que va a
// RECIBIR las notificaciones):
//   1. Agregar el contacto +34 644 66 51 22 (CallMeBot) en WhatsApp
//   2. Enviarle por WhatsApp el mensaje: "I allow callmebot to send me messages"
//   3. CallMeBot responde con una API key personal
//   4. Esa API key se pega en Configuracion > Notificaciones WhatsApp
//
// Documentacion oficial: https://www.callmebot.com/blog/free-api-whatsapp-messages/
// =====================================================================
const https = require('https');
const db = require('../config/db');

function enviarWhatsApp(mensaje) {
    const cfg = db.prepare('SELECT whatsapp_contacto, whatsapp_apikey_callmebot FROM configuracion WHERE id = 1').get();

    if (!cfg || !cfg.whatsapp_contacto || !cfg.whatsapp_apikey_callmebot) {
        console.log('ℹ️ Notificacion de WhatsApp omitida: falta configurar el numero o la API key de CallMeBot en Configuracion.');
        return Promise.resolve({ ok: false, motivo: 'no_configurado' });
    }

    // CallMeBot espera el numero completo con codigo de pais, sin "+" ni espacios.
    const numeroLimpio = cfg.whatsapp_contacto.replace(/[^0-9]/g, '');
    const numeroCompleto = numeroLimpio.startsWith('504') ? numeroLimpio : `504${numeroLimpio}`;

    const url = `https://api.callmebot.com/whatsapp.php?phone=${numeroCompleto}&text=${encodeURIComponent(mensaje)}&apikey=${encodeURIComponent(cfg.whatsapp_apikey_callmebot)}`;

    return new Promise((resolve) => {
        https.get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                console.log('📲 CallMeBot respuesta:', body.slice(0, 120));
                resolve({ ok: res.statusCode < 400, respuesta: body });
            });
        }).on('error', (err) => {
            // Nunca debe tumbar el flujo principal (guardar una planilla, etc.)
            // por un fallo de red al notificar — solo se registra en el log.
            console.error('⚠️ No se pudo enviar la notificacion de WhatsApp:', err.message);
            resolve({ ok: false, motivo: 'error_red', error: err.message });
        });
    });
}

module.exports = { enviarWhatsApp };
