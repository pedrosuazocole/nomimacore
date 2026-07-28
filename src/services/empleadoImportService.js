// =====================================================================
// empleadoImportService.js
// Genera la plantilla de Excel para carga masiva de empleados, y
// procesa archivos subidos por el usuario para crear/actualizar
// empleados en lote.
// =====================================================================

const XLSX = require('xlsx');
const db = require('../config/db');

const COLUMNAS = [
    { header: 'Nombre Completo *', key: 'nombre_completo' },
    { header: 'Codigo Contable', key: 'codigo_contable' },
    { header: 'Departamento', key: 'departamento' },
    { header: 'Cargo', key: 'cargo' },
    { header: 'Empresa', key: 'empresa' },
    { header: 'Cuenta Contable', key: 'cuenta_contable' },
    { header: 'Salario Base *', key: 'salario_base' },
    { header: 'Tipo Pago (MENSUAL/QUINCENAL/SEMANAL/HORA)', key: 'tipo_pago' },
    { header: 'Tipo Jornada (DIURNA/NOCTURNA/MIXTA)', key: 'tipo_jornada' },
    { header: 'Fecha Ingreso (AAAA-MM-DD)', key: 'fecha_ingreso' },
    { header: 'Estado (ACTIVO/INACTIVO)', key: 'estado' }
];

const TIPOS_PAGO_VALIDOS = ['MENSUAL', 'QUINCENAL', 'SEMANAL', 'HORA'];
const TIPOS_JORNADA_VALIDOS = ['DIURNA', 'NOCTURNA', 'MIXTA'];
const ESTADOS_VALIDOS = ['ACTIVO', 'INACTIVO'];

/**
 * Genera el archivo .xlsx de plantilla (encabezados + una fila de
 * ejemplo + una hoja de instrucciones) listo para descargar.
 */
