const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'hojozat_secret_key_change_in_production';

const protect = async (req, res, next) => {
    try {
        let token;

        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ error: 'Access denied. No token provided.' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        const user    = await User.findById(decoded.id).select('-password');

        if (!user) {
            return res.status(401).json({ error: 'Token is invalid or user no longer exists.' });
        }

        if (!user.isActive) {
            return res.status(401).json({ error: 'Your account has been deactivated.' });
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token.' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token has expired. Please log in again.' });
        }
        res.status(500).json({ error: 'Authentication error.' });
    }
};

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                error: `Access denied. Required role: ${roles.join(' or ')}.`
            });
        }
        next();
    };
};

const optionalAuth = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }
        if (token) {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user    = await User.findById(decoded.id).select('-password');
            if (user && user.isActive) req.user = user;
        }
        next();
    } catch {
        next(); // Silent fail for optional auth
    }
};

module.exports = { protect, authorize, optionalAuth };
