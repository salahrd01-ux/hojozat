const express  = require('express');
const Queue       = require('../models/Queue');
const Institution = require('../models/Institution');
const Notification = require('../models/Notification');
const { protect, authorize } = require('../middleware/auth');
const router = express.Router();

// ─── Helper: emit real-time queue update ─────────────────────────────────────
const emitQueueUpdate = async (io, institutionId, queue, institution) => {
    const active   = queue.getActiveEntries();
    const inSvc    = queue.getInServiceEntry();
    const avgTime  = institution?.queueSettings?.avgServiceTime || 10;

    io.to(`institution:${institutionId}`).emit('queueUpdated', {
        institutionId,
        queueSize:    active.length,
        inService:    inSvc ? { id: inSvc._id, displayName: inSvc.displayName, ticketNumber: inSvc.ticketNumber } : null,
        entries:      active.map(e => ({
            id:           e._id,
            userId:       e.user,
            displayName:  e.displayName,
            firstName:    e.firstName,
            lastName:     e.lastName,
            phone:        e.phone,
            ticketNumber: e.ticketNumber,
            position:     e.position,
            status:       e.status,
            joinMethod:   e.joinMethod,
            estimatedWait: (e.position - 1) * avgTime,
            joinedAt:     e.joinedAt
        }))
    });

    // Notify each waiting user of their position
    active.forEach(entry => {
        if (entry.user) {
            io.to(`user:${entry.user}`).emit('positionUpdated', {
                institutionId,
                position:      entry.position,
                ticketNumber:  entry.ticketNumber,
                estimatedWait: (entry.position - 1) * avgTime,
                status:        entry.status,
                inService:     inSvc ? { displayName: inSvc.displayName, ticketNumber: inSvc.ticketNumber } : null
            });
        }
    });
};

// ─── GET /api/queues/:institutionId — Get queue status ───────────────────────
router.get('/:institutionId', async (req, res) => {
    try {
        const queue = await Queue.findOne({ institution: req.params.institutionId })
            .populate('entries.user', 'name email');

        if (!queue) return res.json({ entries: [], size: 0, isOpen: false, inService: null });

        const institution = await Institution.findById(req.params.institutionId, 'queueSettings');
        const active      = queue.getActiveEntries();
        const inSvc       = queue.getInServiceEntry();
        const avgTime     = institution?.queueSettings?.avgServiceTime || 10;

        res.json({
            queueId:          queue._id,
            isOpen:           queue.isOpen,
            currentTicket:    queue.currentTicket,
            nextTicketNumber: queue.nextTicketNumber,
            totalServedToday: queue.totalServedToday,
            inService:        inSvc ? {
                id:           inSvc._id,
                displayName:  inSvc.displayName,
                ticketNumber: inSvc.ticketNumber,
                calledAt:     inSvc.calledAt
            } : null,
            entries: active.map(e => ({
                id:           e._id,
                user:         e.user,
                displayName:  e.displayName,
                firstName:    e.firstName,
                lastName:     e.lastName,
                phone:        e.phone,
                ticketNumber: e.ticketNumber,
                position:     e.position,
                status:       e.status,
                joinMethod:   e.joinMethod,
                estimatedWait: (e.position - 1) * avgTime,
                joinedAt:     e.joinedAt
            })),
            size: active.length
        });
    } catch (error) {
        console.error('Get queue error:', error);
        res.status(500).json({ error: 'Failed to fetch queue.' });
    }
});

