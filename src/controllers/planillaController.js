const PlanillaModel = require('../models/planillaModel');
const EmpleadoModel = require('../models/empleadoModel');
const TurnoModel = require('../models/turnoModel');
const db = require('../config/db');
const {
    calcularHorasExtraSemana,
    calcularDetalleEmpleado,
    horasOrdinariasPorJornada,
    getConfig
} = require('../services/calculoService');

const PlanillaController = {
    index(req, res) {
        const planillas = PlanillaModel.listar({ tipoPeriodo: req.query.tipo });
        res.render('planillas/index', { title: 'Planillas', planillas, filtros: { tipo: req.query.tipo } });
    },

    nuevaForm(req, res) {
        res.render('planillas/nueva', { title: 'Nueva Planilla', errores: [] });
    },

    crear(req, res) {
        const { nombre, empresa, tipo_periodo, fecha_inicio, fecha_fin } = req.body;
        if (!nombre || !tipo_periodo || !fecha_inicio || !fecha_fin) {
            return res.status(400).render('planillas/nueva', {
                title: 'Nueva Planilla',
                errores: ['Todos los campos son obligatorios.']
            });
        }
        if (new Date(fecha_fin) < new Date(fecha_inicio)) {
            return res.status(400).render('planillas/nueva', {
                title: 'Nueva Planilla',
                errores: ['La fecha fin no puede ser anterior a la fecha inicio.']
            });
        }
        const planilla = PlanillaModel.crear({ nombre, empresa, tipoPeriodo: tipo_periodo, fechaInicio: fecha_inicio, fechaFin: fecha_fin });
        res.redirect(`/planillas/${planilla.id}/procesar`);
    },

    /**
     * Pantalla de procesamiento: calcula automaticamente, a partir de
     * los turnos capturados, cuantos dias trabajo cada empleado y sus
     * horas extra; el usuario revisa/ajusta deducciones variables antes
     * de guardar el detalle final.
     */
    procesar(req, res) {
        const planilla = PlanillaModel.obtener(req.params.id);
        if (!planilla) return res.status(404).send('Planilla no encontrada');

        const empleadosActivos = EmpleadoModel.listar({ estado: 'ACTIVO' });
        const cfg = getConfig();

        const filas = empleadosActivos.map(emp => {
            const horasTotales = TurnoModel.totalHorasSemana(emp.id, planilla.fecha_inicio, planilla.fecha_fin);
            const diasTrabajados = TurnoModel.diasTrabajados(emp.id, planilla.fecha_inicio, planilla.fecha_fin);
            const horasOrdinarias = horasOrdinariasPorJornada(emp.tipo_jornada, cfg);
            const horasExtra = Math.max(0, +(horasTotales - horasOrdinarias).toFixed(2));

            const detalleExistente = PlanillaModel.detalleEmpleado(planilla.id, emp.id);

            return {
                empleado: emp,
                horasTotales,
                diasTrabajados,
                horasOrdinarias,
                horasExtra,
                detalleExistente
            };
        });

        res.render('planillas/procesar', {
            title: `Procesar: ${planilla.nombre}`,
            planilla,
            filas,
            cfg
        });
    },

    /**
     * Recibe el detalle ajustado por el usuario (dias trabajados, si
     * procede septimo dia, horas extra por franja, deducciones) y
     * corre el motor de calculo real para cada empleado.
     */
    guardarDetalle(req, res) {
        const planillaId = req.params.id;
        const planilla = PlanillaModel.obtener(planillaId);
        if (!planilla) return res.status(404).send('Planilla no encontrada');

        const filas = normalizarFilas(req.body);

        const transaccion = db.transaction((filas) => {
            for (const fila of filas) {
                const empleado = EmpleadoModel.obtener(fila.empleado_id);
                if (!empleado) continue;

                const extras = calcularHorasExtraSemana({
                    salarioMensual: empleado.salario_base,
                    horasTotales: fila.horas_totales,
                    tipoJornada: empleado.tipo_jornada,
                    buckets: {
                        bucket_25: fila.bucket_25,
                        bucket_50: fila.bucket_50,
                        bucket_75: fila.bucket_75,
                        bucket_100: fila.bucket_100
                    }
                });

                const calc = calcularDetalleEmpleado({
                    salarioMensual: empleado.salario_base,
                    diasTrabajados: fila.dias_trabajados,
                    septimoDiaProcede: fila.septimo_dia_procede,
                    horasExtrasPago: extras.pagoTotalExtras,
                    prestamos: fila.prestamos,
                    vales: fila.vales,
                    impuestoVecinal: fila.impuesto_vecinal,
                    isr: fila.isr
                });

                PlanillaModel.upsertHorasExtraSemana(empleado.id, planilla.fecha_inicio, planilla.fecha_fin, empleado.tipo_jornada, {
                    horas_totales: fila.horas_totales,
                    horas_ordinarias: extras.horasOrdinarias,
                    horas_extras_total: extras.horasExtraTotal,
                    horas_bucket_25: extras.horas.h25,
                    horas_bucket_50: extras.horas.h50,
                    horas_bucket_75: extras.horas.h75,
                    horas_bucket_100: extras.horas.h100,
                    pago_bucket_25: extras.pagos.pago25,
                    pago_bucket_50: extras.pagos.pago50,
                    pago_bucket_75: extras.pagos.pago75,
                    pago_bucket_100: extras.pagos.pago100,
                    pago_total_extras: extras.pagoTotalExtras,
                    septimo_dia_procede: fila.septimo_dia_procede ? 1 : 0
                });

                PlanillaModel.upsertDetalle(planillaId, empleado.id, {
                    salario_mensual: empleado.salario_base,
                    salario_diario: calc.salarioDiario,
                    dias_trabajados: fila.dias_trabajados,
                    septimo_dia_procede: fila.septimo_dia_procede ? 1 : 0,
                    salario_ordinario: calc.salarioOrdinario,
                    septimo_dia_pago: calc.septimoDiaPago,
                    salario_total: calc.salarioTotal,
                    horas_extras_horas: extras.horasExtraTotal,
                    horas_extras_pago: extras.pagoTotalExtras,
                    sal_mas_he: calc.salMasHE,
                    ihss: calc.ihss,
                    rap: calc.rap,
                    subtotal_neto: calc.subtotalNeto,
                    prestamos: fila.prestamos,
                    vales: fila.vales,
                    impuesto_vecinal: fila.impuesto_vecinal,
                    isr: fila.isr,
                    total_deducciones: calc.totalDeducciones,
                    total_pagar: calc.totalPagar
                });
            }
            PlanillaModel.cambiarEstado(planillaId, 'PROCESADA');
            PlanillaModel.actualizarTotales(planillaId);
        });

        try {
            transaccion(filas);
            res.redirect(`/planillas/${planillaId}/reporte`);
        } catch (err) {
            console.error('❌ Error calculando planilla:', err);
            res.status(500).send('Ocurrio un error calculando la planilla: ' + err.message);
        }
    },

    /**
     * Reporte final listo para vista previa / impresion (pantalla o
     * ticket), filtrable por el periodo ya definido en la planilla.
     */
    reporte(req, res) {
        const planilla = PlanillaModel.obtener(req.params.id);
        if (!planilla) return res.status(404).send('Planilla no encontrada');
        const detalle = PlanillaModel.detalle(planilla.id);
        const cfg = getConfig();

        res.render('planillas/reporte', {
            title: `Reporte - ${planilla.nombre}`,
            planilla,
            detalle,
            cfg,
            formato: req.query.formato || 'carta', // carta | ticket
            layout: false
        });
    },

    eliminar(req, res) {
        PlanillaModel.eliminar(req.params.id);
        res.redirect('/planillas?ok=Planilla eliminada');
    }
};

