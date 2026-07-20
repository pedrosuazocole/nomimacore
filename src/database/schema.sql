-- =====================================================================
-- NominaCore HN | Esquema de Base de Datos (SQLite)
-- Sistema de Gestion de Planillas y Control de Horarios
-- Basado en la logica real de calculo (Codigo de Trabajo de Honduras)
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- USUARIOS (login del sistema)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    username            TEXT NOT NULL UNIQUE,          -- usado para iniciar sesion (puede ser email)
    password_hash       TEXT NOT NULL,
    nombre_completo     TEXT NOT NULL,
    rol                 TEXT NOT NULL DEFAULT 'OPERADOR' CHECK (rol IN ('ADMIN','OPERADOR')),
    activo              INTEGER NOT NULL DEFAULT 1,
    intentos_fallidos   INTEGER NOT NULL DEFAULT 0,
    bloqueado_hasta     TEXT,                            -- timestamp ISO; NULL = no bloqueado
    ultimo_acceso       TEXT,
    created_at          TEXT DEFAULT (datetime('now','localtime')),
    updated_at          TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_usuarios_username ON usuarios(username);

-- ---------------------------------------------------------------------
-- CONFIGURACION: parametros legales/editables (jornadas, recargos,
-- IHSS, RAP). Se guardan como fila unica editable desde la UI, en vez
-- de "quemarlos" en el codigo, porque cambian con el tiempo.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS configuracion (
    id                          INTEGER PRIMARY KEY CHECK (id = 1), -- fila unica
    empresa_nombre              TEXT NOT NULL DEFAULT 'Mi Empresa S.A.',
    empresa_rtn                 TEXT DEFAULT '',
    horas_jornada_diurna        REAL NOT NULL DEFAULT 44,
    horas_jornada_nocturna      REAL NOT NULL DEFAULT 36,
    horas_jornada_mixta         REAL NOT NULL DEFAULT 42,
    recargo_25                  REAL NOT NULL DEFAULT 1.25,
    recargo_50                  REAL NOT NULL DEFAULT 1.50,
    recargo_75                  REAL NOT NULL DEFAULT 1.75,
    recargo_100                 REAL NOT NULL DEFAULT 2.00,
    ihss_porcentaje_empleado    REAL NOT NULL DEFAULT 0.035,
    ihss_techo_salarial         REAL NOT NULL DEFAULT 11903.13,
    rap_porcentaje_empleado     REAL NOT NULL DEFAULT 0.015,
    rap_techo_salarial          REAL NOT NULL DEFAULT 11903.13,
    dias_mes_planilla           INTEGER NOT NULL DEFAULT 30, -- salario diario = mensual/30
    whatsapp_contacto           TEXT DEFAULT '94502710',
    vista_previa_impresion_default INTEGER NOT NULL DEFAULT 1, -- 1=preview, 0=directa
    updated_at                  TEXT DEFAULT (datetime('now','localtime'))
);

INSERT OR IGNORE INTO configuracion (id) VALUES (1);

