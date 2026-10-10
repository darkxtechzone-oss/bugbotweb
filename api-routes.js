const crypto = require('crypto');

// ====== CONFIG (weka kwenye Environment Variables za Render) ======
const WORKER_SECRET = process.env.WORKER_SECRET || 'sqx_worker_9f2a7c1e4b8d3f60';
// Unaweza kuweka server nyingi, zitenganishe kwa koma
const WORKER_SERVERS = (process.env.WORKER_SERVERS || 'https://bugbot-fiay.onrender.com')
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const OWNER_CODE = process.env.OWNER_CODE || '12345678';
const OWNER_TOKEN_SECRET = process.env.OWNER_TOKEN_SECRET || 'sqx_owner_9d3f7a1c8e2b4f60';
const OWNER_TOKEN_TTL_MS = 12 * 3600 * 1000;

const STATUS_TIMEOUT = 15000; // Render free inaweza kuwa inaamka
const PAIR_TIMEOUT = 30000;
const ACTION_TIMEOUT = 10000;
const VALID_STATUS = ['connected', 'connecting', 'reconnecting', 'disconnected'];

// ====== Helpers ======
function cleanNumber(raw) {
    return String(raw || '').replace(/[^0-9]/g, '');
}

function validNumber(n) {
    return n.length >= 7 && n.length <= 15; // E.164
}

function maskNumero(numero) {
    const clean = cleanNumber(numero);
    if (clean.length <= 8) return clean;
    return clean.slice(0, 5) + '****' + clean.slice(-2);
}

function workerHeaders(json) {
    const h = { 'x-worker-secret': WORKER_SECRET };
    if (json) h['Content-Type'] = 'application/json';
    return h;
}

// Rate limit rahisi (kwa IP)
const hits = new Map();
function rateLimit(name, max, windowMs) {
    return (req, res, next) => {
        const key = name + ':' + req.ip;
        const now = Date.now();
        let h = hits.get(key);
        if (!h || h.reset < now) h = { count: 0, reset: now + windowMs };
        h.count++;
        hits.set(key, h);
        if (h.count > max) return res.status(429).json({ error: 'too_many_requests' });
        next();
    };
}
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
}, 10 * 60 * 1000).unref();

async function findAvailableWorker() {
    const checks = WORKER_SERVERS.map(base =>
        fetch(`${base}/api/status`, { headers: workerHeaders(), signal: AbortSignal.timeout(STATUS_TIMEOUT) })
            .then(r => r.json())
            .then(data => (data && data.available ? base : null))
            .catch(() => null)
    );
    const available = (await Promise.all(checks)).filter(Boolean);
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
}

async function getAllSessions() {
    const checks = WORKER_SERVERS.map(base =>
        fetch(`${base}/api/sessions`, { headers: workerHeaders(), signal: AbortSignal.timeout(STATUS_TIMEOUT) })
            .then(r => r.json())
            .then(sessions => (Array.isArray(sessions) ? sessions : []))
            .catch(() => [])
    );
    const all = (await Promise.all(checks)).flat();
    // Safisha data kutoka kwa worker kabla ya kuipeleka kwenye web
    return all
        .map(s => ({
            numero: cleanNumber(s && s.numero),
            status: VALID_STATUS.includes(s && s.status) ? s.status : 'disconnected'
        }))
        .filter(s => s.numero);
}

async function disconnectOnWorkers(number) {
    return Promise.allSettled(
        WORKER_SERVERS.map(base =>
            fetch(`${base}/api/disconnect`, {
                method: 'POST',
                headers: workerHeaders(true),
                body: JSON.stringify({ numero: number }),
                signal: AbortSignal.timeout(ACTION_TIMEOUT)
            }).then(r => r.json())
        )
    );
}

// ====== Owner token ======
function sign(str) {
    return crypto.createHmac('sha256', OWNER_TOKEN_SECRET).update(str).digest('hex');
}