function normalizarFilas(body) {
    // El formulario envia campos indexados por empleado_id con prefijo
    // "emp_", ej: horas_totales[emp_12], dias_trabajados[emp_12]...
    // El prefijo es necesario porque la libreria "qs" (usada por
    // body-parser) interpreta claves puramente numericas entre corchetes
    // como INDICES DE ARREGLO en vez de llaves de objeto, lo que rompia
    // la asociacion con el empleado real cuando habia varias filas.
    const ids = [].concat(body.empleado_ids || []).map(Number);
    return ids.map(id => ({
        empleado_id: id,
        horas_totales: campo(body.horas_totales, id),
        dias_trabajados: campo(body.dias_trabajados, id),
        septimo_dia_procede: !!campo(body.septimo_dia_procede, id),
        bucket_25: campo(body.bucket_25, id),
        bucket_50: campo(body.bucket_50, id),
        bucket_75: campo(body.bucket_75, id),
        bucket_100: campo(body.bucket_100, id),
        prestamos: campo(body.prestamos, id),
        vales: campo(body.vales, id),
        impuesto_vecinal: campo(body.impuesto_vecinal, id),
        isr: campo(body.isr, id)
    }));
}

function campo(obj, id) {
    if (!obj) return 0;
    const val = obj[`emp_${id}`];
    return val ? Number(val) : 0;
}

module.exports = PlanillaController;
