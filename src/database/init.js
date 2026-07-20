// =====================================================================
// Inicializa (o migra) la base de datos ejecutando schema.sql.
// Es seguro correrlo varias veces: todo usa CREATE TABLE IF NOT EXISTS.
// Uso:  node src/database/init.js
// o:    npm run migrate
// =====================================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../config/db');

async function init() {
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

    // Crea el usuario ADMIN por defecto solo si todavia no hay ningun
    // usuario en el sistema (primer arranque). La contraseña debe
    // cambiarse de inmediato desde /usuarios.
    const totalUsuarios = db.prepare('SELECT COUNT(*) c FROM usuarios').get().c;
    if (totalUsuarios === 0) {
        const usuarioDefault = process.env.ADMIN_USERNAME || 'admin';
        const passwordDefault = process.env.ADMIN_PASSWORD || 'NominaCore2026!';
        const hash = await bcrypt.hash(passwordDefault, 10);

        db.prepare(`
            INSERT INTO usuarios (username, password_hash, nombre_completo, rol, activo)
            VALUES (?, ?, 'Administrador', 'ADMIN', 1)
        `).run(usuarioDefault, hash);

        console.log('👤 Usuario administrador creado:');
        console.log(`   Usuario:    ${usuarioDefault}`);
        console.log(`   Contraseña: ${passwordDefault}`);
        console.log('   ⚠️  Cambia esta contraseña de inmediato desde el modulo Usuarios.');
    }

    console.log('✅ Base de datos lista en:', process.env.DB_PATH || './data/nominacore.db');
}

module.exports = init;

// Permite seguir usando "node src/database/init.js" o "npm run migrate"
// directamente desde la terminal.
if (require.main === module) {
    init();
}
