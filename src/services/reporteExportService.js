// =====================================================================
// reporteExportService.js
// Genera archivos .xlsx a partir de datos tabulares genericos, para
// que cualquier reporte pueda ofrecer "Exportar a Excel" con el mismo
// helper (encabezados en negrita, autoancho de columnas, fila de
// totales opcional).
// =====================================================================

const XLSX = require('xlsx');

/**
 * @param {string} titulo - Titulo mostrado en la primera fila de la hoja
 * @param {string[]} headers - Encabezados de columna
 * @param {Array<Array>} filas - Filas de datos (array de arrays, mismo orden que headers)
 * @param {Array} [totales] - Fila opcional de totales al final (mismo orden que headers)
 * @returns {Buffer}
 */
function exportarExcel({ titulo, subtitulo, headers, filas, totales }) {
    const aoa = [];
    aoa.push([titulo]);
    if (subtitulo) aoa.push([subtitulo]);
    aoa.push([]);
    aoa.push(headers);
    filas.forEach(f => aoa.push(f));
    if (totales) {
        aoa.push([]);
        aoa.push(totales);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map((h, i) => {
        const maxLen = Math.max(
            String(h).length,
            ...filas.map(f => String(f[i] ?? '').length)
        );
        return { wch: Math.min(Math.max(maxLen + 2, 10), 45) };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function enviarExcel(res, filename, opciones) {
    const buffer = exportarExcel(opciones);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
}

module.exports = { exportarExcel, enviarExcel };
