require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const sharp = require('sharp');
const https = require('https');
const http = require('http');

// Khởi tạo các thư mục cần thiết
const dirs = ['uploads', 'data'];
dirs.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath);
        console.log(`Created directory: ${dir}`);
    }
});

// Khởi tạo database
const initDatabase = () => {
    return new Promise((resolve, reject) => {
        const db = require('./config/database');
        
        // Tạo bảng images nếu chưa tồn tại
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
                reject(err);
                return;
            }
            console.log('Images table initialized');

            // Tạo bảng analytics nếu chưa tồn tại
            db.run(`CREATE TABLE IF NOT EXISTS analytics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                image_id TEXT,
                referrer TEXT,
                user_agent TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(image_id) REFERENCES images(id)
            )`, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                console.log('Analytics table initialized');
                resolve(db);
            });
        });
    });
};

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'default_secret',
    resave: false,
    saveUninitialized: false
}));

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ storage });

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session.isAuthenticated) {
        next();
    } else {
        res.redirect('/login');
    }
};

// Routes
app.get('/', (req, res) => {
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USERNAME && 
        password === process.env.ADMIN_PASSWORD) {
        req.session.isAuthenticated = true;
        res.redirect('/admin');
    } else {
        res.render('login', { error: 'Invalid credentials' });
    }
});

app.get('/admin', isAuthenticated, (req, res) => {
    const db = require('./config/database');
    db.all('SELECT * FROM images ORDER BY created_at DESC', [], (err, images) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database error');
        }
        res.render('admin', { images });
    });
});

