const { dbPath, initDatabase } = require('./utils/database');

initDatabase();
console.log(`SQLite database is ready: ${dbPath}`);
