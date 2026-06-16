const mongoose = require('mongoose');

// Only medical institution sub-categories are allowed
const MEDICAL_CATEGORIES = ['clinic', 'hospital', 'pharmacy', 'laboratory', 'dental', 'specialist', 'other'];

const institutionSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Institution name is required'],
        trim: true,
        maxlength: 200
    },
    description: {
        type: String,
        maxlength: 1000
    },
    category: {
        type: String,
        required: true,
        enum: MEDICAL_CATEGORIES,
        default: 'clinic'
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            required: true
        },
        address: String,
        city:    String,
        country: String
    },
    contact: {
        phone:   String,
        email:   String,
        website: String
    },
    workingHours: {
        monday:    { open: String, close: String, isOpen: { type: Boolean, default: true } },
        tuesday:   { open: String, close: String, isOpen: { type: Boolean, default: true } },
        wednesday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
        thursday:  { open: String, close: String, isOpen: { type: Boolean, default: true } },
        friday:    { open: String, close: String, isOpen: { type: Boolean, default: true } },
        saturday:  { open: String, close: String, isOpen: { type: Boolean, default: false } },
        sunday:    { open: String, close: String, isOpen: { type: Boolean, default: false } }
    },
    queueSettings: {
        maxQueueSize:    { type: Number, default: 100 },
        avgServiceTime:  { type: Number, default: 10 }, // minutes per person
        isQueueOpen:     { type: Boolean, default: false },
        allowRemoteJoin: { type: Boolean, default: true }
    },
    serviceWindows: [{
        name:          { type: String, required: true },
        isActive:      { type: Boolean, default: true },
        currentTicket: { type: Number, default: 0 }
    }],
    statistics: {
        totalServedToday:    { type: Number, default: 0 },
        totalServedAllTime:  { type: Number, default: 0 },
        avgWaitingTime:      { type: Number, default: 0 },
        peakHours:           [{ hour: Number, count: Number }],
        lastReset:           { type: Date, default: Date.now }
    },
    ratings: [{
        user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        rating:    { type: Number, min: 1, max: 5 },
        review:    String,
        createdAt: { type: Date, default: Date.now }
    }],
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    totalReviews:  { type: Number, default: 0 },
    images:        [String],
    logo:          String,
    verificationStatus: {
        type: String,
        enum: ['pending', 'verified', 'rejected', 'suspended'],
        default: 'pending'
    },
    verificationDocument: String, // path to uploaded document
    verificationNote:     String, // admin note on rejection/request
    verifiedAt:           Date,
    verifiedBy:           { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isVerified:    { type: Boolean, default: false },
    isActive:      { type: Boolean, default: true },
    qrCode:        String
}, {
    timestamps: true
});

// Geospatial index
institutionSchema.index({ location: '2dsphere' });
institutionSchema.index({ category: 1 });
institutionSchema.index({ 'queueSettings.isQueueOpen': 1 });
institutionSchema.index({ verificationStatus: 1 });

// Compute status virtual
institutionSchema.virtual('status').get(function () {
    if (!this.queueSettings.isQueueOpen) return 'closed';
    const queue = this._currentQueueSize || 0;
    const max   = this.queueSettings.maxQueueSize;
    if (queue >= max * 0.8) return 'busy';
    return 'open';
});

module.exports = mongoose.model('Institution', institutionSchema);