-- ---------------------------------------------------------------------
-- EMPLEADOS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS empleados (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_contable     TEXT UNIQUE,                 -- ej: 1106-01-26
    nombre_completo     TEXT NOT NULL,
    departamento        TEXT NOT NULL DEFAULT 'General',
    cargo               TEXT,
    empresa             TEXT DEFAULT '',              -- multi-empresa (ej. Grupo Yacaman)
    cuenta_contable     TEXT,                          -- cuenta contable de gasto/salario
    salario_base        REAL NOT NULL DEFAULT 0,       -- salario mensual
    tipo_pago           TEXT NOT NULL DEFAULT 'MENSUAL' CHECK (tipo_pago IN ('MENSUAL','QUINCENAL','SEMANAL','HORA')),
    tipo_jornada         TEXT NOT NULL DEFAULT 'DIURNA' CHECK (tipo_jornada IN ('DIURNA','NOCTURNA','MIXTA')),
    fecha_ingreso       TEXT,
    estado              TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','INACTIVO')),
    created_at          TEXT DEFAULT (datetime('now','localtime')),
    updated_at          TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_empleados_estado ON empleados(estado);
CREATE INDEX IF NOT EXISTS idx_empleados_departamento ON empleados(departamento);

-- ---------------------------------------------------------------------
-- TURNOS / HORARIOS (programacion diaria + marca real)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS turnos_horarios (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    empleado_id             INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
    fecha                   TEXT NOT NULL,             -- YYYY-MM-DD
    dia_semana              TEXT,                       -- LUNES..DOMINGO (informativo)
    hora_entrada_programada TEXT,                       -- HH:MM
    hora_salida_programada  TEXT,
    hora_entrada_real       TEXT,
    hora_salida_real        TEXT,
    horas_trabajadas        REAL DEFAULT 0,             -- calculado (soporta turnos que cruzan medianoche)
    tipo_turno              TEXT DEFAULT 'DIARIO' CHECK (tipo_turno IN ('DIARIO','SEMANAL')),
    es_dia_libre             INTEGER NOT NULL DEFAULT 0, -- 1 = no laboro ese dia
    observaciones           TEXT,
    created_at              TEXT DEFAULT (datetime('now','localtime')),
    updated_at              TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(empleado_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_turnos_empleado_fecha ON turnos_horarios(empleado_id, fecha);
CREATE INDEX IF NOT EXISTS idx_turnos_fecha ON turnos_horarios(fecha);

-- ---------------------------------------------------------------------
-- HORAS EXTRAS SEMANALES (resultado del motor de calculo, por semana)
-- Replica la hoja "CALCULO HORAS EXTRAS" + "HORAS LPS" del Excel:
-- horas ordinarias vs jornada legal, y distribucion en franjas horarias
-- con su respectivo recargo (25%, 50%, 75%, 100%).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS horas_extras_semanal (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    empleado_id         INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
    semana_inicio       TEXT NOT NULL,
    semana_fin          TEXT NOT NULL,
    horas_totales       REAL NOT NULL DEFAULT 0,   -- suma de horas trabajadas en la semana
    tipo_jornada         TEXT NOT NULL DEFAULT 'DIURNA',
    horas_ordinarias     REAL NOT NULL DEFAULT 0,   -- tope legal segun jornada (44/36/42)
    horas_extras_total   REAL NOT NULL DEFAULT 0,   -- horas_totales - horas_ordinarias (min 0)
    horas_bucket_25      REAL NOT NULL DEFAULT 0,   -- franja 2:00pm-7:00pm
    horas_bucket_50      REAL NOT NULL DEFAULT 0,   -- franja 7:00pm-9:00pm
    horas_bucket_75      REAL NOT NULL DEFAULT 0,   -- franja 6:00pm-6:00am (nocturno)
    horas_bucket_100     REAL NOT NULL DEFAULT 0,   -- dia feriado/descanso trabajado
    pago_bucket_25       REAL NOT NULL DEFAULT 0,
    pago_bucket_50       REAL NOT NULL DEFAULT 0,
    pago_bucket_75       REAL NOT NULL DEFAULT 0,
    pago_bucket_100      REAL NOT NULL DEFAULT 0,
    pago_total_extras    REAL NOT NULL DEFAULT 0,
    septimo_dia_procede  INTEGER NOT NULL DEFAULT 0, -- 1 si cumplio la semana completa
    created_at           TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(empleado_id, semana_inicio, semana_fin)
);

CREATE INDEX IF NOT EXISTS idx_hextras_empleado ON horas_extras_semanal(empleado_id);

-- ---------------------------------------------------------------------
-- PLANILLAS (encabezado de una corrida de nomina)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS planillas (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre              TEXT NOT NULL,               -- ej: "Planilla Semanal 1 al 7 de Junio 2026"
    empresa             TEXT DEFAULT '',
    tipo_periodo        TEXT NOT NULL CHECK (tipo_periodo IN ('SEMANAL','QUINCENAL','MENSUAL')),
    fecha_inicio        TEXT NOT NULL,
    fecha_fin           TEXT NOT NULL,
    estado              TEXT NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR','PROCESADA','PAGADA','ANULADA')),
    total_salarios      REAL DEFAULT 0,
    total_extras        REAL DEFAULT 0,
    total_deducciones   REAL DEFAULT 0,
    total_pagar          REAL DEFAULT 0,
    created_at          TEXT DEFAULT (datetime('now','localtime')),
    updated_at          TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_planillas_periodo ON planillas(fecha_inicio, fecha_fin);

-- ---------------------------------------------------------------------
-- PLANILLA_DETALLE (una fila por empleado dentro de una planilla)
-- Replica exactamente la hoja "PLANILLA" del Excel:
-- salario_diario = salario_mensual/30
-- salario_ordinario = dias_trabajados * salario_diario
-- septimo_dia_pago = (1 si procede) * salario_diario
-- salario_total = salario_ordinario + septimo_dia_pago
-- sal_mas_he = salario_total + horas_extras_pago
-- subtotal_neto = sal_mas_he - ihss - rap
-- total_deducciones = prestamos + vales + impuesto_vecinal
-- total_pagar = subtotal_neto - total_deducciones
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS planilla_detalle (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    planilla_id             INTEGER NOT NULL REFERENCES planillas(id) ON DELETE CASCADE,
    empleado_id             INTEGER NOT NULL REFERENCES empleados(id),
    salario_mensual         REAL NOT NULL DEFAULT 0,
    salario_diario          REAL NOT NULL DEFAULT 0,
    dias_trabajados         REAL NOT NULL DEFAULT 0,
    septimo_dia_procede     INTEGER NOT NULL DEFAULT 0,
    salario_ordinario       REAL NOT NULL DEFAULT 0,
    septimo_dia_pago        REAL NOT NULL DEFAULT 0,
    salario_total           REAL NOT NULL DEFAULT 0,
    horas_extras_horas      REAL NOT NULL DEFAULT 0,
    horas_extras_pago       REAL NOT NULL DEFAULT 0,
    sal_mas_he              REAL NOT NULL DEFAULT 0,
    ihss                    REAL NOT NULL DEFAULT 0,
    rap                     REAL NOT NULL DEFAULT 0,
    subtotal_neto           REAL NOT NULL DEFAULT 0,
    prestamos                REAL NOT NULL DEFAULT 0,
    vales                    REAL NOT NULL DEFAULT 0,
    impuesto_vecinal         REAL NOT NULL DEFAULT 0,
    isr                      REAL NOT NULL DEFAULT 0,
    total_deducciones        REAL NOT NULL DEFAULT 0,
    total_pagar               REAL NOT NULL DEFAULT 0,
    observaciones             TEXT,
    UNIQUE(planilla_id, empleado_id)
);

CREATE INDEX IF NOT EXISTS idx_pdetalle_planilla ON planilla_detalle(planilla_id);
CREATE INDEX IF NOT EXISTS idx_pdetalle_empleado ON planilla_detalle(empleado_id);

-- ---------------------------------------------------------------------
-- DEDUCCIONES VARIABLES (prestamos, vales, impuesto vecinal, etc.)
-- Se registran aqui y se arrastran a la planilla del periodo que
-- corresponda; asi queda historial de por que se dedujo cada monto.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deducciones (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    empleado_id     INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
    tipo            TEXT NOT NULL CHECK (tipo IN ('PRESTAMO','VALE','IMPUESTO_VECINAL','OTRO')),
    concepto        TEXT,
    monto           REAL NOT NULL DEFAULT 0,
    saldo_pendiente REAL NOT NULL DEFAULT 0,     -- para prestamos con abono parcial
    fecha           TEXT NOT NULL,
    aplicada        INTEGER NOT NULL DEFAULT 0,   -- 1 si ya se descarto en una planilla
    planilla_id     INTEGER REFERENCES planillas(id),
    created_at      TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_deducciones_empleado ON deducciones(empleado_id);
CREATE INDEX IF NOT EXISTS idx_deducciones_aplicada ON deducciones(aplicada);