// ─── POST /api/queues/:institutionId/join — Join queue (user) ────────────────
router.post('/:institutionId/join', protect, authorize('user'), async (req, res) => {
    try {
        const institution = await Institution.findById(req.params.institutionId);
        if (!institution || !institution.isActive) {
            return res.status(404).json({ error: 'Institution not found.' });
        }
        if (institution.verificationStatus !== 'verified') {
            return res.status(403).json({ error: 'This institution is not yet verified.' });
        }
        if (!institution.queueSettings.isQueueOpen) {
            return res.status(400).json({ error: 'Queue is currently closed.' });
        }

        let queue = await Queue.findOne({ institution: req.params.institutionId });
        if (!queue) {
            queue = await Queue.create({
                institution: req.params.institutionId,
                date: new Date().toISOString().split('T')[0]
            });
        }

        const active = queue.getActiveEntries();

        // Check already in queue
        const alreadyIn = queue.entries.find(
            e => e.user && e.user.toString() === req.user._id.toString() &&
                ['waiting', 'in_service'].includes(e.status)
        );
        if (alreadyIn) {
            return res.status(400).json({ error: 'You are already in this queue.', entry: alreadyIn });
        }

        // Check max size
        if (active.length >= institution.queueSettings.maxQueueSize) {
            return res.status(400).json({ error: 'Queue is full. Please try again later.' });
        }

        const newEntry = queue.addEntry(req.user._id, 'remote', req.user.name);
        await queue.save();

        const avgTime     = institution.queueSettings.avgServiceTime;
        const estimatedWait = (newEntry.position - 1) * avgTime;

        // Notification
        await Notification.create({
            user:       req.user._id,
            institution: institution._id,
            type:       'queue_update',
            title:      'Joined Queue',
            message:    `You joined the queue at ${institution.name}. Position #${newEntry.position}, Ticket #${newEntry.ticketNumber}.`,
            data:       { ticketNumber: newEntry.ticketNumber, position: newEntry.position, estimatedWait }
        });

        const io = req.app.get('io');
        await emitQueueUpdate(io, req.params.institutionId, queue, institution);

        res.status(201).json({
            message: 'Successfully joined queue',
            entry: {
                id:           newEntry._id,
                ticketNumber: newEntry.ticketNumber,
                position:     newEntry.position,
                estimatedWait,
                status:       newEntry.status
            }
        });
    } catch (error) {
        console.error('Join queue error:', error);
        res.status(500).json({ error: 'Failed to join queue.' });
    }
});

// ─── DELETE /api/queues/:institutionId/leave — Leave queue (user) ─────────────
router.delete('/:institutionId/leave', protect, async (req, res) => {
    try {
        const queue = await Queue.findOne({ institution: req.params.institutionId });
        if (!queue) return res.status(404).json({ error: 'Queue not found.' });

        const entryIndex = queue.entries.findIndex(
            e => e.user && e.user.toString() === req.user._id.toString() &&
                ['waiting'].includes(e.status)
        );

        if (entryIndex === -1) {
            return res.status(404).json({ error: 'You are not in this queue or already being served.' });
        }

        queue.entries[entryIndex].status      = 'cancelled';
        queue.entries[entryIndex].cancelledAt = new Date();
        queue.recalculatePositions();
        await queue.save();

        const institution = await Institution.findById(req.params.institutionId);
        const io = req.app.get('io');
        await emitQueueUpdate(io, req.params.institutionId, queue, institution);

        await Notification.create({
            user:       req.user._id,
            institution: req.params.institutionId,
            type:       'queue_cancelled',
            title:      'Left Queue',
            message:    `You have left the queue at ${institution?.name || 'the institution'}.`
        });

        res.json({ message: 'Successfully left queue.' });
    } catch (error) {
        console.error('Leave queue error:', error);
        res.status(500).json({ error: 'Failed to leave queue.' });
    }
});

// ─── POST /api/queues/:institutionId/manual — Add manual patient ──────────────
router.post('/:institutionId/manual', protect, authorize('institution'), async (req, res) => {
    try {
        const { firstName = 'Walk-in', lastName = '', phone = '', notes = '' } = req.body;

        const institution = await Institution.findById(req.params.institutionId);
        if (!institution) return res.status(404).json({ error: 'Institution not found.' });
        if (institution.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Not authorized.' });
        }

        let queue = await Queue.findOne({ institution: req.params.institutionId });
        if (!queue) {
            queue = await Queue.create({ institution: req.params.institutionId, date: new Date().toISOString().split('T')[0] });
        }

        const entry = queue.addManualEntry(firstName, lastName, phone, notes);
        await queue.save();

        const io = req.app.get('io');
        await emitQueueUpdate(io, req.params.institutionId, queue, institution);

        res.status(201).json({
            message:      'Patient added to queue',
            ticketNumber: entry.ticketNumber,
            position:     entry.position,
            entryId:      entry._id
        });
    } catch (error) {
        console.error('Manual add error:', error);
        res.status(500).json({ error: 'Failed to add patient.' });
    }
});

