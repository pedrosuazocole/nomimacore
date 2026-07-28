// =====================================================================
// Conexion centralizada a SQLite (better-sqlite3).
// Se exporta una unica instancia (singleton) para toda la app.
// =====================================================================
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'nominacore.db');

// Asegura que la carpeta del archivo de BD exista (importante en Railway
// cuando se monta un volumen persistente en /data).
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
