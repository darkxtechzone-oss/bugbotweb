const express = require('express');
const setupApiRoutes = require('./api-routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

// CORS kwa /api
app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// Render health check
app.get('/health', (req, res) => res.json({ ok: true }));

// API routes
setupApiRoutes(app);

// Kurasa za web (flat) - ni faili zilizoruhusiwa tu ndizo zinatolewa,
// ili server.js / api-routes.js zisionekane kwa mtu yeyote
const page = (file) => (req, res) => res.sendFile(file, { root: __dirname });
app.get('/', page('index.html'));
app.get('/owner', page('owner.html'));
app.get('/admin', page('owner.html'));
app.get('/countries.json', page('countries.json'));
app.get('/favicon.ico', (req, res) => res.sendStatus(204));

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
app.use((req, res) => res.status(404).send('Page not found'));

// JSON mbovu
app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`DarkX WaBot web running on port ${PORT}`);
});
