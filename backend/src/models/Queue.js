const mongoose = require('mongoose');

const queueEntrySchema = new mongoose.Schema({
    // For remote (app) joins — linked to a user account
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    // For manual (walk-in) entries — filled by institution staff
    firstName:  { type: String, trim: true, default: '' },
    lastName:   { type: String, trim: true, default: '' },
    phone:      { type: String, trim: true, default: '' },

    // Display name: manual entries use firstName+lastName, remote entries use user.name
    displayName: { type: String, trim: true, default: '' },

    ticketNumber: { type: Number, required: true },
    position:     { type: Number, required: true },

    // Simplified status matching real clinic flow
    status: {
        type: String,
        enum: ['waiting', 'in_service', 'completed', 'cancelled'],
        default: 'waiting'
    },

    joinMethod: {
        type: String,
        enum: ['remote', 'manual'],
        default: 'remote'
    },

    joinedAt:    { type: Date, default: Date.now },
    calledAt:    Date,
    completedAt: Date,
    cancelledAt: Date,
    notes:       String
}, { _id: true });

const queueSchema = new mongoose.Schema({
    institution: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Institution',
        required: true,
        unique: true
    },
    entries:          [queueEntrySchema],
    currentTicket:    { type: Number, default: 0 },
    nextTicketNumber: { type: Number, default: 1 },
    isOpen:           { type: Boolean, default: false },
    totalServedToday: { type: Number, default: 0 },
    date:             { type: String } // YYYY-MM-DD
}, {
    timestamps: true
});

// ── Virtual: active entries (waiting + in_service) ──
queueSchema.virtual('activeSize').get(function () {
    return this.entries.filter(e => ['waiting', 'in_service'].includes(e.status)).length;
});

// ── Get active entries sorted by position ──
queueSchema.methods.getActiveEntries = function () {
    return this.entries
        .filter(e => ['waiting', 'in_service'].includes(e.status))
        .sort((a, b) => a.position - b.position);
};

// ── Get the patient currently in service ──
queueSchema.methods.getInServiceEntry = function () {
    return this.entries.find(e => e.status === 'in_service') || null;
};

// ── Add a remote (app) entry ──
queueSchema.methods.addEntry = function (userId, joinMethod = 'remote', displayName = '') {
    const activeEntries = this.getActiveEntries();
    const position      = activeEntries.length + 1;

    const entry = {
        user:         userId,
        displayName:  displayName || 'Patient',
        firstName:    '',
        lastName:     '',
        phone:        '',
        ticketNumber: this.nextTicketNumber,
        position,
        status:       'waiting',
        joinMethod,
        joinedAt:     new Date()
    };

    this.nextTicketNumber += 1;
    this.entries.push(entry);
    return this.entries[this.entries.length - 1]; // return subdoc with _id
};

// ── Add a manual (walk-in) entry ──
queueSchema.methods.addManualEntry = function (firstName, lastName, phone, notes = '') {
    const activeEntries = this.getActiveEntries();
    const position      = activeEntries.length + 1;
    const fullName      = `${firstName} ${lastName}`.trim() || 'Walk-in';

    const entry = {
        user:         null,
        displayName:  fullName,
        firstName,
        lastName,
        phone,
        notes,
        ticketNumber: this.nextTicketNumber,
        position,
        status:       'waiting',
        joinMethod:   'manual',
        joinedAt:     new Date()
    };

    this.nextTicketNumber += 1;
    this.entries.push(entry);
    return this.entries[this.entries.length - 1];
};

// ── Recalculate positions (call after any status change) ──
queueSchema.methods.recalculatePositions = function () {
    const active = this.entries
        .filter(e => ['waiting', 'in_service'].includes(e.status))
        .sort((a, b) => a.joinedAt - b.joinedAt);

    active.forEach((entry, index) => {
        const e = this.entries.id(entry._id);
        if (e) e.position = index + 1;
    });
};

module.exports = mongoose.model('Queue', queueSchema);
