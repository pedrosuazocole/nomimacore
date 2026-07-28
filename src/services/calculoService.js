// =====================================================================
// calculoService.js
// Motor de calculo de planilla. Replica, formula por formula, la logica
// encontrada en el Excel de referencia del cliente (hojas "CALCULO
// HORAS EXTRAS", "HORAS LPS" y "PLANILLA"), para que los resultados
// cuadren exactamente con lo que Contabilidad ya usa.
// =====================================================================

const db = require('../config/db');

function getConfig() {
    return db.prepare('SELECT * FROM configuracion WHERE id = 1').get();
}

/**
 * Calcula horas trabajadas entre una hora de entrada y salida (HH:MM),
 * soportando turnos que cruzan medianoche.
 * Formula origen (Excel): =IF(salida<entrada, (salida+1)-entrada, salida-entrada)*24
 */
function calcularHorasTrabajadas(horaEntrada, horaSalida) {
    if (!horaEntrada || !horaSalida) return 0;

    const [hE, mE] = horaEntrada.split(':').map(Number);
    const [hS, mS] = horaSalida.split(':').map(Number);

    const entradaFrac = (hE + mE / 60) / 24;
    let salidaFrac = (hS + mS / 60) / 24;

    let horas;
    if (salidaFrac < entradaFrac) {
        // el turno cruza la medianoche
        horas = ((salidaFrac + 1) - entradaFrac) * 24;
    } else {
        horas = (salidaFrac - entradaFrac) * 24;
    }
    return Math.round(horas * 100) / 100;
}

/**
 * Determina las horas ordinarias (jornada legal) para el periodo
 * COMPLETO de la planilla, no solo una semana. Codigo de Trabajo de
 * Honduras: Diurna = 44 h/semana, Nocturna = 36 h/semana, Mixta = 42
 * h/semana — para planillas Quincenales o Mensuales (que cubren mas de
 * una semana calendario), el umbral de horas ordinarias debe
 * multiplicarse por la cantidad de semanas que cubre el periodo, o de
 * lo contrario CUALQUIER planilla de mas de 7 dias marcaria casi todas
 * las horas trabajadas como "extra" por error.
 *
 * @param {number} numSemanas - Cantidad de semanas que cubre el periodo
 *   de la planilla (1 para semanal, ~2 para quincenal de 14 dias, etc).
 *   Se calcula con calcularNumSemanas() a partir del rango de fechas.
 */
function horasOrdinariasPorJornada(tipoJornada, cfg, numSemanas = 1) {
    const map = {
        DIURNA: cfg.horas_jornada_diurna,
        NOCTURNA: cfg.horas_jornada_nocturna,
        MIXTA: cfg.horas_jornada_mixta
    };
    const horasSemanales = map[tipoJornada] ?? cfg.horas_jornada_diurna;
    return round2(horasSemanales * numSemanas);
}

/**
 * Calcula cuantas semanas cubre un rango de fechas [inicio, fin]
 * (ambos inclusive), redondeando hacia arriba. Un rango de 7 dias = 1
 * semana, de 21 dias = 3 semanas, de 14 dias = 2 semanas. Se usa para
 * escalar las horas ordinarias en planillas Quincenales/Mensuales.
 */
function calcularNumSemanas(fechaInicio, fechaFin) {
    const inicio = new Date(fechaInicio + 'T00:00:00');
    const fin = new Date(fechaFin + 'T00:00:00');
    const dias = Math.round((fin - inicio) / 86400000) + 1; // +1 porque ambas fechas son inclusive
    return Math.max(1, Math.ceil(dias / 7));
}

/**
 * Calcula el resumen semanal de horas extra para un empleado, a partir
 * de las horas totales trabajadas en la semana y de los "buckets"
 * (franjas horarias) donde el usuario clasifico las horas extra.
 *
 * Formulas origen (Excel, hoja "HORAS LPS"):
 *   salario_diario = salario_mensual / 30
 *   salario_hora    = salario_diario / 8
 *   tarifa_25  = salario_hora * 1.25
 *   tarifa_50  = salario_hora * 1.50
 *   tarifa_75  = salario_hora * 1.75
 *   tarifa_100 = salario_hora * 2.00
 *   pago_bucket_x = horas_bucket_x * tarifa_x
 *   pago_total_extras = SUMA(pago_bucket_25..100)
 */
function calcularHorasExtraSemana({ salarioMensual, horasTotales, tipoJornada, buckets, numSemanas = 1 }) {
    const cfg = getConfig();
    const horasOrdinarias = horasOrdinariasPorJornada(tipoJornada, cfg, numSemanas);
    const horasExtraTotal = Math.max(0, round2(horasTotales - horasOrdinarias));

    const salarioDiario = salarioMensual / cfg.dias_mes_planilla;
    const salarioHora = salarioDiario / 8;

    const tarifa25 = salarioHora * cfg.recargo_25;
    const tarifa50 = salarioHora * cfg.recargo_50;
    const tarifa75 = salarioHora * cfg.recargo_75;
    const tarifa100 = salarioHora * cfg.recargo_100;

    const h25 = buckets?.bucket_25 || 0;
    const h50 = buckets?.bucket_50 || 0;
    const h75 = buckets?.bucket_75 || 0;
    const h100 = buckets?.bucket_100 || 0;

    const pago25 = round2(h25 * tarifa25);
    const pago50 = round2(h50 * tarifa50);
    const pago75 = round2(h75 * tarifa75);
    const pago100 = round2(h100 * tarifa100);

    return {
        horasOrdinarias,
        horasExtraTotal,
        salarioDiario: round2(salarioDiario),
        salarioHora: round2(salarioHora),
        tarifas: { tarifa25, tarifa50, tarifa75, tarifa100 },
        horas: { h25, h50, h75, h100 },
        pagos: { pago25, pago50, pago75, pago100 },
        pagoTotalExtras: round2(pago25 + pago50 + pago75 + pago100)
    };
}

