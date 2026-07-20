require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;

// Auto-inicializa la base de datos si no existe todavia (primer arranque
// en Railway, o entorno local recien clonado) para que "npm start" nunca
// falle por falta de tablas. La migracion es async porque crea el
// usuario ADMIN por defecto con bcrypt.
async function asegurarBaseDeDatos() {
    const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'nominacore.db');
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

    const existeYaConTablas = fs.existsSync(dbPath) && (() => {
        try {
            const tmp = new Database(dbPath, { readonly: true });
            const row = tmp.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='empleados'`).get();
            tmp.close();
            return !!row;
        } catch {
            return false;
        }
    })();

    if (!existeYaConTablas) {
        console.log('🆕 Base de datos nueva detectada, ejecutando migracion inicial...');
        const init = require('./src/database/init.js');
        await init();
    }
}

(async () => {
    await asegurarBaseDeDatos();
    const app = require('./src/app');
    app.listen(PORT, () => {
        console.log('🚀 NominaCore HN corriendo en el puerto', PORT);
        console.log('🌐 http://localhost:' + PORT);
    });
})();
