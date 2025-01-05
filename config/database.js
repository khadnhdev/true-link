const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '../data/database.sqlite'), (err) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Connected to SQLite database');
        createTables();
    }
});

function createTables() {
    db.run(`CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY,
        original_url TEXT NOT NULL,
        title TEXT,
        alt_text TEXT,
        custom_link TEXT,
        redirect_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        image_id TEXT,
        referrer TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(image_id) REFERENCES images(id)
    )`);
}

module.exports = db; 