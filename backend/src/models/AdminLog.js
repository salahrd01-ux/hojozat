const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema({
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: {
        type: String,
        enum: ['login', 'approve_institution', 'reject_institution', 'suspend_institution',
               'delete_institution', 'edit_institution', 'suspend_user', 'delete_user',
               'force_close_queue', 'remove_patient', 'reset_queue', 'failed_login'],
        required: true
    },
    targetType: { type: String, enum: ['institution', 'user', 'queue', 'system'], default: 'system' },
    targetId:   { type: mongoose.Schema.Types.ObjectId },
    details:    String,
    ip:         String,
    userAgent:  String
}, { timestamps: true });

adminLogSchema.index({ admin: 1, createdAt: -1 });
adminLogSchema.index({ action: 1 });

module.exports = mongoose.model('AdminLog', adminLogSchema);
