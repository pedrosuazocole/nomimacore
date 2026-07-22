// =====================================================================
// migrate-columns.js
// Agrega columnas nuevas a tablas que YA EXISTEN en produccion, sin
// perder datos. schema.sql (CREATE TABLE IF NOT EXISTS) solo sirve
// para bases de datos nuevas; si la tabla ya existe (como en Railway
// con el volumen persistente), hay que hacer ALTER TABLE a mano.
// Esta funcion es segura de correr en CADA arranque: revisa que
// columna ya existe antes de intentar agregarla.
// =====================================================================

function tablaExiste(db, tabla) {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tabla);
    return !!row;
}

function columnaExiste(db, tabla, columna) {
    const columnas = db.prepare(`PRAGMA table_info(${tabla})`).all();
    return columnas.some(c => c.name === columna);
}

function agregarColumnaSiFalta(db, tabla, columna, definicion) {
    // Si la tabla en si todavia no existe (ej. BD parcialmente
    // inicializada), se salta con un aviso en vez de tumbar toda la
    // app — el proximo arranque (o schema.sql) la terminara de crear.
    if (!tablaExiste(db, tabla)) {
        console.log(`⚠️  Migracion: la tabla "${tabla}" todavia no existe, se omite (no es un error).`);
        return;
    }
    if (!columnaExiste(db, tabla, columna)) {
        console.log(`🔧 Migrando: agregando columna "${columna}" a "${tabla}"...`);
        db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
    }
}

function migrarColumnasFaltantes(db) {
    // Columnas de Transporte (agregadas para el beneficio de transporte
    // por salida a las 11pm / doble turno hasta las 9pm).
    agregarColumnaSiFalta(db, 'planilla_detalle', 'transporte_dias_11pm', "INTEGER NOT NULL DEFAULT 0");
    agregarColumnaSiFalta(db, 'planilla_detalle', 'transporte_dias_doble_turno', "INTEGER NOT NULL DEFAULT 0");
    agregarColumnaSiFalta(db, 'planilla_detalle', 'transporte', "REAL NOT NULL DEFAULT 0");

    // Cuentas contables para el Asiento Contable (modulo de Reportes).
    agregarColumnaSiFalta(db, 'configuracion', 'cuenta_salario_ordinario', "TEXT DEFAULT '5202-01-01'");
    agregarColumnaSiFalta(db, 'configuracion', 'cuenta_salario_extraordinario', "TEXT DEFAULT '5202-01-02'");
    agregarColumnaSiFalta(db, 'configuracion', 'cuenta_transporte', "TEXT DEFAULT '5202-01-03'");
    agregarColumnaSiFalta(db, 'configuracion', 'cuenta_ihss', "TEXT DEFAULT '2107-01-01'");
    agregarColumnaSiFalta(db, 'configuracion', 'cuenta_rap', "TEXT DEFAULT '2107-01-03'");
    agregarColumnaSiFalta(db, 'configuracion', 'cuenta_impuesto_vecinal', "TEXT DEFAULT '2107-01-04'");
    agregarColumnaSiFalta(db, 'configuracion', 'cuenta_isr', "TEXT DEFAULT '2107-01-05'");
    agregarColumnaSiFalta(db, 'configuracion', 'cuenta_banco', "TEXT DEFAULT '1101-01-01'");

    // Fotos de evidencia del Reloj de Asistencia (guarda la ruta relativa
    // del archivo, no la imagen en si — la imagen queda en el volumen
    // persistente junto a la base de datos).
    agregarColumnaSiFalta(db, 'turnos_horarios', 'foto_entrada', "TEXT");
    agregarColumnaSiFalta(db, 'turnos_horarios', 'foto_salida', "TEXT");
}

module.exports = { migrarColumnasFaltantes };