function issueOwnerToken() {
    const expires = String(Date.now() + OWNER_TOKEN_TTL_MS);
    return `${expires}.${sign(expires)}`;
}

function verifyOwnerToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return false;
    const [expiresStr, sig] = token.split('.');
    const expires = Number(expiresStr);
    if (!expires || expires < Date.now()) return false;
    try {
        const a = Buffer.from(sig, 'hex');
        const b = Buffer.from(sign(expiresStr), 'hex');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (e) {
        return false;
    }
}

function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

function requireOwner(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!verifyOwnerToken(token)) return res.status(401).json({ error: 'unauthorized' });
    next();
}

// ====== Routes ======
module.exports = function setupApiRoutes(app) {

    app.post('/api/pair', rateLimit('pair', 15, 10 * 60 * 1000), async (req, res) => {
        const number = cleanNumber(req.body && req.body.number);
        if (!validNumber(number)) return res.status(400).json({ error: 'invalid_number' });

        const workerBase = await findAvailableWorker();
        if (!workerBase) return res.status(503).json({ error: 'no_server_available' });

        try {
            const r = await fetch(`${workerBase}/api/generate-pair`, {
                method: 'POST',
                headers: workerHeaders(true),
                body: JSON.stringify({ numero: number }),
                signal: AbortSignal.timeout(PAIR_TIMEOUT)
            });
            const data = await r.json();
            if (!data.success) return res.status(400).json({ error: data.error || 'pairing_failed' });
            res.json({ success: true, code: data.code });
        } catch (e) {
            res.status(500).json({ error: 'pairing_failed' });
        }
    });

    app.get('/api/my-numbers', async (req, res) => {
        const raw = String(req.query.numbers || '');
        const mine = [...new Set(raw.split(',').map(cleanNumber).filter(Boolean))].slice(0, 20);
        if (mine.length === 0) return res.json({ numbers: [] });

        const sessions = await getAllSessions();
        const numbers = mine.map(numero => sessions.find(s => s.numero === numero) || { numero, status: 'disconnected' });
        res.json({ numbers });
    });

    app.post('/api/disconnect', rateLimit('disc', 20, 10 * 60 * 1000), async (req, res) => {
        const number = cleanNumber(req.body && req.body.number);
        if (!validNumber(number)) return res.status(400).json({ error: 'invalid_number' });

        await disconnectOnWorkers(number);
        res.json({ success: true });
    });

    app.get('/api/stats', async (req, res) => {
        const sessions = await getAllSessions();
        const online = sessions.filter(s => ['connected', 'connecting', 'reconnecting'].includes(s.status));
        res.json({ online: online.length, total: sessions.length });
    });

    // Orodha ya umma: namba zinafichwa upande wa server
    app.get('/api/paired-list', async (req, res) => {
        const sessions = await getAllSessions();
        res.json({ numbers: sessions.map(s => ({ numero: maskNumero(s.numero), status: s.status })) });
    });

    app.post('/api/owner/verify', rateLimit('owner', 8, 10 * 60 * 1000), (req, res) => {
        const code = String((req.body && req.body.code) || '');
        if (!safeEqual(code, OWNER_CODE)) return res.status(401).json({ error: 'invalid_code' });
        res.json({ token: issueOwnerToken() });
    });

    app.get('/api/owner/sessions', requireOwner, async (req, res) => {
        const sessions = await getAllSessions();
        res.json({ numbers: sessions });
    });

    app.post('/api/owner/disconnect', requireOwner, async (req, res) => {
        const number = cleanNumber(req.body && req.body.number);
        if (!validNumber(number)) return res.status(400).json({ error: 'invalid_number' });

        const results = await disconnectOnWorkers(number);
        const success = results.some(r => r.status === 'fulfilled' && r.value && r.value.success);
        if (!success) return res.status(400).json({ error: 'disconnect_failed' });
        res.json({ success: true });
    });
};