/**
 * Calcula el detalle de planilla de UN empleado para un periodo dado.
 * Formulas origen (Excel, hoja "PLANILLA"):
 *   salario_diario     = salario_mensual / 30
 *   salario_ordinario  = dias_trabajados * salario_diario
 *   septimo_dia_pago   = (1 si procede : 0) * salario_diario
 *   salario_total      = salario_ordinario + septimo_dia_pago
 *   sal_mas_he         = salario_total + horas_extras_pago
 *   subtotal_neto      = sal_mas_he - IHSS - RAP
 *   total_deducciones  = prestamos + vales + impuesto_vecinal + isr
 *   total_pagar        = subtotal_neto - total_deducciones + transporte
 *
 * IHSS y RAP se reciben como parametros (capturados por el usuario en
 * el formulario de Procesar Planilla) en vez de calcularse por
 * porcentaje: el monto oficial depende de una tabla de rangos
 * salariales del IHSS/RAP, no de un porcentaje plano, asi que es mas
 * confiable que el usuario digite el valor exacto de la tabla vigente.
 * calcularIhssRap() sigue disponible como sugerencia/estimado inicial.
 *
 * Transporte es un BENEFICIO (se suma, no se resta) por dias en que el
 * empleado salio a las 11:00pm o doblo turno hasta las 9:00pm — ver
 * calcularTransporte().
 *
 * El Septimo Dia (dia de descanso obligatorio) procede cuando el
 * empleado cumplio su semana laboral completa segun lo programado
 * (Art. 339-345 Codigo de Trabajo: si falto sin justificacion pierde
 * el derecho al pago de ese dia).
 */
function calcularDetalleEmpleado({
    salarioMensual,
    diasTrabajados,
    septimoDiaProcede,
    horasExtrasPago = 0,
    ihss = 0,
    rap = 0,
    prestamos = 0,
    vales = 0,
    impuestoVecinal = 0,
    isr = 0,
    transporte = 0
}) {
    const cfg = getConfig();

    const salarioDiario = round2(salarioMensual / cfg.dias_mes_planilla);
    const salarioOrdinario = round2(diasTrabajados * salarioDiario);
    const septimoDiaPago = round2((septimoDiaProcede ? 1 : 0) * salarioDiario);
    const salarioTotal = round2(salarioOrdinario + septimoDiaPago);
    const salMasHE = round2(salarioTotal + horasExtrasPago);

    const subtotalNeto = round2(salMasHE - ihss - rap);
    const totalDeducciones = round2(prestamos + vales + impuestoVecinal + isr);
    const totalPagar = round2(subtotalNeto - totalDeducciones + transporte);

    return {
        salarioDiario,
        salarioOrdinario,
        septimoDiaPago,
        salarioTotal,
        salMasHE,
        ihss: round2(ihss),
        rap: round2(rap),
        subtotalNeto,
        totalDeducciones,
        transporte: round2(transporte),
        totalPagar
    };
}

/**
 * Beneficio de Transporte: L.100 por cada dia en que el empleado salio
 * a las 11:00pm, mas L.50 por cada dia de doble turno (jornada partida
 * que se extiende hasta las 9:00pm). Tarifas fijas segun politica de
 * la empresa (ajustalas aqui si cambian).
 */
const TRANSPORTE_TARIFA_SALIDA_11PM = 100;
const TRANSPORTE_TARIFA_DOBLE_TURNO = 50;

function calcularTransporte({ diasSalida11pm = 0, diasDobleTurno = 0 }) {
    return round2((diasSalida11pm * TRANSPORTE_TARIFA_SALIDA_11PM) + (diasDobleTurno * TRANSPORTE_TARIFA_DOBLE_TURNO));
}

/**
 * IHSS y RAP: calculo por porcentaje sobre el salario devengado del
 * periodo, respetando el techo salarial (cotizacion maxima).
 * ADVERTENCIA: verifica el porcentaje y el techo vigentes en la tabla
 * oficial del IHSS/RAP antes de usar en produccion; se configuran en
 * el modulo Configuracion, no estan fijos en el codigo.
 */
function calcularIhssRap(baseGravable, cfg) {
    const baseIhss = Math.min(baseGravable, cfg.ihss_techo_salarial);
    const baseRap = Math.min(baseGravable, cfg.rap_techo_salarial);

    const ihss = round2(baseIhss * cfg.ihss_porcentaje_empleado);
    const rap = round2(baseRap * cfg.rap_porcentaje_empleado);

    return { ihss, rap };
}

function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

module.exports = {
    getConfig,
    calcularHorasTrabajadas,
    horasOrdinariasPorJornada,
    calcularNumSemanas,
    calcularHorasExtraSemana,
    calcularDetalleEmpleado,
    calcularIhssRap,
    calcularTransporte,
    round2
};
