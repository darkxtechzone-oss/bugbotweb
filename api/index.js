
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

// Serve HTML, CSS, JS and other static files from root
app.use(express.static(__dirname));

// Homepage
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Owner page
app.get('/owner', (req, res) => {
    res.sendFile(path.join(__dirname, 'owner.html'));
});

// Admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'owner.html'));
});

// Handle unknown routes
app.use((req, res) => {
    res.status(404).send('Page not found');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`BugBot Website running on port ${PORT}`);
});
