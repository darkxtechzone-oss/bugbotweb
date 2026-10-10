
const express = require('express');
const app = express();

app.set('trust proxy', true);
app.use(express.json());

const setupApiRoutes = require('./api-routes');
setupApiRoutes(app);

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`DarkX Worker API running on port ${PORT}`);
});
