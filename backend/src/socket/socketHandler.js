const jwt = require('jsonwebtoken');
const User = require('../models/User');

const socketHandler = (io) => {
    // Auth middleware for sockets
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth?.token || socket.handshake.query?.token;
            if (token) {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'hojozat_secret_key_change_in_production');
                const user = await User.findById(decoded.id).select('-password');
                if (user) {
                    socket.user = user;
                    socket.userId = user._id.toString();
                }
            }
            next();
        } catch {
            next(); // Allow unauthenticated connections for public data
        }
    });

    io.on('connection', (socket) => {
        console.log(`🔌 Client connected: ${socket.id} ${socket.user ? `(${socket.user.name})` : '(anonymous)'}`);

        // Join personal room for authenticated users
        if (socket.user) {
            socket.join(`user:${socket.userId}`);
        }

        // Subscribe to institution updates
        socket.on('subscribeToInstitution', (institutionId) => {
            socket.join(`institution:${institutionId}`);
            console.log(`📍 ${socket.id} subscribed to institution:${institutionId}`);
        });

        // Unsubscribe from institution
        socket.on('unsubscribeFromInstitution', (institutionId) => {
            socket.leave(`institution:${institutionId}`);
        });

        // Subscribe to map (for live institution markers)
        socket.on('subscribeToMap', () => {
            socket.join('map');
        });

        // Ping/pong for connection health
        socket.on('ping', () => {
            socket.emit('pong', { timestamp: Date.now() });
        });

        socket.on('disconnect', () => {
            console.log(`🔌 Client disconnected: ${socket.id}`);
        });
    });
};

module.exports = { socketHandler };
