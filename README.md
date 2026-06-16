# 🗺️ Smart Queue Map

> A real-time queue management system integrated with an interactive map. Skip the wait, join smart queues remotely!

![Smart Queue Map](https://img.shields.io/badge/Status-Ready%20to%20Install-brightgreen)
![Tech](https://img.shields.io/badge/Stack-Next.js%20%2B%20Node.js%20%2B%20MongoDB-blue)

---

## 🚀 Quick Start

### Prerequisites

Install these first:
1. **Node.js** (v18+): https://nodejs.org/
2. **MongoDB** (v6+): https://www.mongodb.com/try/download/community
3. **Git** (optional): https://git-scm.com/

---

## 📦 Installation

### Step 1 – Install Backend

```bash
cd backend
npm install
```

Copy `.env.example` to `.env`:
```bash
copy .env.example .env
```

Edit `.env` with your settings:
```
MONGODB_URI=mongodb://localhost:27017/smart-queue-map
JWT_SECRET=your_very_secure_secret_here
PORT=5000
FRONTEND_URL=http://localhost:3000
```

### Step 2 – Install Frontend

```bash
cd frontend
npm install
```

### Step 3 – Seed Database (Demo Data)

```bash
cd backend
npm run seed
```

This creates demo accounts:

| Role | Email | Password |
|------|-------|----------|
| 👑 Super Admin | admin@smartqueue.com | admin123456 |
| 🏥 Institution | clinic@smartqueue.com | clinic123456 |
| 🏦 Institution | bank@smartqueue.com | bank123456 |
| 👤 User | user1@smartqueue.com | user123456 |
| 👤 User | user2@smartqueue.com | user123456 |

### Step 4 – Run

**Backend** (Terminal 1):
```bash
cd backend
npm run dev
```
→ Server runs at http://localhost:5000

**Frontend** (Terminal 2):
```bash
cd frontend
npm run dev
```
→ App runs at http://localhost:3000

---

## 🌟 Features

### 👤 Regular Users
- ✅ Register / Login with JWT
- ✅ Interactive map with institution markers (OpenStreetMap)
- ✅ Search by name, category, distance
- ✅ Map View & List View toggle
- ✅ Join queues remotely with a ticket
- ✅ Live position tracking ("You are #3 in queue")
- ✅ Real-time updates via WebSocket (Socket.io)
- ✅ Notifications (in-app, pop-up alerts)
- ✅ Leave queue at any time
- ✅ User dashboard: active queues, history, profile
- ✅ QR code check-in support

### 🏥 Institution Dashboard
- ✅ Full queue management panel
- ✅ Serve next / Call specific person
- ✅ Remove users / Clear queue
- ✅ Open / Close queue toggle
- ✅ Add manual walk-in tickets
- ✅ Set max queue size & service time
- ✅ Real-time statistics (served today, avg wait)
- ✅ Peak hours bar chart
- ✅ QR Code generation for physical check-in
- ✅ Review & rating display

### 👑 Super Admin Dashboard
- ✅ Platform-wide statistics
- ✅ Verify / reject institutions
- ✅ Manage all users (activate/deactivate)
- ✅ View institution distribution by category (pie chart)
- ✅ Delete institutions

### 🗺️ Map Features
- ✅ OpenStreetMap (no API key needed!)
- ✅ Color-coded markers: 🟢 Open | 🔴 Closed | 🟡 Busy
- ✅ Filter by category (Medical, Bank, Government, etc.)
- ✅ Real-time queue size updates on map
- ✅ Click institution to see details & join queue

### 🎨 UI/UX
- ✅ Dark / Light mode toggle
- ✅ Multilingual: 🇬🇧 English | 🇫🇷 French | 🇩🇿 Arabic (RTL)
- ✅ Mobile-first responsive design
- ✅ Glass morphism UI effects
- ✅ Smooth animations (Framer Motion)
- ✅ Progressive Web App (PWA) ready
- ✅ Toast notifications

---

## 🏗️ Architecture

```
smart-queue-map/
├── backend/
│   └── src/
│       ├── server.js           # Express + Socket.io server
│       ├── models/
│       │   ├── User.js         # User model
│       │   ├── Institution.js  # Institution model (geospatial)
│       │   ├── Queue.js        # Queue model with entries
│       │   └── Notification.js
│       ├── routes/
│       │   ├── auth.js         # Register, Login, Me
│       │   ├── institutions.js # CRUD, geo-search, rating
│       │   ├── queues.js       # Join, leave, serve, remove
│       │   ├── users.js        # Profile, history, dashboard
│       │   ├── admin.js        # Super admin management
│       │   └── notifications.js
│       ├── middleware/
│       │   └── auth.js         # JWT + Role-based protection
│       ├── socket/
│       │   └── socketHandler.js # Real-time events
│       └── scripts/
│           └── seed.js         # Demo data seeder
│
└── frontend/
    └── src/
        ├── pages/
        │   ├── index.js        # Landing page
        │   ├── map.js          # Interactive map page
        │   ├── dashboard.js    # User dashboard
        │   ├── superadmin.js   # Super admin panel
        │   ├── auth/
        │   │   ├── login.js    # Login page
        │   │   └── register.js # Registration page
        │   └── institution/
        │       └── dashboard.js # Institution admin panel
        ├── components/
        │   └── MapComponent.js # Leaflet map component
        ├── context/
        │   ├── AuthContext.js  # Auth state management
        │   ├── ThemeContext.js # Dark/light mode
        │   └── I18nContext.js  # Multilingual (EN/FR/AR)
        ├── lib/
        │   ├── api.js          # Axios client
        │   └── socket.js       # Socket.io client
        └── styles/
            └── globals.css     # Global styles + design system
```

---

## 🔐 Security Features

- JWT Authentication with 7-day expiry
- bcrypt password hashing (12 rounds)
- Rate limiting (100 req/15min, 10 auth/15min)
- Helmet.js security headers
- Role-based authorization (user | institution | superadmin)
- Input validation with express-validator
- CORS protection

---

## 📡 API Endpoints

### Auth
| Method | URL | Description |
|--------|-----|-------------|
| POST | /api/auth/register | Register new user |
| POST | /api/auth/login | Login |
| GET | /api/auth/me | Get current user |

### Institutions
| Method | URL | Description |
|--------|-----|-------------|
| GET | /api/institutions | List with geo-search & filters |
| GET | /api/institutions/:id | Single institution + queue info |
| POST | /api/institutions | Create institution |
| PUT | /api/institutions/:id | Update institution |
| PATCH | /api/institutions/:id/toggle-queue | Toggle open/close |
| POST | /api/institutions/:id/rate | Rate institution |
| GET | /api/institutions/:id/qr | Get QR code |

### Queues
| Method | URL | Description |
|--------|-----|-------------|
| GET | /api/queues/:institutionId | Get queue status |
| POST | /api/queues/:institutionId/join | Join queue |
| DELETE | /api/queues/:institutionId/leave | Leave queue |
| PATCH | /api/queues/:institutionId/serve | Serve next person |
| DELETE | /api/queues/:institutionId/clear | Clear queue |
| POST | /api/queues/:institutionId/manual | Add manual ticket |

### Socket.io Events
| Event | Direction | Description |
|-------|-----------|-------------|
| subscribeToInstitution | Client→Server | Listen to institution queue |
| queueUpdated | Server→Client | Queue size/position changed |
| positionUpdated | Server→Client | User's position updated |
| yourTurn | Server→Client | User's turn arrived |
| turnNear | Server→Client | User is next |
| queueStatusChanged | Server→Client | Queue opened/closed |

---

## 🚀 Production Deployment

1. **Frontend**: Deploy to Vercel (`vercel --prod`)
2. **Backend**: Deploy to Railway, Render, or Heroku
3. **Database**: Use MongoDB Atlas (free tier available)
4. Set environment variables on your hosting platform

---

## 📱 PWA Installation

Open http://localhost:3000 in Chrome/Edge and click "Install" in the address bar to install as a native app!

---

## 🌍 Built with

- **Frontend**: Next.js 14, TailwindCSS, Framer Motion, Leaflet.js, Socket.io Client, Recharts
- **Backend**: Node.js, Express.js, Socket.io, Mongoose, JWT, bcrypt
- **Database**: MongoDB with geospatial indexing
- **Maps**: OpenStreetMap + CartoDB (no API key needed!)
- **QR Codes**: qrcode.react, qrcode (backend)

---

*Built with ❤️ for the Modern World – Smart Queue Map © 2026*
