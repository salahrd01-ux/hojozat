const ADMIN_API = 'http://localhost:5000/api/admin';
const API_URL   = 'http://localhost:5000/api';

const AdminAuth = (() => {
    const TK = 'hojozat_admin_token', UK = 'hojozat_admin_user';
    return {
        getToken: () => localStorage.getItem(TK),
        getUser:  () => { try { return JSON.parse(localStorage.getItem(UK)); } catch { return null; } },
        isLoggedIn: () => !!(localStorage.getItem(TK) && localStorage.getItem(UK)),
        save: (token, user) => { localStorage.setItem(TK, token); localStorage.setItem(UK, JSON.stringify(user)); },
        logout: () => { localStorage.removeItem(TK); localStorage.removeItem(UK); window.location.href = 'login.html'; },
        require: () => { if (!AdminAuth.isLoggedIn()) { window.location.href = 'login.html'; return null; } return AdminAuth.getUser(); }
    };
})();

const AdminAPI = (() => {
    async function req(method, url, data = null) {
        const headers = { 'Content-Type': 'application/json' };
        const token = AdminAuth.getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const opts = { method, headers };
        if (data) opts.body = JSON.stringify(data);
        let res;
        try { res = await fetch(url, opts); } catch { throw { response: { data: { error: 'Cannot connect to server.' }, status: 0 } }; }
        if (res.status === 401) { AdminAuth.logout(); throw new Error('Unauthorized'); }
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw { response: { data: json, status: res.status } };
        return json;
    }
    return {
        get:    (path, params) => { let url = `${ADMIN_API}${path}`; if (params) { const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v != null && v !== '')).toString(); if (qs) url += '?' + qs; } return req('GET', url); },
        post:   (path, data)  => req('POST',   `${ADMIN_API}${path}`, data),
        put:    (path, data)  => req('PUT',     `${ADMIN_API}${path}`, data),
        patch:  (path, data)  => req('PATCH',   `${ADMIN_API}${path}`, data),
        delete: (path)        => req('DELETE',  `${ADMIN_API}${path}`),
    };
})();

const Toast = (() => {
    function getC() { let c = document.getElementById('toast-container'); if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); } return c; }
    function show(msg, type = 'info', dur = 3500) {
        const c = getC(), el = document.createElement('div');
        const icons = { success: '✅', error: '❌', info: 'ℹ️' };
        el.className = `toast toast-${type}`;
        el.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
        c.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(100%)'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 300); }, dur);
    }
    return { success: m => show(m, 'success'), error: m => show(m, 'error'), info: m => show(m, 'info') };
})();

function statusBadge(status) {
    const map = { verified: 'badge-verified', pending: 'badge-pending', rejected: 'badge-rejected', suspended: 'badge-suspended' };
    return `<span class="badge ${map[status] || 'badge-pending'}">${status || 'pending'}</span>`;
}

function formatDate(d) { return d ? new Date(d).toLocaleDateString() : '—'; }
function formatDateTime(d) { return d ? new Date(d).toLocaleString() : '—'; }
function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
