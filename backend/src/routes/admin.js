const express = require('express');
const jwt  = require('jsonwebtoken');
const User = require('../models/User');
const Institution = require('../models/Institution');
const Queue = require('../models/Queue');
const AdminLog = require('../models/AdminLog');
const { protectAdmin } = require('../middleware/admin');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'hojozat_secret_key_change_in_production';
const generateToken = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '7d' });

// Helper: log admin action
const logAction = async (req, action, targetType, targetId, details) => {
    try {
        await AdminLog.create({
            admin: req.user._id, action, targetType, targetId, details,
            ip: req.ip, userAgent: req.headers['user-agent']
        });
    } catch (e) { console.error('Log error:', e.message); }
};

// ═══════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

        const user = await User.findOne({ email }).select('+password');
        if (!user || user.role !== 'admin') {
            await AdminLog.create({ admin: user?._id || null, action: 'failed_login', targetType: 'system', details: `Failed login: ${email}`, ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
            return res.status(401).json({ error: 'Invalid credentials.' });
        }
        if (!(await user.comparePassword(password))) {
            await AdminLog.create({ admin: user._id, action: 'failed_login', targetType: 'system', details: `Wrong password: ${email}`, ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
            return res.status(401).json({ error: 'Invalid credentials.' });
        }
        if (!user.isActive) return res.status(403).json({ error: 'Account deactivated.' });

        user.lastLogin = new Date();
        await user.save({ validateBeforeSave: false });

        await AdminLog.create({ admin: user._id, action: 'login', targetType: 'system', details: 'Admin login', ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});

        res.json({
            token: generateToken(user._id),
            user: { id: user._id, name: user.name, email: user.email, role: user.role }
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ error: 'Login failed.' });
    }
});

router.get('/me', protectAdmin, (req, res) => {
    res.json({ user: { id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role } });
});

// ═══════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ═══════════════════════════════════════════════════════════════

router.get('/stats', protectAdmin, async (req, res) => {
    try {
        const [totalInstitutions, verified, pending, rejected, suspended, totalUsers, queues] = await Promise.all([
            Institution.countDocuments(),
            Institution.countDocuments({ verificationStatus: 'verified' }),
            Institution.countDocuments({ verificationStatus: 'pending' }),
            Institution.countDocuments({ verificationStatus: 'rejected' }),
            Institution.countDocuments({ verificationStatus: 'suspended' }),
            User.countDocuments({ role: { $ne: 'admin' } }),
            Queue.find({ 'entries.status': { $in: ['waiting', 'in_service'] } })
        ]);

        let activeQueues = 0, totalWaiting = 0, totalServedToday = 0;
        queues.forEach(q => {
            const active = q.entries.filter(e => ['waiting', 'in_service'].includes(e.status));
            if (active.length > 0) activeQueues++;
            totalWaiting += active.filter(e => e.status === 'waiting').length;
            totalServedToday += q.totalServedToday || 0;
        });

        res.json({
            totalInstitutions, verified, pending, rejected, suspended,
            totalUsers, activeQueues, totalWaiting, totalServedToday
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to fetch stats.' });
    }
});

// ═══════════════════════════════════════════════════════════════
// INSTITUTION MANAGEMENT
// ═══════════════════════════════════════════════════════════════

router.get('/institutions', protectAdmin, async (req, res) => {
    try {
        const { status, search, page = 1, limit = 20 } = req.query;
        const query = {};
        if (status && status !== 'all') query.verificationStatus = status;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { 'contact.email': { $regex: search, $options: 'i' } },
                { 'contact.phone': { $regex: search, $options: 'i' } }
            ];
        }
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [institutions, total] = await Promise.all([
            Institution.find(query).populate('owner', 'name email').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
            Institution.countDocuments(query)
        ]);
        res.json({ institutions, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch institutions.' });
    }
});

router.get('/institutions/:id', protectAdmin, async (req, res) => {
    try {
        const inst = await Institution.findById(req.params.id).populate('owner', 'name email phone').populate('verifiedBy', 'name');
        if (!inst) return res.status(404).json({ error: 'Not found.' });
        const queue = await Queue.findOne({ institution: inst._id });
        const activeEntries = queue ? queue.getActiveEntries() : [];
        res.json({ institution: inst, queueInfo: { currentSize: activeEntries.length, totalServedToday: queue?.totalServedToday || 0 } });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch institution.' });
    }
});

// ── Verify / Reject / Suspend ──

router.patch('/institutions/:id/verify', protectAdmin, async (req, res) => {
    try {
        const inst = await Institution.findById(req.params.id);
        if (!inst) return res.status(404).json({ error: 'Not found.' });

        inst.verificationStatus = 'verified';
        inst.isVerified = true;
        inst.verifiedAt = new Date();
        inst.verifiedBy = req.user._id;
        inst.verificationNote = req.body.note || '';
        await inst.save();

        await logAction(req, 'approve_institution', 'institution', inst._id, `Approved: ${inst.name}`);
        res.json({ message: 'Institution verified.', institution: inst });
    } catch (error) {
        res.status(500).json({ error: 'Failed to verify.' });
    }
});

router.patch('/institutions/:id/reject', protectAdmin, async (req, res) => {
    try {
        const inst = await Institution.findById(req.params.id);
        if (!inst) return res.status(404).json({ error: 'Not found.' });

        inst.verificationStatus = 'rejected';
        inst.isVerified = false;
        inst.verificationNote = req.body.note || 'Application rejected.';
        await inst.save();

        await logAction(req, 'reject_institution', 'institution', inst._id, `Rejected: ${inst.name}. Reason: ${inst.verificationNote}`);
        res.json({ message: 'Institution rejected.', institution: inst });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reject.' });
    }
});

router.patch('/institutions/:id/suspend', protectAdmin, async (req, res) => {
    try {
        const inst = await Institution.findById(req.params.id);
        if (!inst) return res.status(404).json({ error: 'Not found.' });

        inst.verificationStatus = 'suspended';
        inst.isVerified = false;
        inst.verificationNote = req.body.note || 'Suspended by admin.';
        await inst.save();

        await logAction(req, 'suspend_institution', 'institution', inst._id, `Suspended: ${inst.name}`);
        res.json({ message: 'Institution suspended.', institution: inst });
    } catch (error) {
        res.status(500).json({ error: 'Failed to suspend.' });
    }
});

router.delete('/institutions/:id', protectAdmin, async (req, res) => {
    try {
        const inst = await Institution.findById(req.params.id);
        if (!inst) return res.status(404).json({ error: 'Not found.' });

        await Queue.deleteMany({ institution: inst._id });
        await Institution.findByIdAndDelete(inst._id);

        await logAction(req, 'delete_institution', 'institution', inst._id, `Deleted: ${inst.name}`);
        res.json({ message: 'Institution deleted.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete.' });
    }
});

router.put('/institutions/:id', protectAdmin, async (req, res) => {
    try {
        const body = { ...req.body };
        delete body._id; delete body.owner;
        const inst = await Institution.findByIdAndUpdate(req.params.id, { $set: body }, { new: true, runValidators: true });
        if (!inst) return res.status(404).json({ error: 'Not found.' });
        await logAction(req, 'edit_institution', 'institution', inst._id, `Edited: ${inst.name}`);
        res.json({ institution: inst });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update.' });
    }
});

// ═══════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════

router.get('/users', protectAdmin, async (req, res) => {
    try {
        const { search, role, page = 1, limit = 20 } = req.query;
        const query = { role: { $ne: 'admin' } };
        if (role && role !== 'all') query.role = role;
        if (search) {
            query.$or = [
                { name:  { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [users, total] = await Promise.all([
            User.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
            User.countDocuments(query)
        ]);
        res.json({ users, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users.' });
    }
});

router.patch('/users/:id/suspend', protectAdmin, async (req, res) => {
    try {
        const u = await User.findById(req.params.id);
        if (!u) return res.status(404).json({ error: 'Not found.' });
        u.isActive = !u.isActive;
        await u.save({ validateBeforeSave: false });
        await logAction(req, 'suspend_user', 'user', u._id, `${u.isActive ? 'Activated' : 'Suspended'}: ${u.email}`);
        res.json({ message: `User ${u.isActive ? 'activated' : 'suspended'}.`, user: u });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update user.' });
    }
});

router.delete('/users/:id', protectAdmin, async (req, res) => {
    try {
        const u = await User.findById(req.params.id);
        if (!u) return res.status(404).json({ error: 'Not found.' });
        if (u.role === 'admin') return res.status(403).json({ error: 'Cannot delete admin.' });
        await User.findByIdAndDelete(u._id);
        await logAction(req, 'delete_user', 'user', u._id, `Deleted: ${u.email}`);
        res.json({ message: 'User deleted.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete user.' });
    }
});

// ═══════════════════════════════════════════════════════════════
// QUEUE MONITORING
// ═══════════════════════════════════════════════════════════════

router.get('/queues', protectAdmin, async (req, res) => {
    try {
        const queues = await Queue.find().populate('institution', 'name category verificationStatus');
        const result = queues.map(q => {
            const active  = q.getActiveEntries();
            const inSvc   = q.getInServiceEntry();
            return {
                _id:             q._id,
                institutionId:   q.institution?._id,
                institutionName: q.institution?.name || 'Unknown',
                category:        q.institution?.category,
                status:          q.institution?.verificationStatus,
                isOpen:          q.isOpen,
                activeCount:     active.length,
                waitingCount:    active.filter(e => e.status === 'waiting').length,
                inService:       inSvc ? { displayName: inSvc.displayName, ticketNumber: inSvc.ticketNumber } : null,
                totalServedToday: q.totalServedToday,
                entries:         active.map(e => ({ id: e._id, displayName: e.displayName, ticketNumber: e.ticketNumber, position: e.position, status: e.status, joinMethod: e.joinMethod, joinedAt: e.joinedAt }))
            };
        }).filter(q => q.activeCount > 0 || q.isOpen);
        res.json({ queues: result });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch queues.' });
    }
});

router.patch('/queues/:institutionId/force-close', protectAdmin, async (req, res) => {
    try {
        const queue = await Queue.findOne({ institution: req.params.institutionId });
        if (!queue) return res.status(404).json({ error: 'Queue not found.' });
        queue.entries.forEach(e => {
            if (['waiting', 'in_service'].includes(e.status)) { e.status = 'cancelled'; e.cancelledAt = new Date(); }
        });
        queue.isOpen = false;
        await queue.save();
        const inst = await Institution.findById(req.params.institutionId);
        if (inst) { inst.queueSettings.isQueueOpen = false; await inst.save(); }
        await logAction(req, 'force_close_queue', 'queue', queue._id, `Force closed queue for ${inst?.name}`);
        res.json({ message: 'Queue force closed.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to close queue.' });
    }
});

router.delete('/queues/:institutionId/entry/:entryId', protectAdmin, async (req, res) => {
    try {
        const queue = await Queue.findOne({ institution: req.params.institutionId });
        if (!queue) return res.status(404).json({ error: 'Queue not found.' });
        const entry = queue.entries.id(req.params.entryId);
        if (!entry) return res.status(404).json({ error: 'Entry not found.' });
        entry.status = 'cancelled'; entry.cancelledAt = new Date();
        queue.recalculatePositions();
        await queue.save();
        await logAction(req, 'remove_patient', 'queue', queue._id, `Removed patient: ${entry.displayName}`);
        res.json({ message: 'Patient removed.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to remove patient.' });
    }
});

// ═══════════════════════════════════════════════════════════════
// LOGS
// ═══════════════════════════════════════════════════════════════

router.get('/logs', protectAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 50, action } = req.query;
        const query = {};
        if (action) query.action = action;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [logs, total] = await Promise.all([
            AdminLog.find(query).populate('admin', 'name email').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
            AdminLog.countDocuments(query)
        ]);
        res.json({ logs, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch logs.' });
    }
});

module.exports = router;
