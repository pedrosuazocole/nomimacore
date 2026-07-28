#!/usr/bin/env node
// =====================================================================
// bridge-hikvision.js
//
// "Puente" entre tu reloj de asistencia Hikvision (en tu red local) y
// NominaCore HN (en internet). Corre este script en una computadora del
// negocio que este PRENDIDA y conectada a la MISMA red que el reloj.
//
// Cada cierto tiempo (ver INTERVALO_MINUTOS abajo), le pregunta al reloj
// "¿hay marcas nuevas?", y a las que encuentra las manda a NominaCore.
//
// CÓMO USARLO:
//   1. Necesitas tener Node.js instalado en esta computadora
//      (https://nodejs.org, version 18 o mas reciente)
//   2. Completa la seccion de CONFIGURACION aqui abajo con tus datos
//   3. Abre una terminal en esta carpeta y corre:  node bridge-hikvision.js
//   4. Dejalo corriendo — mientras la ventana este abierta, el puente
//      sigue funcionando. Para que no se cierre solo, podes dejarlo en
//      una ventana minimizada, o usar una herramienta como "pm2" para
//      que corra en segundo plano permanentemente.
//
// Requiere que en NominaCore, en Empleados, hayas llenado el campo
// "ID en Reloj Hikvision" de cada empleado que vaya a marcar ahi.
// =====================================================================

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// =====================================================================
// CONFIGURACION — completa esto con tus datos reales
// =====================================================================
const CONFIG = {
    // Datos del reloj Hikvision (los mismos que usas en la app/pagina local del reloj)
    hikvision: {
        ip: '192.168.10.210',
        puerto: 8000,
        usuario: 'admin',
        contrasena: 'CAMBIA_ESTO',   // la contraseña de administrador del reloj
    },

    // Datos de NominaCore HN
    nominacore: {
        url: 'https://TU-APP.up.railway.app',   // cambia esto por tu URL real de Railway
        apiKey: 'PEGA_AQUI_LA_API_KEY_DE_CONFIGURACION',  // Configuracion > Integraciones en NominaCore
    },

    // Cada cuantos minutos revisar si hay marcas nuevas
    intervaloMinutos: 3,
};
// =====================================================================
// (no es necesario tocar nada mas abajo de esta linea para el uso normal)
// =====================================================================

const ARCHIVO_ESTADO = path.join(__dirname, 'estado-sincronizacion.json');

function leerEstado() {
    try {
        return JSON.parse(fs.readFileSync(ARCHIVO_ESTADO, 'utf8'));
    } catch {
        // Primera vez que corre: empieza a buscar marcas desde hace 1 hora,
        // para no traer meses de historial viejo de una sola vez.
        const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000);
        return { ultimaSincronizacion: haceUnaHora.toISOString() };
    }
}

function guardarEstado(estado) {
    fs.writeFileSync(ARCHIVO_ESTADO, JSON.stringify(estado, null, 2));
}

// ---------------------------------------------------------------------
// Autenticacion Digest (RFC 2617) — la mayoria de los dispositivos
// Hikvision usan esto en vez de usuario/contraseña simples. Se
// implementa a mano con "crypto" para no depender de librerias externas.
// ---------------------------------------------------------------------
function md5(texto) {
    return crypto.createHash('md5').update(texto).digest('hex');
}

function construirAuthorizationDigest(wwwAuthenticate, metodo, uri) {
    const partes = {};
    wwwAuthenticate.replace(/(\w+)="?([^",]+)"?/g, (_, clave, valor) => { partes[clave] = valor; });

    const { usuario, contrasena } = CONFIG.hikvision;
    const nc = '00000001';
    const cnonce = crypto.randomBytes(8).toString('hex');
    const ha1 = md5(`${usuario}:${partes.realm}:${contrasena}`);
    const ha2 = md5(`${metodo}:${uri}`);
    const response = md5(`${ha1}:${partes.nonce}:${nc}:${cnonce}:${partes.qop || 'auth'}:${ha2}`);

    return `Digest username="${usuario}", realm="${partes.realm}", nonce="${partes.nonce}", uri="${uri}", ` +
           `qop=${partes.qop || 'auth'}, nc=${nc}, cnonce="${cnonce}", response="${response}"` +
           (partes.opaque ? `, opaque="${partes.opaque}"` : '');
}

