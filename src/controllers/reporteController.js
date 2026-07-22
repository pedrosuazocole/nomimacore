const db = require('../config/db');
const EmpleadoModel = require('../models/empleadoModel');
const { enviarExcel } = require('../services/reporteExportService');

// Rango por defecto cuando el usuario todavia no ha filtrado nada:
// el mes calendario actual, para que el reporte nunca cargue vacio.
function rangoPorDefecto() {
    const hoy = new Date();
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { inicio, fin };
}

function empresasDisponibles() {
    return db.prepare(`SELECT DISTINCT empresa FROM planillas WHERE empresa IS NOT NULL AND empresa != '' ORDER BY empresa`).all().map(r => r.empresa);
}

const ReporteController = {
    index(req, res) {
        res.render('reportes/index', { title: 'Reportes' });
    },

    // =================================================================
    // 1. RESUMEN DE PLANILLAS POR PERIODO
    // =================================================================
    planillas(req, res) {
        const def = rangoPorDefecto();
        const f = {
            fecha_inicio: req.query.fecha_inicio || def.inicio,
            fecha_fin: req.query.fecha_fin || def.fin,
            tipo_periodo: req.query.tipo_periodo || '',
            empresa: req.query.empresa || '',
            estado: req.query.estado || ''
        };

        const { where, params } = construirFiltros([
            ['fecha_inicio >= ?', f.fecha_inicio],
            ['fecha_fin <= ?', f.fecha_fin],
            ['tipo_periodo = ?', f.tipo_periodo],
            ['empresa = ?', f.empresa],
            ['estado = ?', f.estado]
        ]);

        const filas = db.prepare(`SELECT * FROM planillas ${where} ORDER BY fecha_inicio DESC`).all(...params);
        const totales = sumarColumnas(filas, ['total_salarios', 'total_extras', 'total_deducciones', 'total_pagar']);

        if (req.query.export === 'xlsx') {
            return enviarExcel(res, 'reporte-planillas.xlsx', {
                titulo: 'Resumen de Planillas por Periodo',
                subtitulo: `${f.fecha_inicio} al ${f.fecha_fin}`,
                headers: ['Nombre', 'Tipo', 'Empresa', 'Fecha Inicio', 'Fecha Fin', 'Estado', 'Total Salarios', 'Total Extras', 'Total Deducciones', 'Total a Pagar'],
                filas: filas.map(p => [p.nombre, p.tipo_periodo, p.empresa, p.fecha_inicio, p.fecha_fin, p.estado, p.total_salarios, p.total_extras, p.total_deducciones, p.total_pagar]),
                totales: ['', '', '', '', '', 'TOTALES', totales.total_salarios, totales.total_extras, totales.total_deducciones, totales.total_pagar]
            });
        }

        res.render('reportes/planillas', { title: 'Reporte de Planillas', filas, totales, filtros: f, empresas: empresasDisponibles() });
    },

    // =================================================================
    // 2. REPORTE CONTABLE / ASIENTO DE NOMINA (para contabilizar)
    // =================================================================
    contable(req, res) {
        const def = rangoPorDefecto();
        const f = {
            fecha_inicio: req.query.fecha_inicio || def.inicio,
            fecha_fin: req.query.fecha_fin || def.fin,
            empresa: req.query.empresa || ''
        };

        const { where, params } = construirFiltros([
            ['p.fecha_inicio >= ?', f.fecha_inicio],
            ['p.fecha_fin <= ?', f.fecha_fin],
            ['p.empresa = ?', f.empresa]
        ]);

        const detalle = db.prepare(`
            SELECT pd.*, e.nombre_completo, e.cuenta_contable, e.codigo_contable, p.nombre AS planilla_nombre, p.empresa
            FROM planilla_detalle pd
            JOIN planillas p ON p.id = pd.planilla_id
            JOIN empleados e ON e.id = pd.empleado_id
            ${where}
            ORDER BY p.fecha_inicio, e.nombre_completo
        `).all(...params);

        const planillasIncluidas = db.prepare(`
            SELECT DISTINCT p.id, p.nombre, p.fecha_inicio, p.fecha_fin
            FROM planillas p
            WHERE p.fecha_inicio >= ? AND p.fecha_fin <= ? AND (p.empresa = ? OR ? = '')
            ORDER BY p.fecha_inicio
        `).all(f.fecha_inicio, f.fecha_fin, f.empresa, f.empresa);

        const cuentas = {
            salarioOrdinario: sumarCampo(detalle, 'salario_ordinario') + sumarCampo(detalle, 'septimo_dia_pago'),
            salarioExtraordinario: sumarCampo(detalle, 'horas_extras_pago'),
            transporte: sumarCampo(detalle, 'transporte'),
            ihss: sumarCampo(detalle, 'ihss'),
            rap: sumarCampo(detalle, 'rap'),
            prestamos: sumarCampo(detalle, 'prestamos'),
            vales: sumarCampo(detalle, 'vales'),
            impuestoVecinal: sumarCampo(detalle, 'impuesto_vecinal'),
            isr: sumarCampo(detalle, 'isr'),
            totalPagado: sumarCampo(detalle, 'total_pagar')
        };
        cuentas.totalGasto = round2(cuentas.salarioOrdinario + cuentas.salarioExtraordinario + cuentas.transporte);
        cuentas.totalRetenciones = round2(cuentas.ihss + cuentas.rap + cuentas.prestamos + cuentas.vales + cuentas.impuestoVecinal + cuentas.isr);

        if (req.query.export === 'xlsx') {
            return enviarExcel(res, 'reporte-contable-nomina.xlsx', {
                titulo: 'Reporte Contable de Nomina',
                subtitulo: `${f.fecha_inicio} al ${f.fecha_fin}${f.empresa ? ' - ' + f.empresa : ''}`,
                headers: ['Empleado', 'Codigo/Cuenta', 'Planilla', 'Salario Ordinario', 'Horas Extra', 'Transporte', 'IHSS', 'RAP', 'Prestamos', 'Vales', 'Imp. Vecinal', 'ISR', 'Total Pagado'],
                filas: detalle.map(d => [
                    d.nombre_completo, d.cuenta_contable || d.codigo_contable || '', d.planilla_nombre,
                    round2(d.salario_ordinario + d.septimo_dia_pago), d.horas_extras_pago, (d.transporte || 0), d.ihss, d.rap,
                    d.prestamos, d.vales, d.impuesto_vecinal, d.isr, d.total_pagar
                ]),
                totales: ['TOTALES', '', '', cuentas.salarioOrdinario, cuentas.salarioExtraordinario, cuentas.transporte, cuentas.ihss, cuentas.rap, cuentas.prestamos, cuentas.vales, cuentas.impuestoVecinal, cuentas.isr, cuentas.totalPagado]
            });
        }

        res.render('reportes/contable', { title: 'Reporte Contable', detalle, cuentas, planillasIncluidas, filtros: f, empresas: empresasDisponibles() });
    },

    // =================================================================
    // 2b. ASIENTO CONTABLE (partida doble: Codigo | Cuenta | Debe | Haber)
    // Reutiliza la misma consulta de "contable" pero arma las lineas en
    // formato de asiento listo para trasladar al sistema contable.
    // =================================================================
    asiento(req, res) {
        const def = rangoPorDefecto();
        const f = {
            fecha_inicio: req.query.fecha_inicio || def.inicio,
            fecha_fin: req.query.fecha_fin || def.fin,
            empresa: req.query.empresa || ''
        };

        const cfgCuentas = db.prepare('SELECT * FROM configuracion WHERE id = 1').get();

        const { where, params } = construirFiltros([
            ['p.fecha_inicio >= ?', f.fecha_inicio],
            ['p.fecha_fin <= ?', f.fecha_fin],
            ['p.empresa = ?', f.empresa]
        ]);

        const detalle = db.prepare(`
            SELECT pd.*, e.nombre_completo, e.cuenta_contable, e.codigo_contable, p.nombre AS planilla_nombre, p.empresa
            FROM planilla_detalle pd
            JOIN planillas p ON p.id = pd.planilla_id
            JOIN empleados e ON e.id = pd.empleado_id
            ${where}
            ORDER BY p.fecha_inicio, e.nombre_completo
        `).all(...params);

        const planillasIncluidas = db.prepare(`
            SELECT DISTINCT p.id, p.nombre, p.fecha_inicio, p.fecha_fin
            FROM planillas p
            WHERE p.fecha_inicio >= ? AND p.fecha_fin <= ? AND (p.empresa = ? OR ? = '')
            ORDER BY p.fecha_inicio
        `).all(f.fecha_inicio, f.fecha_fin, f.empresa, f.empresa);

        const totSalOrd = sumarCampo(detalle, 'salario_ordinario') + sumarCampo(detalle, 'septimo_dia_pago');
        const totSalExtra = sumarCampo(detalle, 'horas_extras_pago');
        const totTransporte = sumarCampo(detalle, 'transporte');
        const totIhss = sumarCampo(detalle, 'ihss');
        const totRap = sumarCampo(detalle, 'rap');
        const totImpVecinal = sumarCampo(detalle, 'impuesto_vecinal');
        const totIsr = sumarCampo(detalle, 'isr');
        const totBanco = sumarCampo(detalle, 'total_pagar');

        // Construir las lineas del asiento (partida doble): cada linea es
        // { codigo, cuenta, debe, haber }. El Debe y el Haber deben cuadrar.
        const lineas = [];
        if (totSalOrd > 0) lineas.push({ codigo: cfgCuentas.cuenta_salario_ordinario, cuenta: 'Salario Ordinario y Septimo Dia', debe: totSalOrd, haber: 0 });
        if (totSalExtra > 0) lineas.push({ codigo: cfgCuentas.cuenta_salario_extraordinario, cuenta: 'Salario Extraordinario (Horas Extra)', debe: totSalExtra, haber: 0 });
        if (totTransporte > 0) lineas.push({ codigo: cfgCuentas.cuenta_transporte, cuenta: 'Transporte', debe: totTransporte, haber: 0 });

        if (totIhss > 0) lineas.push({ codigo: cfgCuentas.cuenta_ihss, cuenta: 'IHSS por Pagar', debe: 0, haber: totIhss });
        if (totRap > 0) lineas.push({ codigo: cfgCuentas.cuenta_rap, cuenta: 'RAP por Pagar', debe: 0, haber: totRap });
        if (totImpVecinal > 0) lineas.push({ codigo: cfgCuentas.cuenta_impuesto_vecinal, cuenta: 'Impuesto Vecinal por Pagar', debe: 0, haber: totImpVecinal });
        if (totIsr > 0) lineas.push({ codigo: cfgCuentas.cuenta_isr, cuenta: 'ISR por Pagar', debe: 0, haber: totIsr });

        // Prestamos y Vales: uno por empleado, usando su propia cuenta
        // contable (cuenta por cobrar a ese empleado especifico), igual
        // que en la hoja de referencia del cliente.
        detalle.forEach(d => {
            const cuentaEmpleado = d.cuenta_contable || d.codigo_contable || `(sin cuenta) ${d.nombre_completo}`;
            if (d.prestamos > 0) lineas.push({ codigo: cuentaEmpleado, cuenta: `Prestamo Recuperado - ${d.nombre_completo}`, debe: 0, haber: d.prestamos });
            if (d.vales > 0) lineas.push({ codigo: cuentaEmpleado, cuenta: `Vale Recuperado - ${d.nombre_completo}`, debe: 0, haber: d.vales });
        });

        if (totBanco > 0) lineas.push({ codigo: cfgCuentas.cuenta_banco, cuenta: 'Efectivo / Banco (Neto Pagado)', debe: 0, haber: totBanco });

        const totalDebe = round2(lineas.reduce((acc, l) => acc + l.debe, 0));
        const totalHaber = round2(lineas.reduce((acc, l) => acc + l.haber, 0));
        const cuadra = Math.abs(totalDebe - totalHaber) < 0.02; // tolerancia de 1-2 centavos por redondeo

        if (req.query.export === 'xlsx') {
            return enviarExcel(res, 'asiento-contable.xlsx', {
                titulo: 'Asiento Contable de Nomina',
                subtitulo: `${f.fecha_inicio} al ${f.fecha_fin}${f.empresa ? ' - ' + f.empresa : ''}`,
                headers: ['Codigo de Cuenta', 'Cuenta', 'Debe', 'Haber'],
                filas: lineas.map(l => [l.codigo, l.cuenta, l.debe || '', l.haber || '']),
                totales: ['', 'TOTALES', totalDebe, totalHaber]
            });
        }

        res.render('reportes/asiento', {
            title: 'Asiento Contable',
            lineas, totalDebe, totalHaber, cuadra,
            planillasIncluidas, filtros: f, empresas: empresasDisponibles()
        });
    },

    // =================================================================
    // 3. REPORTE DE HORAS EXTRA (desglose por franja/recargo)
    // =================================================================
    horasExtra(req, res) {
        const def = rangoPorDefecto();
        const f = {
            fecha_inicio: req.query.fecha_inicio || def.inicio,
            fecha_fin: req.query.fecha_fin || def.fin,
            empleado_id: req.query.empleado_id || '',
            departamento: req.query.departamento || ''
        };

        const { where, params } = construirFiltros([
            ['hes.semana_inicio >= ?', f.fecha_inicio],
            ['hes.semana_fin <= ?', f.fecha_fin],
            ['hes.empleado_id = ?', f.empleado_id],
            ['e.departamento = ?', f.departamento]
        ]);

        const filas = db.prepare(`
            SELECT hes.*, e.nombre_completo, e.departamento
            FROM horas_extras_semanal hes
            JOIN empleados e ON e.id = hes.empleado_id
            ${where}
            ORDER BY hes.semana_inicio DESC, e.nombre_completo
        `).all(...params);

        const totales = sumarColumnas(filas, ['horas_extras_total', 'horas_bucket_25', 'horas_bucket_50', 'horas_bucket_75', 'horas_bucket_100', 'pago_total_extras']);

        if (req.query.export === 'xlsx') {
            return enviarExcel(res, 'reporte-horas-extra.xlsx', {
                titulo: 'Reporte de Horas Extra',
                subtitulo: `${f.fecha_inicio} al ${f.fecha_fin}`,
                headers: ['Empleado', 'Departamento', 'Periodo', 'Horas Extra Totales', '25% (2pm-7pm)', '50% (7pm-9pm)', '75% (Nocturno)', '100% (Feriado)', 'Pago Total Extras'],
                filas: filas.map(r => [r.nombre_completo, r.departamento, `${r.semana_inicio} al ${r.semana_fin}`, r.horas_extras_total, r.horas_bucket_25, r.horas_bucket_50, r.horas_bucket_75, r.horas_bucket_100, r.pago_total_extras]),
                totales: ['TOTALES', '', '', totales.horas_extras_total, totales.horas_bucket_25, totales.horas_bucket_50, totales.horas_bucket_75, totales.horas_bucket_100, totales.pago_total_extras]
            });
        }

        res.render('reportes/horas_extra', { title: 'Reporte de Horas Extra', filas, totales, filtros: f, empleados: EmpleadoModel.listar(), departamentos: EmpleadoModel.departamentos() });
    },

    // =================================================================
    // 4. REPORTE DE DEDUCCIONES
    // =================================================================
    deducciones(req, res) {
        const def = rangoPorDefecto();
        const f = {
            fecha_inicio: req.query.fecha_inicio || def.inicio,
            fecha_fin: req.query.fecha_fin || def.fin,
            tipo: req.query.tipo || 'TODOS',
            empresa: req.query.empresa || ''
        };

        const condiciones = [
            ['p.fecha_inicio >= ?', f.fecha_inicio],
            ['p.fecha_fin <= ?', f.fecha_fin],
            ['p.empresa = ?', f.empresa]
        ];
        const columnaFiltro = { IHSS: 'pd.ihss', RAP: 'pd.rap', PRESTAMOS: 'pd.prestamos', VALES: 'pd.vales', IMPUESTO_VECINAL: 'pd.impuesto_vecinal', ISR: 'pd.isr' }[f.tipo];
        if (columnaFiltro) condiciones.push([`${columnaFiltro} > 0`, null]);

        const { where, params } = construirFiltros(condiciones);

        const filas = db.prepare(`
            SELECT pd.*, e.nombre_completo, e.departamento, p.nombre AS planilla_nombre, p.fecha_inicio, p.fecha_fin
            FROM planilla_detalle pd
            JOIN planillas p ON p.id = pd.planilla_id
            JOIN empleados e ON e.id = pd.empleado_id
            ${where}
            ORDER BY p.fecha_inicio DESC, e.nombre_completo
        `).all(...params);

        const totales = sumarColumnas(filas, ['ihss', 'rap', 'prestamos', 'vales', 'impuesto_vecinal', 'isr', 'total_deducciones']);

        if (req.query.export === 'xlsx') {
            return enviarExcel(res, 'reporte-deducciones.xlsx', {
                titulo: 'Reporte de Deducciones',
                subtitulo: `${f.fecha_inicio} al ${f.fecha_fin} - Tipo: ${f.tipo}`,
                headers: ['Empleado', 'Departamento', 'Periodo', 'IHSS', 'RAP', 'Prestamos', 'Vales', 'Imp. Vecinal', 'ISR', 'Total Deducciones'],
                filas: filas.map(r => [r.nombre_completo, r.departamento, `${r.fecha_inicio} al ${r.fecha_fin}`, r.ihss, r.rap, r.prestamos, r.vales, r.impuesto_vecinal, r.isr, r.total_deducciones]),
                totales: ['TOTALES', '', '', totales.ihss, totales.rap, totales.prestamos, totales.vales, totales.impuesto_vecinal, totales.isr, totales.total_deducciones]
            });
        }

        res.render('reportes/deducciones', { title: 'Reporte de Deducciones', filas, totales, filtros: f, empresas: empresasDisponibles() });
    },

    // =================================================================
    // 5. HISTORIAL INDIVIDUAL DE EMPLEADO (constancia de ingresos)
    // =================================================================
    empleado(req, res) {
        const def = rangoPorDefecto();
        const f = {
            empleado_id: req.query.empleado_id || '',
            fecha_inicio: req.query.fecha_inicio || `${new Date().getFullYear()}-01-01`,
            fecha_fin: req.query.fecha_fin || def.fin
        };

        let filas = [];
        let totales = null;
        let empleadoSel = null;

        if (f.empleado_id) {
            empleadoSel = EmpleadoModel.obtener(f.empleado_id);
            filas = db.prepare(`
                SELECT pd.*, p.nombre AS planilla_nombre, p.tipo_periodo, p.fecha_inicio, p.fecha_fin
                FROM planilla_detalle pd
                JOIN planillas p ON p.id = pd.planilla_id
                WHERE pd.empleado_id = ? AND p.fecha_inicio >= ? AND p.fecha_fin <= ?
                ORDER BY p.fecha_inicio
            `).all(f.empleado_id, f.fecha_inicio, f.fecha_fin);
            totales = sumarColumnas(filas, ['salario_ordinario', 'septimo_dia_pago', 'horas_extras_pago', 'ihss', 'rap', 'total_deducciones', 'total_pagar']);
        }

        if (req.query.export === 'xlsx' && empleadoSel) {
            return enviarExcel(res, `historial-${empleadoSel.nombre_completo.replace(/\s+/g, '-')}.xlsx`, {
                titulo: `Historial de Ingresos - ${empleadoSel.nombre_completo}`,
                subtitulo: `${f.fecha_inicio} al ${f.fecha_fin}`,
                headers: ['Planilla', 'Periodo', 'Fechas', 'Salario Ordinario', '7mo Dia', 'Horas Extra', 'IHSS', 'RAP', 'Total Deducciones', 'Total Pagado'],
                filas: filas.map(r => [r.planilla_nombre, r.tipo_periodo, `${r.fecha_inicio} al ${r.fecha_fin}`, r.salario_ordinario, r.septimo_dia_pago, r.horas_extras_pago, r.ihss, r.rap, r.total_deducciones, r.total_pagar]),
                totales: ['TOTALES', '', '', totales.salario_ordinario, totales.septimo_dia_pago, totales.horas_extras_pago, totales.ihss, totales.rap, totales.total_deducciones, totales.total_pagar]
            });
        }

        res.render('reportes/empleado', { title: 'Historial de Empleado', filas, totales, empleadoSel, filtros: f, empleados: EmpleadoModel.listar() });
    },

    // =================================================================
    // 6. PADRON DE EMPLEADOS
    // =================================================================
    // =================================================================
    // 7. REPORTE DE MARCAS DE ASISTENCIA DIARIA (con foto de evidencia)
    // =================================================================
    asistencia(req, res) {
        // Honduras es siempre UTC-6 (sin horario de verano) — se usa el
        // mismo desfase fijo que el Reloj de Asistencia (turnoModel.js),
        // para que el filtro "hoy" por defecto coincida con la fecha con
        // la que realmente se guardaron las marcas, incluso cerca de la
        // medianoche donde la fecha UTC del servidor ya cambio de dia.
        const hoy = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const f = {
            fecha_inicio: req.query.fecha_inicio || hoy,
            fecha_fin: req.query.fecha_fin || hoy,
            empleado_id: req.query.empleado_id || '',
            departamento: req.query.departamento || ''
        };

        const { where, params } = construirFiltros([
            ['t.fecha >= ?', f.fecha_inicio],
            ['t.fecha <= ?', f.fecha_fin],
            ['t.empleado_id = ?', f.empleado_id],
            ['e.departamento = ?', f.departamento]
        ]);

        const filas = db.prepare(`
            SELECT t.*, e.nombre_completo, e.departamento
            FROM turnos_horarios t
            JOIN empleados e ON e.id = t.empleado_id
            ${where}
            ORDER BY t.fecha DESC, e.nombre_completo
        `).all(...params);

        const totales = {
            registros: filas.length,
            horas: round2(filas.reduce((acc, f) => acc + (Number(f.horas_trabajadas) || 0), 0)),
            conFoto: filas.filter(f => f.foto_entrada || f.foto_salida).length
        };

        if (req.query.export === 'xlsx') {
            return enviarExcel(res, 'reporte-asistencia.xlsx', {
                titulo: 'Reporte de Marcas de Asistencia',
                subtitulo: `${f.fecha_inicio} al ${f.fecha_fin} (solo datos, sin fotos)`,
                headers: ['Empleado', 'Departamento', 'Fecha', 'Hora Entrada', 'Hora Salida', 'Horas Trabajadas', 'Tiene Foto Entrada', 'Tiene Foto Salida'],
                filas: filas.map(r => [
                    r.nombre_completo, r.departamento, r.fecha,
                    r.hora_entrada_real || '—', r.hora_salida_real || '—', r.horas_trabajadas || 0,
                    r.foto_entrada ? 'Si' : 'No', r.foto_salida ? 'Si' : 'No'
                ]),
                totales: ['TOTALES', '', '', '', '', totales.horas, '', '']
            });
        }

        res.render('reportes/asistencia', {
            title: 'Marcas de Asistencia',
            filas, totales, filtros: f,
            empleados: EmpleadoModel.listar(),
            departamentos: EmpleadoModel.departamentos()
        });
    },

    padron(req, res) {
        const f = {
            estado: req.query.estado || 'ACTIVO',
            departamento: req.query.departamento || '',
            empresa: req.query.empresa || '',
            tipo_jornada: req.query.tipo_jornada || ''
        };

        const { where, params } = construirFiltros([
            ['estado = ?', f.estado],
            ['departamento = ?', f.departamento],
            ['empresa = ?', f.empresa],
            ['tipo_jornada = ?', f.tipo_jornada]
        ]);

        const filas = db.prepare(`SELECT * FROM empleados ${where} ORDER BY departamento, nombre_completo`).all(...params);

        if (req.query.export === 'xlsx') {
            return enviarExcel(res, 'padron-empleados.xlsx', {
                titulo: 'Padron de Empleados',
                subtitulo: `Estado: ${f.estado || 'Todos'}`,
                headers: ['Nombre', 'Codigo Contable', 'Departamento', 'Cargo', 'Empresa', 'Cuenta Contable', 'Salario Base', 'Tipo Pago', 'Jornada', 'Fecha Ingreso', 'Estado'],
                filas: filas.map(e => [e.nombre_completo, e.codigo_contable, e.departamento, e.cargo, e.empresa, e.cuenta_contable, e.salario_base, e.tipo_pago, e.tipo_jornada, e.fecha_ingreso, e.estado])
            });
        }

        res.render('reportes/padron', { title: 'Padron de Empleados', filas, filtros: f, departamentos: EmpleadoModel.departamentos(), empresas: empresasDisponibles() });
    }
};

// =====================================================================
// Helpers de consulta
// =====================================================================
function construirFiltros(condiciones) {
    const where = [];
    const params = [];
    for (const [clausula, valor] of condiciones) {
        if (valor === null) {
            where.push(clausula); // condicion fija sin parametro, ej: "pd.ihss > 0"
        } else if (valor !== '' && valor !== undefined) {
            where.push(clausula);
            params.push(valor);
        }
    }
    return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

function sumarColumnas(filas, columnas) {
    const totales = {};
    columnas.forEach(c => { totales[c] = round2(filas.reduce((acc, f) => acc + (Number(f[c]) || 0), 0)); });
    return totales;
}

function sumarCampo(filas, campo) {
    return round2(filas.reduce((acc, f) => acc + (Number(f[campo]) || 0), 0));
}

function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

module.exports = ReporteController;
