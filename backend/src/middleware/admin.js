const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'hojozat_secret_key_change_in_production';

const protectAdmin = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }
        if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

        const decoded = jwt.verify(token, JWT_SECRET);
        const user    = await User.findById(decoded.id).select('-password');

        if (!user)            return res.status(401).json({ error: 'Invalid token.' });
        if (!user.isActive)   return res.status(401).json({ error: 'Account deactivated.' });
        if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError')  return res.status(401).json({ error: 'Invalid token.' });
        if (error.name === 'TokenExpiredError')   return res.status(401).json({ error: 'Token expired.' });
        res.status(500).json({ error: 'Authentication error.' });
    }
};

module.exports = { protectAdmin };
