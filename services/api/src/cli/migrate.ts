import { loadConfig } from '../config.js';
import { Database } from '../db/database.js';

const cfg = loadConfig();
const db = new Database(cfg.dbPath);
const r = db.migrate();
console.log(JSON.stringify({ db: cfg.dbPath, applied: r.applied, current_version: r.current, fts5: db.ftsAvailable }, null, 2));
db.close();
