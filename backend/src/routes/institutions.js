const express = require('express');
const { body, validationResult } = require('express-validator');
const Institution = require('../models/Institution');
const Queue       = require('../models/Queue');
const { protect, authorize, optionalAuth } = require('../middleware/auth');
const QRCode = require('qrcode');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const router = express.Router();

// Multer setup for verification documents
const uploadsDir = path.join(__dirname, '../../../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `verify_${Date.now()}_${Math.round(Math.random()*1e4)}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    const allowed = ['.pdf','.jpg','.jpeg','.png','.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
}});

const MEDICAL_CATEGORIES = ['clinic', 'hospital', 'pharmacy', 'laboratory', 'dental', 'specialist', 'other'];

// @GET /api/institutions - List/search medical institutions
router.get('/', optionalAuth, async (req, res) => {
    try {
        const {
            category, search, lat, lng, radius = 50000,
            status, page = 1, limit = 20, sortBy = 'distance'
        } = req.query;

        let query = { isActive: true, verificationStatus: 'verified' };

        // Only show medical sub-categories; ignore non-medical category filters
        if (category && category !== 'all' && MEDICAL_CATEGORIES.includes(category)) {
            query.category = category;
        }

        if (search) {
            query.$or = [
                { name:              { $regex: search, $options: 'i' } },
                { description:       { $regex: search, $options: 'i' } },
                { 'location.city':   { $regex: search, $options: 'i' } }
            ];
        }
        if (status === 'open') query['queueSettings.isQueueOpen'] = true;

        let aggregatePipeline = [];

        // Geospatial if lat/lng provided
        if (lat && lng) {
            aggregatePipeline.push({
                $geoNear: {
                    near:          { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
                    distanceField: 'distance',
                    maxDistance:   parseInt(radius),
                    spherical:     true,
                    query
                }
            });
        } else {
            aggregatePipeline.push({ $match: query });
        }

        // Join with queues to get current size
        aggregatePipeline.push({
            $lookup: {
                from:         'queues',
                localField:   '_id',
                foreignField: 'institution',
                as:           'queue'
            }
        });

        aggregatePipeline.push({
            $addFields: {
                currentQueueSize: {
                    $size: {
                        $filter: {
                            input: { $ifNull: [{ $arrayElemAt: ['$queue.entries', 0] }, []] },
                            as:    'entry',
                            cond:  { $in: ['$$entry.status', ['waiting', 'in_service']] }
                        }
                    }
                }
            }
        });

        // Sort
        if (lat && lng && sortBy === 'distance') {
            aggregatePipeline.push({ $sort: { distance: 1 } });
        } else if (sortBy === 'rating') {
            aggregatePipeline.push({ $sort: { averageRating: -1 } });
        } else {
            aggregatePipeline.push({ $sort: { createdAt: -1 } });
        }

        // Pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);
        aggregatePipeline.push({ $skip: skip });
        aggregatePipeline.push({ $limit: parseInt(limit) });
        aggregatePipeline.push({ $project: { queue: 0 } });

        const institutions = await Institution.aggregate(aggregatePipeline);
        const total        = await Institution.countDocuments(query);

        res.json({
            institutions,
            pagination: {
                page:  parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get institutions error:', error);
        res.status(500).json({ error: 'Failed to fetch institutions.' });
    }
});

// @GET /api/institutions/my — Get the logged-in institution owner's own institution
router.get('/my', protect, authorize('institution'), async (req, res) => {
    try {
        const institution = await Institution.findOne({ owner: req.user._id });
        if (!institution) {
            return res.status(404).json({ error: 'No institution profile found. Please create one.', notFound: true });
        }
        const queue         = await Queue.findOne({ institution: institution._id });
        const activeEntries = queue ? queue.getActiveEntries() : [];
        res.json({
            institution,
            queueInfo: {
                currentSize:   activeEntries.length,
                maxSize:       institution.queueSettings.maxQueueSize,
                estimatedWait: activeEntries.length * institution.queueSettings.avgServiceTime,
                isOpen:        institution.queueSettings.isQueueOpen
            }
        });
    } catch (error) {
        console.error('Get my institution error:', error);
        res.status(500).json({ error: 'Failed to fetch institution.' });
    }
});

// @GET /api/institutions/:id - Get single institution
router.get('/:id', optionalAuth, async (req, res) => {
    try {
        const institution = await Institution.findById(req.params.id)
            .populate('owner', 'name email');

        if (!institution || !institution.isActive) {
            return res.status(404).json({ error: 'Institution not found.' });
        }

        const queue        = await Queue.findOne({ institution: institution._id });
        const activeEntries = queue ? queue.getActiveEntries() : [];
        const avgServiceTime = institution.queueSettings.avgServiceTime;

        let userPosition = null;
        if (req.user && queue) {
            const userEntry = queue.entries.find(
                e => e.user && e.user.toString() === req.user._id.toString() &&
                    ['waiting', 'in_service'].includes(e.status)
            );
            if (userEntry) {
                userPosition = {
                    position:      userEntry.position,
                    ticketNumber:  userEntry.ticketNumber,
                    status:        userEntry.status,
                    estimatedWait: (userEntry.position - 1) * avgServiceTime
                };
            }
        }

        let status = 'closed';
        if (institution.queueSettings.isQueueOpen) {
            const ratio = activeEntries.length / institution.queueSettings.maxQueueSize;
            status = ratio >= 0.8 ? 'busy' : 'open';
        }

        res.json({
            institution,
            queueInfo: {
                currentSize:   activeEntries.length,
                maxSize:       institution.queueSettings.maxQueueSize,
                estimatedWait: activeEntries.length * avgServiceTime,
                status,
                isOpen:        institution.queueSettings.isQueueOpen
            },
            userPosition
        });
    } catch (error) {
        console.error('Get institution error:', error);
        res.status(500).json({ error: 'Failed to fetch institution.' });
    }
});

// @POST /api/institutions - Create institution (institution role only)
router.post('/', protect, authorize('institution'), [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('category').isIn(MEDICAL_CATEGORIES).withMessage('Must be a valid medical category'),
    body('location.coordinates').isArray({ min: 2, max: 2 }).withMessage('Coordinates required [lng, lat]')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const institutionData = {
            ...req.body,
            owner:              req.user._id,
            isVerified:         false,
            verificationStatus: 'pending'
        };

        const institution = await Institution.create(institutionData);

        // Create associated queue
        await Queue.create({
            institution: institution._id,
            date:        new Date().toISOString().split('T')[0]
        });

        // Generate QR Code
        const qrData       = `${process.env.FRONTEND_URL || 'http://localhost:5500'}/html/map.html?institution=${institution._id}`;
        const qrCodeDataURL = await QRCode.toDataURL(qrData);
        institution.qrCode  = qrCodeDataURL;
        await institution.save();

        res.status(201).json({ institution });
    } catch (error) {
        console.error('Create institution error:', error);
        res.status(500).json({ error: 'Failed to create institution.' });
    }
});

// @PUT /api/institutions/:id - Update institution
router.put('/:id', protect, authorize('institution'), async (req, res) => {
    try {
        const institution = await Institution.findById(req.params.id);
        if (!institution) return res.status(404).json({ error: 'Institution not found.' });

        if (institution.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Not authorized to update this institution.' });
        }

        // Sanitize: prevent overwriting sensitive fields
        const body = { ...req.body };
        delete body.owner;
        delete body.isVerified;
        delete body.isActive;
        delete body._id;
        delete body.ratings;
        delete body.averageRating;
        delete body.totalReviews;
        delete body.statistics;

        const updated = await Institution.findByIdAndUpdate(
            req.params.id,
            { $set: body },
            { new: true, runValidators: true }
        );

        const io = req.app.get('io');
        io.to(`institution:${req.params.id}`).emit('institutionUpdated', updated);

        res.json({ institution: updated });
    } catch (error) {
        console.error('Update institution error:', error);
        res.status(500).json({ error: 'Failed to update institution.' });
    }
});
// @POST /api/institutions/:id/upload-document - Upload verification document
router.post('/:id/upload-document', protect, authorize('institution'), upload.single('document'), async (req, res) => {
    try {
        const institution = await Institution.findById(req.params.id);
        if (!institution) return res.status(404).json({ error: 'Institution not found.' });
        if (institution.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Not authorized.' });
        }
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

        institution.verificationDocument = req.file.filename;
        // If it was rejected, allow re-submission
        if (institution.verificationStatus === 'rejected') {
            institution.verificationStatus = 'pending';
        }
        await institution.save();
        res.json({ message: 'Document uploaded.', filename: req.file.filename, verificationStatus: institution.verificationStatus });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to upload document.' });
    }
});

// @PATCH /api/institutions/:id/toggle-queue - Open/close queue
router.patch('/:id/toggle-queue', protect, authorize('institution'), async (req, res) => {
    try {
        const institution = await Institution.findById(req.params.id);
        if (!institution) return res.status(404).json({ error: 'Institution not found.' });

        if (institution.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Not authorized.' });
        }

        institution.queueSettings.isQueueOpen = !institution.queueSettings.isQueueOpen;
        await institution.save();

        const io = req.app.get('io');
        io.to(`institution:${req.params.id}`).emit('queueStatusChanged', {
            institutionId: req.params.id,
            isOpen:        institution.queueSettings.isQueueOpen
        });

        res.json({
            message: `Queue ${institution.queueSettings.isQueueOpen ? 'opened' : 'closed'} successfully`,
            isOpen:  institution.queueSettings.isQueueOpen
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to toggle queue.' });
    }
});

// @POST /api/institutions/:id/rate - Rate institution
router.post('/:id/rate', protect, authorize('user'), [
    body('rating').isInt({ min: 1, max: 5 }),
    body('review').optional().isLength({ max: 500 })
], async (req, res) => {
    try {
        const { rating, review } = req.body;
        const institution = await Institution.findById(req.params.id);
        if (!institution) return res.status(404).json({ error: 'Institution not found.' });

        const existingIdx = institution.ratings.findIndex(
            r => r.user.toString() === req.user._id.toString()
        );

        if (existingIdx >= 0) {
            institution.ratings[existingIdx] = { user: req.user._id, rating, review, createdAt: new Date() };
        } else {
            institution.ratings.push({ user: req.user._id, rating, review });
        }

        const total = institution.ratings.reduce((sum, r) => sum + r.rating, 0);
        institution.averageRating = total / institution.ratings.length;
        institution.totalReviews  = institution.ratings.length;
        await institution.save();

        res.json({ message: 'Rating submitted successfully', averageRating: institution.averageRating });
    } catch (error) {
        res.status(500).json({ error: 'Failed to submit rating.' });
    }
});

// @GET /api/institutions/:id/qr - Get QR Code
router.get('/:id/qr', async (req, res) => {
    try {
        const institution = await Institution.findById(req.params.id, 'qrCode name');
        if (!institution) return res.status(404).json({ error: 'Institution not found.' });
        res.json({ qrCode: institution.qrCode, institutionName: institution.name });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch QR code.' });
    }
});

module.exports = router;
