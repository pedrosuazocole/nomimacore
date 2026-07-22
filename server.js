require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;

// =====================================================================
// RED DE SEGURIDAD GLOBAL: un error que se escape de algun controlador
// (sin su propio try/catch) YA NO tumba el proceso completo para todos
// los usuarios — se registra en el log y el servidor sigue funcionando.
// Esto es ademas de (no en vez de) arreglar el try/catch en cada
// controlador; es la ultima linea de defensa.
// =====================================================================
process.on('uncaughtException', (err) => {
    console.error('💥 uncaughtException (el servidor SIGUE corriendo):', err);
});
process.on('unhandledRejection', (err) => {
    console.error('💥 unhandledRejection (el servidor SIGUE corriendo):', err);
});

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
    } else {
        // La BD ya existe (ej. Railway con volumen persistente): schema.sql
        // no le agrega columnas nuevas a tablas existentes, asi que se
        // corre una migracion ligera que si lo hace, sin tocar los datos.
        const { migrarColumnasFaltantes } = require('./src/database/migrate-columns.js');
        const db = require('./src/config/db');
        migrarColumnasFaltantes(db);

        // Verificacion explicita: confirma en el log que las columnas
        // criticas del Reloj de Asistencia SI quedaron creadas, para que
        // sea obvio en los logs de Railway si algo no se aplico.
        const columnas = db.prepare(`PRAGMA table_info(turnos_horarios)`).all().map(c => c.name);
        const tieneFotos = columnas.includes('foto_entrada') && columnas.includes('foto_salida');
        console.log(tieneFotos
            ? '✅ Verificado: turnos_horarios tiene foto_entrada/foto_salida.'
            : '⚠️ ALERTA: turnos_horarios NO tiene foto_entrada/foto_salida — revisa que migrate-columns.js este actualizado y desplegado.');
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
