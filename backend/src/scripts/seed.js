require('dotenv').config();
const mongoose = require('mongoose');
const User        = require('../models/User');
const Institution = require('../models/Institution');
const Queue       = require('../models/Queue');

const seed = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hojozat');
        console.log('✅ Connected to MongoDB');

        // Clear existing data
        await User.deleteMany({});
        await Institution.deleteMany({});
        await Queue.deleteMany({});
        console.log('🗑️  Cleared existing data');

        // ── Users ──────────────────────────────────────────────────
        const [admin, owner1, owner2, user1, user2] = await Promise.all([
            User.create({
                name:       'Admin',
                email:      'admin@hojozat.com',
                password:   'admin123456',
                role:       'admin',
                isVerified: true,
                isActive:   true
            }),
            User.create({
                name:       'Dr. Ahmed Al-Rashid',
                email:      'clinic@hojozat.com',
                password:   'clinic123456',
                role:       'institution',
                phone:      '+213555001001',
                isVerified: true
            }),
            User.create({
                name:       'Dr. Sara Meziane',
                email:      'hospital@hojozat.com',
                password:   'hospital123456',
                role:       'institution',
                phone:      '+213555002002',
                isVerified: true
            }),
            User.create({
                name:       'Youssef Benali',
                email:      'user1@hojozat.com',
                password:   'user123456',
                role:       'user',
                phone:      '+213555100001'
            }),
            User.create({
                name:       'Fatima Zahra',
                email:      'user2@hojozat.com',
                password:   'user123456',
                role:       'user',
                phone:      '+213555100002'
            })
        ]);

        // ── Medical Institutions ───────────────────────────────────
        const institutions = await Institution.insertMany([
            {
                name:        'Clinique El Shifa',
                description: 'Modern medical clinic specialising in cardiology, paediatrics, and general medicine.',
                category:    'clinic',
                owner:       owner1._id,
                location: {
                    type:        'Point',
                    coordinates: [3.0588, 36.7538],
                    address:     'Rue Didouche Mourad, Alger Centre',
                    city:        'Algiers',
                    country:     'Algeria'
                },
                contact: { phone: '+213 21 63 45 78', email: 'contact@elshifa.dz' },
                workingHours: {
                    monday:    { open: '08:00', close: '18:00', isOpen: true },
                    tuesday:   { open: '08:00', close: '18:00', isOpen: true },
                    wednesday: { open: '08:00', close: '18:00', isOpen: true },
                    thursday:  { open: '08:00', close: '18:00', isOpen: true },
                    friday:    { open: '14:00', close: '18:00', isOpen: true },
                    saturday:  { open: '09:00', close: '13:00', isOpen: true },
                    sunday:    { open: '00:00', close: '00:00', isOpen: false }
                },
                queueSettings: { maxQueueSize: 30, avgServiceTime: 15, isQueueOpen: true, allowRemoteJoin: true },
                serviceWindows: [
                    { name: 'General Medicine', isActive: true },
                    { name: 'Cardiology',       isActive: true },
                    { name: 'Paediatrics',      isActive: true }
                ],
                averageRating: 4.5,
                totalReviews:  120,
                isVerified:    true,
                verificationStatus: 'verified',
                statistics:    { totalServedToday: 45, totalServedAllTime: 3200, avgWaitingTime: 12 }
            },
            {
                name:        'Hôpital Mustapha Pacha',
                description: 'Central university hospital providing emergency, surgery, and specialised medical care.',
                category:    'hospital',
                owner:       owner2._id,
                location: {
                    type:        'Point',
                    coordinates: [3.0620, 36.7490],
                    address:     '1 Rue Abderrahmane Mira, El Madania',
                    city:        'Algiers',
                    country:     'Algeria'
                },
                contact: { phone: '+213 21 23 39 20', email: 'info@chum.dz' },
                queueSettings: { maxQueueSize: 200, avgServiceTime: 30, isQueueOpen: true, allowRemoteJoin: true },
                averageRating: 3.2,
                totalReviews:  450,
                isVerified:    true,
                verificationStatus: 'verified',
                statistics:    { totalServedToday: 300, totalServedAllTime: 50000, avgWaitingTime: 60 }
            },
            {
                name:        'Pharmacie Centrale d\'Alger',
                description: 'Full-service pharmacy with prescription dispensing and health consultations.',
                category:    'pharmacy',
                owner:       owner1._id,
                location: {
                    type:        'Point',
                    coordinates: [3.0650, 36.7560],
                    address:     'Boulevard Zighout Youcef, Alger Centre',
                    city:        'Algiers',
                    country:     'Algeria'
                },
                contact: { phone: '+213 21 60 11 22' },
                queueSettings: { maxQueueSize: 20, avgServiceTime: 5, isQueueOpen: true, allowRemoteJoin: true },
                averageRating: 4.1,
                totalReviews:  80,
                isVerified:    true,
                verificationStatus: 'verified',
                statistics:    { totalServedToday: 95, totalServedAllTime: 8000, avgWaitingTime: 8 }
            },
            {
                name:        'Laboratoire Bio-Analyse',
                description: 'Medical analysis laboratory offering blood tests, imaging, and pathology services.',
                category:    'laboratory',
                owner:       owner2._id,
                location: {
                    type:        'Point',
                    coordinates: [3.0700, 36.7380],
                    address:     'Rue Belouizdad, Belouizdad',
                    city:        'Algiers',
                    country:     'Algeria'
                },
                contact: { phone: '+213 21 66 78 90' },
                queueSettings: { maxQueueSize: 40, avgServiceTime: 10, isQueueOpen: true, allowRemoteJoin: true },
                averageRating: 4.3,
                totalReviews:  95,
                isVerified:    true,
                verificationStatus: 'verified',
                statistics:    { totalServedToday: 60, totalServedAllTime: 5000, avgWaitingTime: 15 }
            },
            {
                name:        'Cabinet Dentaire Dr. Benali',
                description: 'General and cosmetic dentistry: consultations, fillings, orthodontics.',
                category:    'dental',
                owner:       owner1._id,
                location: {
                    type:        'Point',
                    coordinates: [3.0540, 36.7610],
                    address:     'Bir Mourad Raïs, Algiers',
                    city:        'Algiers',
                    country:     'Algeria'
                },
                contact: { phone: '+213 21 54 32 10' },
                queueSettings: { maxQueueSize: 15, avgServiceTime: 30, isQueueOpen: false, allowRemoteJoin: true },
                averageRating: 4.8,
                totalReviews:  60,
                isVerified:    true,
                verificationStatus: 'verified',
                statistics:    { totalServedToday: 8, totalServedAllTime: 1200, avgWaitingTime: 25 }
            }
        ]);

        // ── Create queues with demo entries ───────────────────────
        for (const inst of institutions) {
            const queue = await Queue.create({
                institution:      inst._id,
                isOpen:           inst.queueSettings.isQueueOpen,
                date:             new Date().toISOString().split('T')[0],
                nextTicketNumber: 1
            });

            if (inst.queueSettings.isQueueOpen) {
                queue.entries.push(
                    { user: user1._id, displayName: user1.name, firstName: 'Youssef', lastName: 'Benali', phone: '+213555100001', ticketNumber: 1, position: 1, status: 'waiting', joinMethod: 'remote', joinedAt: new Date(Date.now() - 20 * 60000) },
                    { user: user2._id, displayName: user2.name, firstName: 'Fatima',  lastName: 'Zahra',  phone: '+213555100002', ticketNumber: 2, position: 2, status: 'waiting', joinMethod: 'remote', joinedAt: new Date(Date.now() - 10 * 60000) }
                );
                queue.nextTicketNumber = 3;
                await queue.save();
            }
        }

        console.log('\n✅ Seed completed successfully!\n');
        console.log('📋 Demo Accounts (use these to log in):');
        console.log('  Admin       : admin@hojozat.com     / admin123456');
        console.log('  Institution : clinic@hojozat.com    / clinic123456');
        console.log('  Institution : hospital@hojozat.com  / hospital123456');
        console.log('  User        : user1@hojozat.com     / user123456');
        console.log('  User        : user2@hojozat.com     / user123456');
        console.log('\n🏥 Seeded Medical Institutions:');
        institutions.forEach(i => console.log(`  - ${i.name} (${i.category})`));
        process.exit(0);
    } catch (error) {
        console.error('❌ Seed error:', error.message);
        console.error(error);
        process.exit(1);
    }
};

seed();
