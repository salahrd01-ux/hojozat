/**
 * app.js – Core utilities for Hojozat
 * Auth, API, Socket, Theme helpers
 */

// =============================================
// CONFIG
// =============================================
// Auto-detect production backend URL or fallback to localhost
const BACKEND_PROD_URL = 'https://hojozat-backend.onrender.com'; // Replace with your Render backend URL once deployed

const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000/api'
    : (window.location.origin.includes('vercel.app')
        ? BACKEND_PROD_URL + '/api'
        : window.location.origin + '/api');

const SOCKET_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000'
    : (window.location.origin.includes('vercel.app')
        ? BACKEND_PROD_URL
        : window.location.origin);

// =============================================
// TOAST NOTIFICATIONS
// =============================================
const Toast = (() => {
    function getContainer() {
        let c = document.getElementById('toast-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'toast-container';
            document.body.appendChild(c);
        }
        return c;
    }

    function show(message, type = 'info', duration = 3500) {
        const c   = getContainer();
        const el  = document.createElement('div');
        const icons = { success: '✅', error: '❌', info: 'ℹ️' };
        el.className = `toast toast-${type}`;
        el.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
        c.appendChild(el);
        setTimeout(() => {
            el.style.opacity   = '0';
            el.style.transform = 'translateX(100%)';
            el.style.transition = '0.3s ease';
            setTimeout(() => el.remove(), 300);
        }, duration);
    }

    return {
        success: (msg, dur) => show(msg, 'success', dur),
        error:   (msg, dur) => show(msg, 'error',   dur),
        info:    (msg, dur) => show(msg, 'info',    dur),
    };
})();

// =============================================
// AUTH
// =============================================
const Auth = (() => {
    const TOKEN_KEY = 'hojozat_token';
    const USER_KEY  = 'hojozat_user';

    function getToken()  { return localStorage.getItem(TOKEN_KEY); }
    function getUser() {
        try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
    }
    function isLoggedIn() { return !!(getToken() && getUser()); }

    async function login(email, password) {
        const res = await API.post('/auth/login', { email, password });
        const { token, user } = res;
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        return user;
    }

    async function register(data) {
        const res = await API.post('/auth/register', data);
        const { token, user } = res;
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        return user;
    }

    function logout() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        Socket.disconnect();
        // Navigate to index from wherever we are
        const depth = window.location.pathname.split('/').filter(Boolean).length;
        const prefix = depth > 2 ? '../' : '';
        window.location.href = prefix + 'index.html';
    }

    function updateUser(updatedData) {
        const current = getUser() || {};
        const merged  = { ...current, ...updatedData };
        localStorage.setItem(USER_KEY, JSON.stringify(merged));
        return merged;
    }

    function requireAuth(role) {
        const user = getUser();
        // Determine correct relative path based on page depth
        const depth = window.location.pathname.split('/').filter(Boolean).length;
        const loginPath = depth > 2 ? '../auth/login.html' : 'auth/login.html';

        if (!user) {
            window.location.href = loginPath;
            return null;
        }
        if (role && user.role !== role) {
            if (user.role === 'institution') {
                window.location.href = (depth > 2 ? '../' : '') + 'institution/dashboard.html';
            } else {
                window.location.href = (depth > 2 ? '../' : '') + 'dashboard.html';
            }
            return null;
        }
        return user;
    }

    return { getToken, getUser, isLoggedIn, login, register, logout, updateUser, requireAuth };
})();

// =============================================
// API (fetch wrapper)
// =============================================
const API = (() => {
    async function request(method, path, data = null, params = null) {
        const token   = Auth.getToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        let url = `${API_URL}${path}`;
        if (params) {
            const qs = new URLSearchParams(
                Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
            ).toString();
            if (qs) url += '?' + qs;
        }

        const opts = { method, headers };
        if (data) opts.body = JSON.stringify(data);

        let res;
        try {
            res = await fetch(url, opts);
        } catch (networkErr) {
            throw { response: { data: { error: 'Cannot connect to server. Is the backend running?' }, status: 0 } };
        }

        if (res.status === 401) {
            localStorage.removeItem('hojozat_token');
            localStorage.removeItem('hojozat_user');
            const depth = window.location.pathname.split('/').filter(Boolean).length;
            window.location.href = depth > 2 ? '../auth/login.html' : 'auth/login.html';
            throw new Error('Unauthorized');
        }

        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw { response: { data: json, status: res.status } };
        return json;
    }

    return {
        get:    (path, opts = {}) => request('GET',    path, null, opts.params),
        post:   (path, data)      => request('POST',   path, data),
        put:    (path, data)      => request('PUT',    path, data),
        patch:  (path, data)      => request('PATCH',  path, data),
        delete: (path)            => request('DELETE', path),
    };
})();

// =============================================
// SOCKET
// =============================================
const Socket = (() => {
    let socket = null;

    function connect() {
        if (socket || typeof io === 'undefined') return socket;
        const token = Auth.getToken();
        socket = io(SOCKET_URL, {
            auth:                { token },
            transports:          ['websocket', 'polling'],
            reconnectionAttempts: 5,
            reconnectionDelay:   1000,
        });
        socket.on('connect',       () => console.log('🔌 Socket connected'));
        socket.on('disconnect',    r  => console.log('🔌 Socket disconnected:', r));
        socket.on('connect_error', e  => console.warn('Socket error:', e.message));
        return socket;
    }

    function get()         { return socket || connect(); }
    function on(ev, fn)    { get()?.on(ev, fn); }
    function off(ev, fn)   { socket?.off(ev, fn); }
    function emit(ev, dat) { get()?.emit(ev, dat); }

    function disconnect() {
        if (socket) { socket.disconnect(); socket = null; }
    }

    function subscribeToInstitution(id)    { emit('subscribeToInstitution', id); }
    function unsubscribeFromInstitution(id){ emit('unsubscribeFromInstitution', id); }

    return { connect, get, on, off, emit, disconnect, subscribeToInstitution, unsubscribeFromInstitution };
})();

// =============================================
// THEME
// =============================================
const Theme = (() => {
    const KEY = 'hojozat_theme';

    function isDark() { return (localStorage.getItem(KEY) || 'light') === 'dark'; }

    function apply() {
        if (isDark()) document.documentElement.classList.add('dark');
        else          document.documentElement.classList.remove('dark');
        document.querySelectorAll('[data-theme-icon]').forEach(el => {
            el.textContent = isDark() ? '☀️' : '🌙';
        });
    }

    function toggle() {
        localStorage.setItem(KEY, isDark() ? 'light' : 'dark');
        apply();
    }

    apply(); // auto-apply on load

    return { isDark, apply, toggle };
})();

// =============================================
// HELPERS
// =============================================
function $(sel, ctx = document)  { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

function formatTime(date)     { return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function formatDate(date)     { return new Date(date).toLocaleDateString(); }
function formatDateTime(date) { return new Date(date).toLocaleString(); }

// Auto-attach theme toggle buttons
document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', e => {
        if (e.target.closest('[data-toggle-theme]')) Theme.toggle();
    });
});
