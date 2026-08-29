require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { securityHeaders, createRateLimiter } = require('./middleware/security');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required');
  process.exit(1);
}

const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Keep brute-force / account abuse bounded. These stores are process-local,
// which matches the current single-replica deployment.
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'login' });
const registerLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: 'register' });
const passwordLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'password' });
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/auth/password', passwordLimiter);
app.use('/api/auth/forgot-password', passwordLimiter);
app.use('/api/auth/reset-password', passwordLimiter);

const publicDirectory = path.join(__dirname, 'public');
const landingTemplate = fs.readFileSync(path.join(publicDirectory, 'landing.html'), 'utf8');
const SEO_TITLE = 'Provista — Shared Grocery List, Meal Planner & Pantry Tracker';
const SEO_DESCRIPTION = 'A shared grocery list and meal planning app for households. Organize shopping by store section, track pantry needs, and keep grocery spending together.';

function resolvePublicOrigin(req) {
  let publicUrl = String(process.env.APP_BASE_URL || '').trim();
  if (!publicUrl && process.env.NODE_ENV !== 'production') {
    publicUrl = `${req.protocol}://${req.get('host')}`;
  }

  try {
    const origin = new URL(publicUrl);
    if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Unsupported public URL protocol');
    return origin;
  } catch (_) {
    return null;
  }
}

function renderLandingPage(req) {
  const origin = resolvePublicOrigin(req);
  let html = landingTemplate
    .replace(/<title>.*?<\/title>/, `<title>${SEO_TITLE}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${SEO_DESCRIPTION}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${SEO_TITLE}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${SEO_DESCRIPTION}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${SEO_TITLE}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${SEO_DESCRIPTION}" />`);

  if (!origin) {
    return html
      .replace(/^.*__PROVISTA_PUBLIC_URL__.*\n/gm, '')
      .replace(/^.*__PROVISTA_OG_IMAGE_URL__.*\n/gm, '');
  }

  const canonicalUrl = new URL('/', origin).href;
  const imageUrl = new URL('/og.jpg', origin).href;
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Provista',
    applicationCategory: 'LifestyleApplication',
    operatingSystem: 'Web',
    url: canonicalUrl,
    description: SEO_DESCRIPTION,
    featureList: [
      'Shared grocery lists',
      'Grocery list organization by store section',
      'Household meal planning',
      'Pantry tracking',
      'Grocery price and spending history'
    ]
  }).replace(/</g, '\\u003c');

  html = html
    .replaceAll('__PROVISTA_PUBLIC_URL__', canonicalUrl)
    .replaceAll('__PROVISTA_OG_IMAGE_URL__', imageUrl)
    .replace('</head>', `  <link rel="canonical" href="${canonicalUrl}" />\n  <script type="application/ld+json">${structuredData}</script>\n</head>`);

  return html;
}

app.get('/landing.html', (req, res) => {
  res.type('html').send(renderLandingPage(req));
});

app.get('/robots.txt', (req, res) => {
  const origin = resolvePublicOrigin(req);
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /app', 'Disallow: /api/'];
  if (origin) lines.push(`Sitemap: ${new URL('/sitemap.xml', origin).href}`);
  res.type('text/plain').send(`${lines.join('\n')}\n`);
});

app.get('/sitemap.xml', (req, res) => {
  const origin = resolvePublicOrigin(req);
  if (!origin) return res.status(404).type('text/plain').send('Public URL is not configured');
  const canonicalUrl = new URL('/', origin).href;
  return res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url><loc>${canonicalUrl}</loc></url>\n` +
    `</urlset>\n`
  );
});

app.use(express.static(publicDirectory, { index: false }));

// Health check (no auth required)
app.use('/api/health', require('./routes/health'));

// Auth routes
app.use('/api/auth', require('./routes/auth'));

// Household management
app.use('/api/household', require('./routes/household'));

// Data routes (all require auth via route-level middleware)
app.use('/api/items', require('./routes/items'));
app.use('/api/item-sections', require('./routes/itemSections'));
app.use('/api/stores', require('./routes/stores'));
app.use('/api/prices', require('./routes/prices'));
app.use('/api/external-prices', require('./routes/externalPrices'));
app.use('/api/grocery', require('./routes/grocery'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/shopping-list', require('./routes/shoppingList'));
app.use('/api/shopping-trips', require('./routes/shoppingTrips'));
app.use('/api/spend', require('./routes/spend'));
app.use('/api/meal-plan', require('./routes/mealPlan'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/barcode', require('./routes/barcode'));

// Serve login page for /join route (join via QR code link)
app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// The public root explains Provista before asking someone to create an account.
// Returning users with a valid session continue directly into the app.
app.get('/', (req, res) => {
  try {
    jwt.verify(req.cookies?.token, process.env.JWT_SECRET);
    return res.sendFile(path.join(publicDirectory, 'index.html'));
  } catch (_) {
    return res.type('html').send(renderLandingPage(req));
  }
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(publicDirectory, 'index.html'));
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDirectory, 'index.html'));
});

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/grocerytracker';

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  // Listen immediately so Railway's liveness check succeeds while DB connects.
  // Deployment readiness should use /api/health/ready.
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });

  mongoose.connect(MONGODB_URI)
    .then(() => {
      console.log('Connected to MongoDB');
    })
    .catch(err => {
      console.error('MongoDB connection error:', err);
      process.exit(1);
    });
}

module.exports = app;