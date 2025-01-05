const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Đảm bảo thư mục data tồn tại
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)){
    fs.mkdirSync(dataDir);
}

const db = new sqlite3.Database(path.join(__dirname, 'data/database.sqlite'), (err) => {
    if (err) {
        console.error('Error creating database:', err);
        process.exit(1);
    }
    console.log('Connected to database. Creating tables...');
    
    // Tạo bảng images
    db.run(`CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY,
        original_url TEXT NOT NULL,
        title TEXT,
        alt_text TEXT,
        custom_link TEXT,
        redirect_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('Error creating images table:', err);
            process.exit(1);
        }
        console.log('Images table created successfully');
        
        // Tạo bảng analytics
        db.run(`CREATE TABLE IF NOT EXISTS analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_id TEXT,
            referrer TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(image_id) REFERENCES images(id)
        )`, (err) => {
            if (err) {
                console.error('Error creating analytics table:', err);
                process.exit(1);
            }
            console.log('Analytics table created successfully');
            console.log('Database initialization completed');
            
            // Đóng kết nối database
            db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                    process.exit(1);
                }
                console.log('Database connection closed');
                process.exit(0);
            });
        });
    });
}); 