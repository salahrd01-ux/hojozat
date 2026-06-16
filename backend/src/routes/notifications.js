const express = require('express');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const router = express.Router();

// @GET /api/notifications - Get user notifications
router.get('/', protect, async (req, res) => {
    try {
        const { page = 1, limit = 20, unreadOnly = false } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let query = { user: req.user._id };
        if (unreadOnly === 'true') query.isRead = false;

        const [notifications, total, unreadCount] = await Promise.all([
            Notification.find(query)
                .populate('institution', 'name logo')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Notification.countDocuments(query),
            Notification.countDocuments({ user: req.user._id, isRead: false })
        ]);

        res.json({ notifications, total, unreadCount });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch notifications.' });
    }
});

// @PATCH /api/notifications/:id/read - Mark as read
router.patch('/:id/read', protect, async (req, res) => {
    try {
        await Notification.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { isRead: true }
        );
        res.json({ message: 'Notification marked as read.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark notification.' });
    }
});

// @PATCH /api/notifications/read-all - Mark all as read
router.patch('/read-all', protect, async (req, res) => {
    try {
        await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true });
        res.json({ message: 'All notifications marked as read.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark all notifications.' });
    }
});

// @DELETE /api/notifications/:id - Delete notification
router.delete('/:id', protect, async (req, res) => {
    try {
        await Notification.findOneAndDelete({ _id: req.params.id, user: req.user._id });
        res.json({ message: 'Notification deleted.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete notification.' });
    }
});

module.exports = router;