// ─── PATCH /api/queues/:institutionId/entry/:entryId — Edit patient info ──────
router.patch('/:institutionId/entry/:entryId', protect, authorize('institution'), async (req, res) => {
    try {
        const institution = await Institution.findById(req.params.institutionId);
        if (!institution) return res.status(404).json({ error: 'Institution not found.' });
        if (institution.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Not authorized.' });
        }

        const queue = await Queue.findOne({ institution: req.params.institutionId });
        if (!queue) return res.status(404).json({ error: 'Queue not found.' });

        const entry = queue.entries.id(req.params.entryId);
        if (!entry) return res.status(404).json({ error: 'Patient not found.' });

        const { firstName, lastName, phone, notes } = req.body;
        if (firstName !== undefined) entry.firstName   = firstName;
        if (lastName  !== undefined) entry.lastName    = lastName;
        if (phone     !== undefined) entry.phone       = phone;
        if (notes     !== undefined) entry.notes       = notes;

        // Rebuild displayName
        if (firstName !== undefined || lastName !== undefined) {
            entry.displayName = `${entry.firstName} ${entry.lastName}`.trim() || entry.displayName;
        }

        await queue.save();

        const io = req.app.get('io');
        await emitQueueUpdate(io, req.params.institutionId, queue, institution);

        res.json({ message: 'Patient updated.', entry });
    } catch (error) {
        console.error('Edit patient error:', error);
        res.status(500).json({ error: 'Failed to edit patient.' });
    }
});

// ─── PATCH /api/queues/:institutionId/call-next — Call next patient ────────────
router.patch('/:institutionId/call-next', protect, authorize('institution'), async (req, res) => {
    try {
        const institution = await Institution.findById(req.params.institutionId);
        if (!institution) return res.status(404).json({ error: 'Institution not found.' });
        if (institution.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Not authorized.' });
        }

        const queue = await Queue.findOne({ institution: req.params.institutionId });
        if (!queue) return res.status(404).json({ error: 'Queue not found.' });

        const active = queue.getActiveEntries();
        if (active.length === 0) {
            return res.status(400).json({ error: 'Queue is empty.' });
        }

        // Can't call next while someone is in_service
        const currentlyServing = queue.getInServiceEntry();
        if (currentlyServing) {
            return res.status(400).json({ error: 'Complete current patient first before calling next.' });
        }

        // Move first waiting entry to in_service
        const nextEntry = active.find(e => e.status === 'waiting');
        if (!nextEntry) {
            return res.status(400).json({ error: 'No waiting patients.' });
        }

        const entryDoc = queue.entries.id(nextEntry._id);
        entryDoc.status   = 'in_service';
        entryDoc.calledAt = new Date();
        queue.recalculatePositions();
        await queue.save();

        // Notify user (if they have an account)
        if (entryDoc.user) {
            await Notification.create({
                user:       entryDoc.user,
                institution: institution._id,
                type:       'your_turn',
                title:      'Your Turn!',
                message:    `It's your turn at ${institution.name}! Please proceed to the counter.`,
                data:       { ticketNumber: entryDoc.ticketNumber }
            });

            const io = req.app.get('io');
            io.to(`user:${entryDoc.user}`).emit('yourTurn', {
                institutionId:   req.params.institutionId,
                institutionName: institution.name,
                ticketNumber:    entryDoc.ticketNumber
            });
        }

        const io = req.app.get('io');
        await emitQueueUpdate(io, req.params.institutionId, queue, institution);

        res.json({
            message:      'Patient called to service',
            patient:      entryDoc.displayName,
            ticketNumber: entryDoc.ticketNumber
        });
    } catch (error) {
        console.error('Call next error:', error);
        res.status(500).json({ error: 'Failed to call next patient.' });
    }
});