app.post('/create-link', isAuthenticated, upload.single('image'), async (req, res) => {
    const { title, alt_text, redirect_url, custom_id } = req.body;
    const db = require('./config/database');

    try {
        // Kiểm tra custom_id nếu được cung cấp
        if (custom_id) {
            if (!/^[a-zA-Z0-9-_]+$/.test(custom_id)) {
                return res.status(400).send('Invalid custom ID format. Only letters, numbers, hyphens and underscores allowed.');
            }

            const existing = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM images WHERE id = ?', [custom_id], (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                });
            });

            if (existing) {
                return res.status(400).send('This custom ID is already taken. Please choose another one.');
            }
        }

        const id = custom_id || nanoid(10);
        const original_url = req.file ? 
            `/uploads/${req.file.filename}` : 
            req.body.image_url;

        const custom_link = `${req.protocol}://${req.get('host')}/i/${id}`;

        db.run(`
            INSERT INTO images (id, original_url, title, alt_text, custom_link, redirect_url)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [id, original_url, title, alt_text, custom_link, redirect_url], (err) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error creating link');
            }
            // Trả về success với thông tin link
            res.json({
                success: true,
                link: custom_link,
                title: title
            });
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Hàm lấy kích thước hình ảnh từ URL
async function getImageDimensions(imageUrl) {
    try {
        let buffer;
        if (imageUrl.startsWith('http')) {
            // Nếu là URL từ internet
            buffer = await new Promise((resolve, reject) => {
                const protocol = imageUrl.startsWith('https') ? https : http;
                protocol.get(imageUrl, (response) => {
                    const chunks = [];
                    response.on('data', (chunk) => chunks.push(chunk));
                    response.on('end', () => resolve(Buffer.concat(chunks)));
                    response.on('error', reject);
                });
            });
        } else {
            // Nếu là file local
            buffer = await fs.promises.readFile(path.join(__dirname, imageUrl));
        }

        const metadata = await sharp(buffer).metadata();
        return {
            width: metadata.width,
            height: metadata.height
        };
    } catch (error) {
        console.error('Error getting image dimensions:', error);
        return { width: 1200, height: 630 }; // Default dimensions
    }
}

// Cập nhật route /i/:id
app.get('/i/:id', async (req, res) => {
    const { id } = req.params;
    const db = require('./config/database');
    
    // Kiểm tra User-Agent để phát hiện crawler
    const userAgent = req.get('user-agent') || '';
    const isCrawler = /bot|facebook|twitter|linkedin|whatsapp|telegram|discord|facebookexternalhit|preview/i.test(userAgent);
    
    try {
        // Get image details
        const image = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM images WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!image) {
            return res.status(404).send('Link not found');
        }

        // Nếu là crawler, trả về trang với meta tags
        if (isCrawler) {
            // Đảm bảo URL hình ảnh là absolute URL
            const fullImageUrl = image.original_url.startsWith('http') 
                ? image.original_url 
                : `${req.protocol}://${req.get('host')}${image.original_url}`;

            // Lấy kích thước hình ảnh
            const dimensions = await getImageDimensions(image.original_url);

            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>${image.title}</title>
                    <meta name="description" content="${image.alt_text}">
                    
                    <!-- Open Graph / Facebook -->
                    <meta property="og:type" content="website">
                    <meta property="og:url" content="${req.protocol}://${req.get('host')}${req.originalUrl}">
                    <meta property="og:title" content="${image.title}">
                    <meta property="og:description" content="${image.alt_text}">
                    <meta property="og:image" content="${fullImageUrl}">
                    <meta property="og:image:width" content="${dimensions.width}">
                    <meta property="og:image:height" content="${dimensions.height}">
                    <meta property="og:image:alt" content="${image.alt_text}">
                    
                    <!-- Twitter -->
                    <meta name="twitter:card" content="summary_large_image">
                    <meta name="twitter:url" content="${req.protocol}://${req.get('host')}${req.originalUrl}">
                    <meta name="twitter:title" content="${image.title}">
                    <meta name="twitter:description" content="${image.alt_text}">
                    <meta name="twitter:image" content="${fullImageUrl}">
                    <meta name="twitter:image:alt" content="${image.alt_text}">
                    
                    <!-- Prevent caching for crawlers -->
                    <meta name="robots" content="noarchive">
                    <meta http-equiv="cache-control" content="no-cache">
                    <meta http-equiv="expires" content="0">
                    <meta http-equiv="pragma" content="no-cache">
                </head>
                <body>
                    <img src="${fullImageUrl}" alt="${image.alt_text}" style="max-width:100%;height:auto;">
                    <h1>${image.title}</h1>
                    <p>${image.alt_text}</p>
                </body>
                </html>
            `);
        } else {
            // Nếu là người dùng thông thường, log analytics và redirect
            const referrer = req.get('referrer') || 'direct';
            
            // Log analytics asynchronously
            db.run(`
                INSERT INTO analytics (image_id, referrer, user_agent)
                VALUES (?, ?, ?)
            `, [id, referrer, userAgent]);

            // Redirect ngay lập tức
            res.redirect(image.redirect_url);
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Server error');
    }
});

app.get('/redirect/:id', (req, res) => {
    const { id } = req.params;
    const db = require('./config/database');
    db.get('SELECT redirect_url FROM images WHERE id = ?', [id], (err, image) => {
        if (err || !image) {
            return res.status(404).send('Link not found');
        }
        res.redirect(image.redirect_url);
    });
});

// Thêm route logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Route quản lý links
app.get('/manage-links', isAuthenticated, (req, res) => {
    const db = require('./config/database');
    db.all('SELECT * FROM images ORDER BY created_at DESC', [], (err, images) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database error');
        }
        res.render('manage-links', { images });
    });
});

// Route lấy thông tin link để edit
app.get('/get-link/:id', isAuthenticated, (req, res) => {
    const db = require('./config/database');
    db.get('SELECT * FROM images WHERE id = ?', [req.params.id], (err, image) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(image);
    });
});

// Route cập nhật link
app.post('/update-link', isAuthenticated, (req, res) => {
    const { id, title, alt_text, redirect_url } = req.body;
    const db = require('./config/database');
    
    db.run(`
        UPDATE images 
        SET title = ?, alt_text = ?, redirect_url = ?
        WHERE id = ?
    `, [title, alt_text, redirect_url, id], (err) => {
        if (err) {
            return res.status(500).send('Error updating link');
        }
        res.redirect('/manage-links');
    });
});

// Route xóa link
app.delete('/delete-link/:id', isAuthenticated, (req, res) => {
    const db = require('./config/database');
    db.run('DELETE FROM images WHERE id = ?', [req.params.id], (err) => {
        if (err) {
            return res.status(500).send('Error deleting link');
        }
        res.sendStatus(200);
    });
});

// Route lấy analytics
app.get('/analytics/:id', isAuthenticated, (req, res) => {
    const db = require('./config/database');
    const id = req.params.id;

    Promise.all([
        // Tổng số clicks
        new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM analytics WHERE image_id = ?', 
                [id], (err, row) => {
                    if (err) reject(err);
                    resolve(row.count);
                });
        }),
        // Clicks trong 7 ngày qua
        new Promise((resolve, reject) => {
            db.get(`
                SELECT COUNT(*) as count 
                FROM analytics 
                WHERE image_id = ? 
                AND created_at >= datetime('now', '-7 days')
            `, [id], (err, row) => {
                if (err) reject(err);
                resolve(row.count);
            });
        }),
        // Top referrers
        new Promise((resolve, reject) => {
            db.all(`
                SELECT referrer, COUNT(*) as count 
                FROM analytics 
                WHERE image_id = ?
                GROUP BY referrer 
                ORDER BY count DESC 
                LIMIT 5
            `, [id], (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            });
        })
    ])
    .then(([totalClicks, last7Days, topReferrers]) => {
        res.json({
            totalClicks,
            last7Days,
            topReferrers
        });
    })
    .catch(err => {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    });
});

// Khởi động server sau khi đã khởi tạo database
initDatabase()
    .then(() => {
        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    })
    .catch(err => {
        console.error('Failed to initialize database:', err);
        process.exit(1);
    }); 