function generarPlantilla() {
    const headers = COLUMNAS.map(c => c.header);
    const filaEjemplo = [
        'CAROLINA SARMIENTO VEGA', '1106-01-138', 'Tienda', 'Cajera',
        'Inversiones Buenos Aires S.A.', '5202-01-01', 13714.21,
        'MENSUAL', 'DIURNA', '2024-03-01', 'ACTIVO'
    ];

    const wsEmpleados = XLSX.utils.aoa_to_sheet([headers, filaEjemplo]);
    wsEmpleados['!cols'] = headers.map(h => ({ wch: Math.max(20, h.length) }));

    const wsInstrucciones = XLSX.utils.aoa_to_sheet([
        ['Instrucciones para la carga masiva de empleados'],
        [''],
        ['1. No cambies el nombre de las columnas en la hoja "Empleados".'],
        ['2. Los campos marcados con * son obligatorios: Nombre Completo y Salario Base.'],
        ['3. Borra la fila de ejemplo antes de subir tu archivo (o simplemente sobre-escribela).'],
        ['4. Si el "Codigo Contable" ya existe en el sistema, ese empleado se ACTUALIZA en vez de duplicarse.'],
        ['5. Si dejas Tipo Pago, Tipo Jornada o Estado en blanco, se usan estos valores por defecto:'],
        ['   Tipo Pago: MENSUAL   |   Tipo Jornada: DIURNA   |   Estado: ACTIVO'],
        ['6. Valores validos para Tipo Pago: ' + TIPOS_PAGO_VALIDOS.join(', ')],
        ['7. Valores validos para Tipo Jornada: ' + TIPOS_JORNADA_VALIDOS.join(', ')],
        ['8. Valores validos para Estado: ' + ESTADOS_VALIDOS.join(', ')],
        ['9. Fecha Ingreso en formato AAAA-MM-DD (ej: 2024-03-01). Puedes dejarla en blanco.'],
        ['10. Guarda el archivo como .xlsx y subelo desde "Importar Empleados".']
    ]);
    wsInstrucciones['!cols'] = [{ wch: 90 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsEmpleados, 'Empleados');
    XLSX.utils.book_append_sheet(wb, wsInstrucciones, 'Instrucciones');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Lee un buffer .xlsx/.xls subido por el usuario, valida cada fila y
 * hace upsert (crear o actualizar por Codigo Contable) en una sola
 * transaccion. Devuelve un resumen detallado fila por fila para que
 * el usuario vea exactamente que paso con cada empleado.
 */
function procesarImportacion(buffer) {
    let wb;
    try {
        wb = XLSX.read(buffer, { type: 'buffer' });
    } catch (err) {
        return { ok: false, errorGeneral: 'El archivo no se pudo leer. Verifica que sea un .xlsx o .xls valido.', resultados: [] };
    }

    const hoja = wb.Sheets['Empleados'] || wb.Sheets[wb.SheetNames[0]];
    if (!hoja) {
        return { ok: false, errorGeneral: 'El archivo no tiene hojas con datos.', resultados: [] };
    }

    const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
    if (filas.length === 0) {
        return { ok: false, errorGeneral: 'No se encontraron filas de datos (¿esta vacia la plantilla?).', resultados: [] };
    }

    const mapaColumnas = construirMapaColumnas(Object.keys(filas[0]));
    const resultados = [];

    const transaccion = db.transaction((filas) => {
        filas.forEach((fila, idx) => {
            const numeroFila = idx + 2; // +2: fila 1 es encabezado, base 1
            const datos = extraerDatos(fila, mapaColumnas);
            const validacion = validarFila(datos);

            if (!validacion.ok) {
                resultados.push({ fila: numeroFila, nombre: datos.nombre_completo || '(sin nombre)', accion: 'ERROR', mensaje: validacion.error });
                return;
            }

            const existente = datos.codigo_contable
                ? db.prepare('SELECT id FROM empleados WHERE codigo_contable = ?').get(datos.codigo_contable)
                : null;

            if (existente) {
                db.prepare(`
                    UPDATE empleados SET
                        nombre_completo=@nombre_completo, departamento=@departamento, cargo=@cargo,
                        empresa=@empresa, cuenta_contable=@cuenta_contable, salario_base=@salario_base,
                        tipo_pago=@tipo_pago, tipo_jornada=@tipo_jornada, fecha_ingreso=@fecha_ingreso,
                        estado=@estado, updated_at=datetime('now','localtime')
                    WHERE id=@id
                `).run({ ...datos, id: existente.id });
                resultados.push({ fila: numeroFila, nombre: datos.nombre_completo, accion: 'ACTUALIZADO', mensaje: `Codigo Contable ${datos.codigo_contable} ya existia` });
            } else {
                db.prepare(`
                    INSERT INTO empleados
                        (codigo_contable, nombre_completo, departamento, cargo, empresa, cuenta_contable,
                         salario_base, tipo_pago, tipo_jornada, fecha_ingreso, estado)
                    VALUES
                        (@codigo_contable, @nombre_completo, @departamento, @cargo, @empresa, @cuenta_contable,
                         @salario_base, @tipo_pago, @tipo_jornada, @fecha_ingreso, @estado)
                `).run(datos);
                resultados.push({ fila: numeroFila, nombre: datos.nombre_completo, accion: 'CREADO', mensaje: '' });
            }
        });
    });

    try {
        transaccion(filas);
    } catch (err) {
        return { ok: false, errorGeneral: 'Error inesperado procesando el archivo: ' + err.message, resultados };
    }

    return { ok: true, resultados };
}

/**
 * Empareja los encabezados reales del archivo subido (pueden variar
 * ligeramente: mayusculas, espacios, sin el "*") contra nuestras
 * columnas esperadas, usando coincidencia flexible por palabras clave.
 */
function construirMapaColumnas(headersReales) {
    const normalizar = (s) => s.toString().toLowerCase().replace(/[*()]/g, '').trim();
    const patrones = {
        nombre_completo: /nombre/,
        codigo_contable: /codigo\s*contable/,
        departamento: /departamento/,
        cargo: /^cargo/,
        empresa: /empresa/,
        cuenta_contable: /cuenta\s*contable/,
        salario_base: /salario/,
        tipo_pago: /tipo\s*pago/,
        tipo_jornada: /tipo\s*jornada/,
        fecha_ingreso: /fecha\s*ingreso/,
        estado: /^estado/
    };

    const mapa = {};
    for (const headerReal of headersReales) {
        const norm = normalizar(headerReal);
        for (const [campo, patron] of Object.entries(patrones)) {
            if (patron.test(norm) && !mapa[campo]) {
                mapa[campo] = headerReal;
            }
        }
    }
    return mapa;
}

function extraerDatos(fila, mapaColumnas) {
    const val = (campo) => {
        const headerReal = mapaColumnas[campo];
        if (!headerReal) return '';
        const v = fila[headerReal];
        return v === undefined || v === null ? '' : String(v).trim();
    };

    return {
        nombre_completo: val('nombre_completo'),
        codigo_contable: val('codigo_contable') || null,
        departamento: val('departamento') || 'General',
        cargo: val('cargo') || null,
        empresa: val('empresa') || '',
        cuenta_contable: val('cuenta_contable') || null,
        salario_base: Number(val('salario_base').replace(/,/g, '')) || 0,
        tipo_pago: TIPOS_PAGO_VALIDOS.includes(val('tipo_pago').toUpperCase()) ? val('tipo_pago').toUpperCase() : 'MENSUAL',
        tipo_jornada: TIPOS_JORNADA_VALIDOS.includes(val('tipo_jornada').toUpperCase()) ? val('tipo_jornada').toUpperCase() : 'DIURNA',
        fecha_ingreso: val('fecha_ingreso') || null,
        estado: ESTADOS_VALIDOS.includes(val('estado').toUpperCase()) ? val('estado').toUpperCase() : 'ACTIVO'
    };
}

function validarFila(datos) {
    if (!datos.nombre_completo || datos.nombre_completo.length < 3) {
        return { ok: false, error: 'Nombre Completo es obligatorio (minimo 3 caracteres).' };
    }
    if (!datos.salario_base || datos.salario_base <= 0) {
        return { ok: false, error: 'Salario Base debe ser un numero mayor a 0.' };
    }
    return { ok: true };
}

module.exports = { generarPlantilla, procesarImportacion, COLUMNAS };
