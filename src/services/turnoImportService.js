// =====================================================================
// turnoImportService.js
// Genera la plantilla de Excel para carga masiva de horarios, y
// procesa archivos subidos por el usuario para crear/actualizar
// turnos en lote. Busca al empleado por Codigo Contable o Nombre.
// =====================================================================

const XLSX = require('xlsx');
const db = require('../config/db');
const { calcularHorasTrabajadas } = require('./calculoService');
const { DIAS_SEMANA } = require('../config/constants');

const COLUMNAS = [
    { header: 'Codigo Contable' },
    { header: 'Nombre Completo *' },
    { header: 'Fecha * (AAAA-MM-DD)' },
    { header: 'Hora Entrada (HH:MM)' },
    { header: 'Hora Salida (HH:MM)' },
    { header: 'Es Dia Libre (SI/NO)' },
    { header: 'Observaciones' }
];

/**
 * Genera el archivo .xlsx de plantilla (encabezados + filas de
 * ejemplo + hoja de instrucciones) listo para descargar.
 */
function generarPlantilla() {
    const headers = COLUMNAS.map(c => c.header);
    const filasEjemplo = [
        ['1106-01-138', 'CAROLINA SARMIENTO VEGA', '2026-06-01', '06:00', '14:00', 'NO', ''],
        ['1106-01-138', 'CAROLINA SARMIENTO VEGA', '2026-06-07', '', '', 'SI', 'Descanso semanal']
    ];

    const wsHorarios = XLSX.utils.aoa_to_sheet([headers, ...filasEjemplo]);
    wsHorarios['!cols'] = headers.map(h => ({ wch: Math.max(20, h.length) }));

    const wsInstrucciones = XLSX.utils.aoa_to_sheet([
        ['Instrucciones para la carga masiva de horarios'],
        [''],
        ['1. No cambies el nombre de las columnas en la hoja "Horarios".'],
        ['2. Identifica al empleado por su "Codigo Contable" (recomendado) o por "Nombre Completo" exacto.'],
        ['3. Fecha es obligatoria, en formato AAAA-MM-DD (ej: 2026-06-01).'],
        ['4. Si el empleado SI trabajo ese dia: llena Hora Entrada y Hora Salida en formato HH:MM (24 horas, ej: 06:00, 14:00, 21:00).'],
        ['5. Si el empleado tuvo dia libre/descanso: escribe "SI" en la columna "Es Dia Libre" y deja las horas en blanco.'],
        ['6. Turnos que cruzan medianoche son validos (ej: Entrada 21:00, Salida 06:00) — el sistema calcula las horas correctamente.'],
        ['7. Si ya existe un turno para ese empleado en esa fecha, se ACTUALIZA en vez de duplicarse.'],
        ['8. Borra las filas de ejemplo antes de subir tu archivo (o simplemente sobre-escribelas).'],
        ['9. Guarda el archivo como .xlsx y subelo desde "Importar Horarios".']
    ]);
    wsInstrucciones['!cols'] = [{ wch: 95 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsHorarios, 'Horarios');
    XLSX.utils.book_append_sheet(wb, wsInstrucciones, 'Instrucciones');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Lee un buffer .xlsx/.xls subido por el usuario, valida cada fila y
 * hace upsert (crear o actualizar por empleado+fecha) en una sola
 * transaccion. Devuelve un resumen fila por fila.
 */
function procesarImportacion(buffer) {
    let wb;
    try {
        wb = XLSX.read(buffer, { type: 'buffer', raw: true });
    } catch (err) {
        return { ok: false, errorGeneral: 'El archivo no se pudo leer. Verifica que sea un .xlsx o .xls valido.', resultados: [] };
    }

    const hoja = wb.Sheets['Horarios'] || wb.Sheets[wb.SheetNames[0]];
    if (!hoja) {
        return { ok: false, errorGeneral: 'El archivo no tiene hojas con datos.', resultados: [] };
    }

    const filas = XLSX.utils.sheet_to_json(hoja, { defval: '', raw: true });
    if (filas.length === 0) {
        return { ok: false, errorGeneral: 'No se encontraron filas de datos (¿esta vacia la plantilla?).', resultados: [] };
    }

    const mapaColumnas = construirMapaColumnas(Object.keys(filas[0]));
    const resultados = [];

    const transaccion = db.transaction((filas) => {
        filas.forEach((fila, idx) => {
            const numeroFila = idx + 2; // +2: fila 1 es encabezado, base 1
            const datos = extraerDatos(fila, mapaColumnas);
            const nombreMostrar = datos.nombreCompleto || datos.codigoContable || '(sin identificar)';

            // 1. Ubicar al empleado por codigo contable o por nombre
            let empleado = null;
            if (datos.codigoContable) {
                empleado = db.prepare('SELECT id, nombre_completo FROM empleados WHERE codigo_contable = ?').get(datos.codigoContable);
            }
            if (!empleado && datos.nombreCompleto) {
                empleado = db.prepare('SELECT id, nombre_completo FROM empleados WHERE UPPER(TRIM(nombre_completo)) = ?').get(datos.nombreCompleto.toUpperCase());
            }
            if (!empleado) {
                resultados.push({ fila: numeroFila, nombre: nombreMostrar, accion: 'ERROR', mensaje: 'No se encontro ningun empleado con ese Codigo Contable o Nombre Completo.' });
                return;
            }

            // 2. Validar la fila
            const validacion = validarFila(datos);
            if (!validacion.ok) {
                resultados.push({ fila: numeroFila, nombre: empleado.nombre_completo, accion: 'ERROR', mensaje: validacion.error });
                return;
            }

            // 3. Upsert del turno (mismo comportamiento que la matriz de Horarios)
            const yaExistia = !!db.prepare('SELECT 1 FROM turnos_horarios WHERE empleado_id = ? AND fecha = ?').get(empleado.id, datos.fecha);

            const horas = datos.esDiaLibre
                ? 0
                : calcularHorasTrabajadas(datos.horaEntrada, datos.horaSalida);

            db.prepare(`
                INSERT INTO turnos_horarios
                    (empleado_id, fecha, dia_semana, hora_entrada_programada, hora_salida_programada,
                     hora_entrada_real, hora_salida_real, horas_trabajadas, tipo_turno, es_dia_libre, observaciones)
                VALUES
                    (@empleado_id, @fecha, @dia_semana, @hora_entrada, @hora_salida,
                     @hora_entrada, @hora_salida, @horas_trabajadas, 'DIARIO', @es_dia_libre, @observaciones)
                ON CONFLICT(empleado_id, fecha) DO UPDATE SET
                    dia_semana = excluded.dia_semana,
                    hora_entrada_programada = excluded.hora_entrada_programada,
                    hora_salida_programada = excluded.hora_salida_programada,
                    hora_entrada_real = excluded.hora_entrada_real,
                    hora_salida_real = excluded.hora_salida_real,
                    horas_trabajadas = excluded.horas_trabajadas,
                    es_dia_libre = excluded.es_dia_libre,
                    observaciones = excluded.observaciones,
                    updated_at = datetime('now','localtime')
            `).run({
                empleado_id: empleado.id,
                fecha: datos.fecha,
                dia_semana: diaSemanaDesdeFecha(datos.fecha),
                hora_entrada: datos.esDiaLibre ? null : datos.horaEntrada,
                hora_salida: datos.esDiaLibre ? null : datos.horaSalida,
                horas_trabajadas: horas,
                es_dia_libre: datos.esDiaLibre ? 1 : 0,
                observaciones: datos.observaciones || null
            });

            resultados.push({
                fila: numeroFila,
                nombre: empleado.nombre_completo,
                accion: yaExistia ? 'ACTUALIZADO' : 'CREADO',
                mensaje: `${datos.fecha}${datos.esDiaLibre ? ' — dia libre' : ` — ${datos.horaEntrada} a ${datos.horaSalida} (${horas.toFixed(2)} h)`}`
            });
        });
    });

    try {
        transaccion(filas);
    } catch (err) {
        return { ok: false, errorGeneral: 'Error inesperado procesando el archivo: ' + err.message, resultados };
    }

    return { ok: true, resultados };
}

// =====================================================================
// Helpers
// =====================================================================

function construirMapaColumnas(headersReales) {
    const normalizar = (s) => s.toString().toLowerCase().replace(/[*()]/g, '').trim();
    const patrones = {
        codigoContable: /codigo\s*contable/,
        nombreCompleto: /nombre/,
        fecha: /fecha/,
        horaEntrada: /hora\s*entrada/,
        horaSalida: /hora\s*salida/,
        esDiaLibre: /dia\s*libre/,
        observaciones: /observacion/
    };
    const mapa = {};
    for (const headerReal of headersReales) {
        const norm = normalizar(headerReal);
        for (const [campo, patron] of Object.entries(patrones)) {
            if (patron.test(norm) && !mapa[campo]) mapa[campo] = headerReal;
        }
    }
    return mapa;
}

function extraerValor(fila, mapaColumnas, campo) {
    const headerReal = mapaColumnas[campo];
    if (!headerReal) return '';
    const v = fila[headerReal];
    return v === undefined || v === null ? '' : v;
}

function extraerDatos(fila, mapaColumnas) {
    const esDiaLibreRaw = String(extraerValor(fila, mapaColumnas, 'esDiaLibre')).trim().toUpperCase();

    return {
        codigoContable: String(extraerValor(fila, mapaColumnas, 'codigoContable')).trim() || null,
        nombreCompleto: String(extraerValor(fila, mapaColumnas, 'nombreCompleto')).trim() || null,
        fecha: normalizarFecha(extraerValor(fila, mapaColumnas, 'fecha')),
        horaEntrada: normalizarHora(extraerValor(fila, mapaColumnas, 'horaEntrada')),
        horaSalida: normalizarHora(extraerValor(fila, mapaColumnas, 'horaSalida')),
        esDiaLibre: ['SI', 'S', 'YES', 'Y', 'TRUE', '1'].includes(esDiaLibreRaw),
        observaciones: String(extraerValor(fila, mapaColumnas, 'observaciones')).trim()
    };
}

/**
 * Excel guarda fechas como numero serial (dias desde 1899-12-30). Con
 * raw:true, sheet_to_json devuelve ese numero tal cual en vez de una
 * fecha formateada, asi que hay que convertirlo. Tambien se acepta
 * texto ya escrito en AAAA-MM-DD o DD/MM/AAAA (comun en Honduras).
 */
function normalizarFecha(valor) {
    if (valor === '' || valor === null || valor === undefined) return null;

    if (typeof valor === 'number') {
        const utcMs = Math.round((valor - 25569) * 86400000);
        const d = new Date(utcMs);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
    }

    const texto = String(valor).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);

    const matchDMA = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (matchDMA) {
        const [, d, m, y] = matchDMA;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    return null;
}

/**
 * Con raw:true, una celda de hora en Excel llega como fraccion del dia
 * (0.25 = 06:00). Tambien se acepta texto "HH:MM" o "H:MM AM/PM".
 */
function normalizarHora(valor) {
    if (valor === '' || valor === null || valor === undefined) return null;

    if (typeof valor === 'number') {
        const fraccion = valor % 1;
        const totalMinutos = Math.round(fraccion * 24 * 60);
        const hh = String(Math.floor(totalMinutos / 60) % 24).padStart(2, '0');
        const mm = String(totalMinutos % 60).padStart(2, '0');
        return `${hh}:${mm}`;
    }

    const texto = String(valor).trim();
    const match12h = texto.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/);
    if (match12h) {
        let [, h, m, ampm] = match12h;
        h = parseInt(h, 10);
        if (/pm/i.test(ampm) && h !== 12) h += 12;
        if (/am/i.test(ampm) && h === 12) h = 0;
        return `${String(h).padStart(2, '0')}:${m}`;
    }

    const match24h = texto.match(/^(\d{1,2}):(\d{2})$/);
    if (match24h) {
        const [, h, m] = match24h;
        return `${h.padStart(2, '0')}:${m}`;
    }

    return null;
}

function diaSemanaDesdeFecha(fechaISO) {
    const d = new Date(fechaISO + 'T00:00:00');
    const dia = d.getDay(); // 0=domingo
    const indice = dia === 0 ? 6 : dia - 1; // convertir a LUNES=0..DOMINGO=6
    return DIAS_SEMANA[indice];
}

function validarFila(datos) {
    if (!datos.fecha) {
        return { ok: false, error: 'Fecha invalida o vacia. Usa el formato AAAA-MM-DD.' };
    }
    if (!datos.esDiaLibre) {
        if (!datos.horaEntrada || !datos.horaSalida) {
            return { ok: false, error: 'Hora Entrada y Hora Salida son obligatorias cuando no es dia libre.' };
        }
    }
    return { ok: true };
}

module.exports = { generarPlantilla, procesarImportacion };
