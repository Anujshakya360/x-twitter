const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const routes = require('./routes');
const { errorHandler, notFound } = require('./middleware/error');

const app = express();

app.set('trust proxy', 1); // correct client IPs behind a proxy, for rate limiting

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// credentials:true is required for the httpOnly refresh cookie to travel.
app.use(cors({
  origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(','),
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.use(rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

app.use('/uploads', express.static(path.join(__dirname, '../uploads'), { maxAge: '7d' }));

// Serve the frontend (index.html, login.html, css/, js/) from the backend root.
// Dev convenience: same-origin means zero CORS friction while you build.
app.use(express.static(path.join(__dirname, '../')));
app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
