// =====================================================================
// uploads.js
// Resuelve la carpeta donde se guardan archivos subidos (ej. fotos de
// evidencia del Reloj de Asistencia), usando el MISMO volumen
// persistente donde vive la base de datos (para que sobrevivan a los
// redeploys de Railway, igual que nominacore.db).
// =====================================================================
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'nominacore.db');
const UPLOADS_DIR = path.join(path.dirname(DB_PATH), 'uploads');

function carpetaAsistencia() {
    const dir = path.join(UPLOADS_DIR, 'asistencia');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

module.exports = { UPLOADS_DIR, carpetaAsistencia };
