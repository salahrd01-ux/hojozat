const express = require('express');
const User        = require('../models/User');
const Queue       = require('../models/Queue');
const Institution = require('../models/Institution');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const router = express.Router();

// @GET /api/users/profile
router.get('/profile', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch profile.' });
    }
});

// @PUT /api/users/profile
router.put('/profile', protect, async (req, res) => {
    try {
        const { name, phone, notificationPreferences } = req.body;
        const update = {};
        if (name)                    update.name = name;
        if (phone)                   update.phone = phone;
        if (notificationPreferences) update.notificationPreferences = notificationPreferences;

        const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });
        res.json({ user, message: 'Profile updated successfully.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update profile.' });
    }
});

// @GET /api/users/queues/active
router.get('/queues/active', protect, async (req, res) => {
    try {
        const queues = await Queue.find({
            entries: {
                $elemMatch: {
                    user:   req.user._id,
                    status: { $in: ['waiting', 'in_service'] }
                }
            }
        }).populate('institution', 'name category location queueSettings logo');

        const result = queues.map(q => {
            const entry = q.entries.find(
                e => e.user && e.user.toString() === req.user._id.toString() &&
                    ['waiting', 'in_service'].includes(e.status)
            );
            const avgTime  = q.institution?.queueSettings?.avgServiceTime || 10;
            const inSvc    = q.getInServiceEntry();
            return {
                institutionId:       q.institution._id,
                institutionName:     q.institution.name,
                institutionCategory: q.institution.category,
                institutionLogo:     q.institution.logo,
                ticketNumber:        entry.ticketNumber,
                position:            entry.position,
                status:              entry.status,
                estimatedWait:       (entry.position - 1) * avgTime,
                joinedAt:            entry.joinedAt,
                inService:           inSvc ? { displayName: inSvc.displayName, ticketNumber: inSvc.ticketNumber } : null
            };
        });

        res.json({ activeQueues: result });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch active queues.' });
    }
});

// @GET /api/users/queues/history
router.get('/queues/history', protect, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const queues = await Queue.find({
            entries: {
                $elemMatch: {
                    user:   req.user._id,
                    status: { $in: ['completed', 'cancelled'] }
                }
            }
        })
            .populate('institution', 'name category logo')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const result = [];
        queues.forEach(q => {
            q.entries
                .filter(e => e.user && e.user.toString() === req.user._id.toString() &&
                    ['completed', 'cancelled'].includes(e.status))
                .forEach(entry => {
                    result.push({
                        institutionId:       q.institution._id,
                        institutionName:     q.institution.name,
                        institutionCategory: q.institution.category,
                        institutionLogo:     q.institution.logo,
                        ticketNumber:        entry.ticketNumber,
                        status:              entry.status,
                        joinedAt:            entry.joinedAt,
                        completedAt:         entry.completedAt,
                        cancelledAt:         entry.cancelledAt
                    });
                });
        });

        result.sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt));

        res.json({
            history: result.slice(0, parseInt(limit)),
            total:   result.length
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch queue history.' });
    }
});

// @GET /api/users/dashboard
router.get('/dashboard', protect, async (req, res) => {
    try {
        const allQueueEntries = await Queue.find({ 'entries.user': req.user._id });

        let totalJoined = 0, totalServed = 0, totalCancelled = 0;
        allQueueEntries.forEach(q => {
            q.entries.filter(e => e.user && e.user.toString() === req.user._id.toString()).forEach(e => {
                totalJoined++;
                if (e.status === 'completed') totalServed++;
                if (e.status === 'cancelled')  totalCancelled++;
            });
        });

        const unreadNotifications = await Notification.countDocuments({ user: req.user._id, isRead: false });

        res.json({
            stats: { totalJoined, totalServed, totalCancelled },
            unreadNotifications
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch dashboard.' });
    }
});

module.exports = router;