// Hace una peticion HTTP al reloj Hikvision, manejando el "saludo" de
// Digest Auth automaticamente (primer intento sin credenciales, el
// dispositivo responde 401 con las instrucciones, segundo intento ya
// autenticado).
function peticionHikvision(uri, metodo, cuerpo) {
    const opciones = {
        hostname: CONFIG.hikvision.ip,
        port: CONFIG.hikvision.puerto,
        path: uri,
        method: metodo,
        headers: { 'Content-Type': 'application/json' }
    };

    return new Promise((resolve, reject) => {
        const intentoInicial = http.request(opciones, (res) => {
            if (res.statusCode === 401 && res.headers['www-authenticate']) {
                let datos = '';
                res.on('data', (chunk) => { datos += chunk; });
                res.on('end', () => {
                    const authHeader = construirAuthorizationDigest(res.headers['www-authenticate'], metodo, uri);
                    const opcionesAuth = { ...opciones, headers: { ...opciones.headers, Authorization: authHeader } };
                    const intentoAutenticado = http.request(opcionesAuth, (res2) => {
                        let datos2 = '';
                        res2.on('data', (chunk) => { datos2 += chunk; });
                        res2.on('end', () => resolve({ status: res2.statusCode, body: datos2 }));
                    });
                    intentoAutenticado.on('error', reject);
                    if (cuerpo) intentoAutenticado.write(cuerpo);
                    intentoAutenticado.end();
                });
            } else {
                let datos = '';
                res.on('data', (chunk) => { datos += chunk; });
                res.on('end', () => resolve({ status: res.statusCode, body: datos }));
            }
        });
        intentoInicial.on('error', reject);
        if (cuerpo) intentoInicial.write(cuerpo);
        intentoInicial.end();
    });
}

// Busca eventos de marcaje en el reloj desde la ultima sincronizacion.
// Documentacion: POST /ISAPI/AccessControl/AcsEvent?format=json
async function buscarEventosNuevos(desde) {
    const ahora = new Date().toISOString().slice(0, 19);
    const cuerpo = JSON.stringify({
        AcsEventCond: {
            searchID: `nominacore-${Date.now()}`,
            searchResultPosition: 0,
            maxResults: 100,
            major: 5,           // categoria "evento de control de acceso"
            startTime: desde.slice(0, 19),
            endTime: ahora,
        }
    });

    const resp = await peticionHikvision('/ISAPI/AccessControl/AcsEvent?format=json', 'POST', cuerpo);
    if (resp.status !== 200) {
        console.error(`⚠️ El reloj respondio con estado ${resp.status}:`, resp.body.slice(0, 200));
        return [];
    }

    try {
        const data = JSON.parse(resp.body);
        return (data.AcsEvent && data.AcsEvent.InfoList) || [];
    } catch (err) {
        console.error('⚠️ No se pudo interpretar la respuesta del reloj:', err.message);
        return [];
    }
}

// Envia un evento a NominaCore HN
function enviarANominaCore(codigoHikvision, timestamp) {
    return new Promise((resolve) => {
        const url = new URL('/api/hikvision/marcar', CONFIG.nominacore.url);
        const cuerpo = JSON.stringify({ codigo_hikvision: String(codigoHikvision), timestamp });
        const cliente = url.protocol === 'https:' ? https : http;

        const req = cliente.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(cuerpo),
                'X-API-Key': CONFIG.nominacore.apiKey,
            }
        }, (res) => {
            let datos = '';
            res.on('data', (chunk) => { datos += chunk; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(datos) }); }
                catch { resolve({ status: res.statusCode, body: datos }); }
            });
        });
        req.on('error', (err) => resolve({ status: 0, body: { mensaje: err.message } }));
        req.write(cuerpo);
        req.end();
    });
}

async function sincronizar() {
    const estado = leerEstado();
    console.log(`\n🔄 [${new Date().toLocaleString('es-HN')}] Buscando marcas nuevas desde ${estado.ultimaSincronizacion}...`);

    const eventos = await buscarEventosNuevos(estado.ultimaSincronizacion);
    if (eventos.length === 0) {
        console.log('   Sin marcas nuevas.');
        return;
    }

    console.log(`   ${eventos.length} evento(s) encontrado(s).`);
    let ultimoTimestamp = estado.ultimaSincronizacion;

    for (const evento of eventos) {
        const codigo = evento.employeeNoString;
        const timestamp = evento.time; // formato ISO, ej: 2026-07-27T08:03:15+08:00

        if (!codigo) continue; // eventos sin empleado asociado (ej. puerta forzada) se ignoran

        const resultado = await enviarANominaCore(codigo, timestamp);
        if (resultado.status === 200 && resultado.body.ok) {
            console.log(`   ✅ ${resultado.body.empleado} — ${resultado.body.tipo} (${timestamp})`);
        } else {
            console.log(`   ⚠️ Codigo ${codigo}: ${resultado.body.mensaje || 'error desconocido'} (status ${resultado.status})`);
        }

        if (timestamp > ultimoTimestamp) ultimoTimestamp = timestamp;
    }

    guardarEstado({ ultimaSincronizacion: ultimoTimestamp });
}

console.log('🕐 Puente Hikvision → NominaCore HN iniciado.');
console.log(`   Reloj: ${CONFIG.hikvision.ip}:${CONFIG.hikvision.puerto}`);
console.log(`   NominaCore: ${CONFIG.nominacore.url}`);
console.log(`   Revisando cada ${CONFIG.intervaloMinutos} minuto(s). Presiona Ctrl+C para detener.\n`);

sincronizar();
setInterval(sincronizar, CONFIG.intervaloMinutos * 60 * 1000);
