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

    // ---- Modulo de Empresas ----
    // A diferencia de agregarColumnaSiFalta (que altera tablas
    // EXISTENTES), esta es una tabla NUEVA — CREATE TABLE IF NOT EXISTS
    // ya es seguro de por si, no necesita el chequeo previo.
    db.exec(`
        CREATE TABLE IF NOT EXISTS empresas (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre          TEXT NOT NULL UNIQUE,
            rtn             TEXT,
            direccion       TEXT,
            telefono        TEXT,
            estado          TEXT NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN ('ACTIVA','INACTIVA')),
            created_at      TEXT DEFAULT (datetime('now','localtime')),
            updated_at      TEXT DEFAULT (datetime('now','localtime'))
        )
    `);

    agregarColumnaSiFalta(db, 'empleados', 'empresa_id', "INTEGER REFERENCES empresas(id)");
    agregarColumnaSiFalta(db, 'planillas', 'empresa_id', "INTEGER REFERENCES empresas(id)");

    // Siembra UNA SOLA VEZ (solo si el modulo de Empresas esta vacio):
    // crea "Inversiones Buenos Aires S.A." y vincula automaticamente a
    // todos los empleados que todavia no tengan empresa_id asignado —
    // los empleados que ya existian en la app antes de este modulo
    // pertenecen a esa empresa segun confirmo el cliente.
    if (tablaExiste(db, 'empresas') && tablaExiste(db, 'empleados')) {
        const totalEmpresas = db.prepare('SELECT COUNT(*) c FROM empresas').get().c;
        if (totalEmpresas === 0) {
            console.log('🏢 Sembrando empresa inicial: Inversiones Buenos Aires S.A. (vinculando empleados existentes)...');
            const info = db.prepare(`INSERT INTO empresas (nombre, estado) VALUES ('Inversiones Buenos Aires S.A.', 'ACTIVA')`).run();
            const empresaId = info.lastInsertRowid;
            db.prepare(`UPDATE empleados SET empresa_id = ?, empresa = 'Inversiones Buenos Aires S.A.' WHERE empresa_id IS NULL`).run(empresaId);
            if (columnaExiste(db, 'planillas', 'empresa_id')) {
                db.prepare(`
                    UPDATE planillas SET empresa_id = ?, empresa = 'Inversiones Buenos Aires S.A.'
                    WHERE empresa_id IS NULL AND (empresa IS NULL OR empresa = '' OR empresa LIKE '%Buenos Aires%')
                `).run(empresaId);
            }
        }
    }
}

module.exports = { migrarColumnasFaltantes };
