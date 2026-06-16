require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const authRoutes         = require('./routes/auth');
const institutionRoutes  = require('./routes/institutions');
const queueRoutes        = require('./routes/queues');
const userRoutes         = require('./routes/users');
const notificationRoutes = require('./routes/notifications');
const adminRoutes        = require('./routes/admin');

const { socketHandler } = require('./socket/socketHandler');

const app    = express();
const server = http.createServer(app);

// Allow any localhost origin (file://, http://localhost:*)
const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'https://hojozat.vercel.app',
    'http://127.0.0.1:5500',
    'http://localhost:5500',
    'http://localhost:3000',
    'http://localhost:5000',
    'null' // file:// protocol sends Origin: null
];

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (like Postman, curl) or matching origins
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, true); // In dev, allow all — restrict in production
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

const io = new Server(server, {
    cors: corsOptions
});

// Make io accessible to routes
app.set('io', io);

// Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false // We will manage CSP dynamically below for HTML files
}));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // pre-flight
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Silence Favicon 404 warning securely
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Security: Prevent NoSQL Query Injection (strips MongoDB operators like $gt)
const sanitizeNoSql = (obj) => {
    if (obj && typeof obj === 'object') {
        for (const key in obj) {
            if (key.startsWith('$')) {
                delete obj[key];
            } else if (typeof obj[key] === 'object') {
                sanitizeNoSql(obj[key]);
            }
        }
    }
};
app.use((req, res, next) => {
    sanitizeNoSql(req.body);
    sanitizeNoSql(req.query);
    sanitizeNoSql(req.params);
    next();
});

// Security: Prevent Stored XSS by escaping HTML special characters in inputs
const sanitizeXss = (obj) => {
    if (obj && typeof obj === 'object') {
        for (const key in obj) {
            if (typeof obj[key] === 'string') {
                obj[key] = obj[key]
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#x27;')
                    .replace(/\//g, '&#x2F;');
            } else if (typeof obj[key] === 'object') {
                sanitizeXss(obj[key]);
            }
        }
    }
};
app.use((req, res, next) => {
    sanitizeXss(req.body);
    next();
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// Custom Secure Dynamic CSP Middleware for HTML files
app.use((req, res, next) => {
    // Check if the request is for an HTML page or root path
    const ext = path.extname(req.path);
    const isHtml = !ext || ext === '.html' || req.path === '/';
    
    // Ignore API routes
    if (req.path.startsWith('/api/')) {
        return next();
    }

    if (!isHtml) {
        return next();
    }

    // Determine target HTML file path
    let filePath = path.join(__dirname, '../../html', req.path);
    if (req.path === '/') {
        filePath = path.join(__dirname, '../../html/index.html');
    } else if (!ext) {
        filePath += '.html';
    }

    // Serve HTML with injected unique cryptographic nonces for XSS protection
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const nonce = crypto.randomBytes(16).toString('base64');

        fs.readFile(filePath, 'utf8', (err, content) => {
            if (err) {
                return next(err);
            }

            // Inject nonce attribute to all script tags
            const modifiedHtml = content.replace(/<script\b([^>]*)>/gi, (match, attrs) => {
                if (attrs.includes('nonce=')) {
                    return match;
                }
                return `<script nonce="${nonce}"${attrs}>`;
            });

            // Production-grade Content Security Policy
            res.setHeader('Content-Security-Policy', [
                `default-src 'self'`,
                `script-src 'self' 'nonce-${nonce}' https://unpkg.com https://cdn.socket.io https://cdn.jsdelivr.net`,
                `style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com https://cdn.jsdelivr.net`,
                `img-src 'self' data: https://unpkg.com https://*.tile.openstreetmap.org https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org`,
                `connect-src 'self' ws://localhost:5000 http://localhost:5000 ws://127.0.0.1:5000 http://127.0.0.1:5000 https://router.project-osrm.org https://*.tile.openstreetmap.org https://unpkg.com https://cdn.socket.io https://cdn.jsdelivr.net`,
                `font-src 'self' https://fonts.gstatic.com`,
                `object-src 'none'`,
                `base-uri 'self'`,
                `form-action 'self'`,
                `frame-ancestors 'none'`
            ].join('; '));

            res.setHeader('Content-Type', 'text/html');
            return res.send(modifiedHtml);
        });
    } else {
        return next();
    }
});

// Serve other frontend static files (CSS, JS, images)
app.use(express.static(path.join(__dirname, '../../html')));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Too many requests, please try again later.' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Too many auth attempts, please try again later.' }
});

app.use('/api/', limiter);
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

// Routes
app.use('/api/auth',          authRoutes);
app.use('/api/institutions',  institutionRoutes);
app.use('/api/queues',        queueRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin',         adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Socket.io handler
socketHandler(io);

// MongoDB connection
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hojozat');
        console.log('✅ MongoDB connected successfully');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        process.exit(1);
    }
};

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error'
    });
});

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 Hojozat Server running on port ${PORT}`);
        console.log(`📡 WebSocket server ready`);
        console.log(`🌐 CORS enabled for all origins in development`);
    });
});

module.exports = { app, server, io };
