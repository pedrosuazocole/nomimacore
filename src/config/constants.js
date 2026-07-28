// =====================================================================
// Constantes de negocio con valores por defecto.
// La fuente de verdad en tiempo de ejecucion es la tabla `configuracion`
// (editable desde /configuracion en la UI); estos valores solo se usan
// como respaldo si la fila de configuracion no existe todavia.
//
// IMPORTANTE: Los porcentajes/techos de IHSS y RAP cambian periodicamente
// por resolucion oficial. Verifica siempre las tablas vigentes del IHSS
// y del RAP antes de usar esta app en produccion, y actualizalas en el
// modulo de Configuracion.
// =====================================================================

const DEFAULTS = {
    horas_jornada_diurna: 44,
    horas_jornada_nocturna: 36,
    horas_jornada_mixta: 42,
    recargo_25: 1.25,
    recargo_50: 1.50,
    recargo_75: 1.75,
    recargo_100: 2.00,
    ihss_porcentaje_empleado: 0.035,
    ihss_techo_salarial: 11903.13,
    rap_porcentaje_empleado: 0.015,
    rap_techo_salarial: 11903.13,
    dias_mes_planilla: 30
};

const DIAS_SEMANA = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'];

// Franjas horarias tal como estan en el Excel de referencia del cliente.
// Estas franjas se usan para clasificar EN QUE recargo cae cada bloque
// de horas extra que el usuario asigna manualmente al capturar el turno.
const FRANJAS_RECARGO = [
    { key: 'bucket_25', label: '2:00 PM - 7:00 PM', recargoField: 'recargo_25' },
    { key: 'bucket_50', label: '7:00 PM - 9:00 PM', recargoField: 'recargo_50' },
    { key: 'bucket_75', label: '6:00 PM - 6:00 AM (Nocturno)', recargoField: 'recargo_75' },
    { key: 'bucket_100', label: 'Dia feriado / descanso trabajado', recargoField: 'recargo_100' }
];

module.exports = { DEFAULTS, DIAS_SEMANA, FRANJAS_RECARGO };
