// =====================================================================
// Inicializa (o migra) la base de datos ejecutando schema.sql.
// Es seguro correrlo varias veces: todo usa CREATE TABLE IF NOT EXISTS.
// Uso:  node src/database/init.js
// o:    npm run migrate
// =====================================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/db');

function init() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    console.log('📦 Ejecutando schema.sql sobre la base de datos...');
    db.exec(schema);

    // Sincroniza la fila de configuracion con las variables de entorno,
    // solo si el usuario definio valores explicitos en .env
    const cfg = db.prepare('SELECT * FROM configuracion WHERE id = 1').get();
    if (cfg) {
        const update = db.prepare(`
            UPDATE configuracion SET
                empresa_nombre = COALESCE(?, empresa_nombre),
                whatsapp_contacto = COALESCE(?, whatsapp_contacto),
                updated_at = datetime('now','localtime')
            WHERE id = 1
        `);
        update.run(
            process.env.EMPRESA_NOMBRE || null,
            process.env.WHATSAPP_CONTACTO || null
        );
    }

    console.log('✅ Base de datos lista en:', process.env.DB_PATH || './data/nominacore.db');
}

init();
