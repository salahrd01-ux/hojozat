const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt  = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();

const generateToken = (userId) => {
    return jwt.sign(
        { id: userId },
        process.env.JWT_SECRET || 'hojozat_secret_key_change_in_production',
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
};

// @POST /api/auth/register
router.post('/register', [
    body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').optional().isIn(['user', 'institution']).withMessage('Invalid role')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { name, email, password, phone, role = 'user', language = 'en' } = req.body;

        // Check duplicate email
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already in use.' });
        }

        const user  = await User.create({ name, email, password, phone, role, language });
        const token = generateToken(user._id);

        res.status(201).json({
            message: 'Account created successfully',
            token,
            user: {
                id:       user._id,
                name:     user.name,
                email:    user.email,
                role:     user.role,
                language: user.language
            }
        });
    } catch (error) {
        console.error('Register error:', error);
        if (error.code === 11000) {
            return res.status(400).json({ error: 'Email already in use.' });
        }
        res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
});

// @POST /api/auth/login
router.post('/login', [
    body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
    body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        // Must explicitly select password since it's select:false
        const user = await User.findOne({ email }).select('+password');

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        if (!user.isActive) {
            return res.status(403).json({ error: 'Account is deactivated.' });
        }

        if (user.role === 'admin') {
            return res.status(403).json({ error: 'Please use the admin login page.' });
        }

        user.lastLogin = new Date();
        await user.save({ validateBeforeSave: false });

        const token = generateToken(user._id);

        res.json({
            message: 'Login successful',
            token,
            user: {
                id:       user._id,
                name:     user.name,
                email:    user.email,
                role:     user.role,
                language: user.language,
                avatar:   user.avatar
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

// @GET /api/auth/me
router.get('/me', require('../middleware/auth').protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user data.' });
    }
});

// @PUT /api/auth/password
router.put('/password', require('../middleware/auth').protect, [
    body('currentPassword').notEmpty().withMessage('Current password required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.user._id).select('+password');

        if (!user) return res.status(404).json({ error: 'User not found.' });

        if (!(await user.comparePassword(currentPassword))) {
            return res.status(400).json({ error: 'Current password is incorrect.' });
        }

        user.password = newPassword;
        await user.save();
        res.json({ message: 'Password updated successfully.' });
    } catch (error) {
        console.error('Password update error:', error);
        res.status(500).json({ error: 'Failed to update password.' });
    }
});

module.exports = router;