// ─── PATCH /api/queues/:institutionId/complete — Mark in-service as completed ──
router.patch('/:institutionId/complete', protect, authorize('institution'), async (req, res) => {
    try {
        const institution = await Institution.findById(req.params.institutionId);
        if (!institution) return res.status(404).json({ error: 'Institution not found.' });
        if (institution.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Not authorized.' });
        }

        const queue = await Queue.findOne({ institution: req.params.institutionId });
        if (!queue) return res.status(404).json({ error: 'Queue not found.' });

        const inSvc = queue.getInServiceEntry();
        if (!inSvc) return res.status(400).json({ error: 'No patient currently in service.' });

        const entryDoc = queue.entries.id(inSvc._id);
        entryDoc.status      = 'completed';
        entryDoc.completedAt = new Date();
        queue.totalServedToday += 1;
        queue.currentTicket    = entryDoc.ticketNumber;

        // Update institution stats
        institution.statistics.totalServedToday   += 1;
        institution.statistics.totalServedAllTime += 1;
        await institution.save();

        queue.recalculatePositions();
        await queue.save();

        const io = req.app.get('io');
        await emitQueueUpdate(io, req.params.institutionId, queue, institution);

        // Warn 2nd-in-line
        const newActive = queue.getActiveEntries();
        if (newActive.length > 0 && newActive[0].user) {
            await Notification.create({
                user:       newActive[0].user,
                institution: institution._id,
                type:       'turn_near',
                title:      'Almost Your Turn',
                message:    `You are next at ${institution.name}. Get ready!`
            });
            io.to(`user:${newActive[0].user}`).emit('turnNear', {
                institutionId:   req.params.institutionId,
                institutionName: institution.name,
                position:        1
            });
        }

        res.json({
            message:          'Patient marked as completed',
            totalServedToday: queue.totalServedToday
        });
    } catch (error) {
        console.error('Complete error:', error);
        res.status(500).json({ error: 'Failed to complete patient.' });
    }
});

// ─── PATCH /api/queues/:institutionId/serve — Alias for call-next (legacy) ────
router.patch('/:institutionId/serve', protect, authorize('institution'), async (req, res) => {
    // Redirect to call-next logic
    req.url = `/${req.params.institutionId}/call-next`;
    router.handle(req, res);
});

// ─── DELETE /api/queues/:institutionId/remove/:entryId — Remove patient ────────
router.delete('/:institutionId/remove/:entryId', protect, authorize('institution'), async (req, res) => {
    try {
        const institution = await Institution.findById(req.params.institutionId);
        if (!institution) return res.status(404).json({ error: 'Institution not found.' });
        if (institution.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Not authorized.' });
        }

        const queue = await Queue.findOne({ institution: req.params.institutionId });
        if (!queue) return res.status(404).json({ error: 'Queue not found.' });

        const entry = queue.entries.id(req.params.entryId);
        if (!entry) return res.status(404).json({ error: 'Patient not found.' });

        entry.status      = 'cancelled';
        entry.cancelledAt = new Date();
        queue.recalculatePositions();
        await queue.save();

        const io = req.app.get('io');
        await emitQueueUpdate(io, req.params.institutionId, queue, institution);

        // Notify user if linked
        if (entry.user) {
            io.to(`user:${entry.user}`).emit('removedFromQueue', {
                institutionId:   req.params.institutionId,
                institutionName: institution.name
            });
        }

        res.json({ message: 'Patient removed from queue.' });
    } catch (error) {
        console.error('Remove entry error:', error);
        res.status(500).json({ error: 'Failed to remove patient.' });
    }
});

// ─── DELETE /api/queues/:institutionId/clear — Clear entire queue ──────────────
router.delete('/:institutionId/clear', protect, authorize('institution'), async (req, res) => {
    try {
        const institution = await Institution.findById(req.params.institutionId);
        if (!institution) return res.status(404).json({ error: 'Institution not found.' });
        if (institution.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Not authorized.' });
        }

        const queue = await Queue.findOne({ institution: req.params.institutionId });
        if (!queue) return res.status(404).json({ error: 'Queue not found.' });

        queue.entries.forEach(e => {
            if (['waiting', 'in_service'].includes(e.status)) {
                e.status      = 'cancelled';
                e.cancelledAt = new Date();
            }
        });
        await queue.save();

        const io = req.app.get('io');
        io.to(`institution:${req.params.institutionId}`).emit('queueCleared', {
            institutionId: req.params.institutionId
        });

        res.json({ message: 'Queue cleared successfully.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to clear queue.' });
    }
});

module.exports = router;
