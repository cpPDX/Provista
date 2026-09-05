require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const { securityHeaders } = require('./middleware/security');

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
const commonLimiterOptions = {
  standardHeaders: 'draft-6',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  skip: () => process.env.NODE_ENV === 'test'
};
const loginLimiter = rateLimit({ ...commonLimiterOptions, windowMs: 15 * 60 * 1000, limit: 20 });
const registerLimiter = rateLimit({ ...commonLimiterOptions, windowMs: 60 * 60 * 1000, limit: 10 });
const passwordLimiter = rateLimit({ ...commonLimiterOptions, windowMs: 15 * 60 * 1000, limit: 10 });
// These routes only return the small React HTML shell. The generous ceiling
// blocks abusive filesystem traffic while staying invisible during normal use.
const appShellLimiter = rateLimit({ ...commonLimiterOptions, windowMs: 60 * 1000, limit: 240 });
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/auth/password', passwordLimiter);
app.use('/api/auth/forgot-password', passwordLimiter);
app.use('/api/auth/reset-password', passwordLimiter);

const publicDirectory = path.join(__dirname, 'public');
const reactAppIndex = path.join(publicDirectory, 'react-preview', 'index.html');
const legacyAppIndex = path.join(publicDirectory, 'index.html');
const landingTemplate = fs.readFileSync(path.join(publicDirectory, 'landing.html'), 'utf8');
const legacyAppTemplate = fs.readFileSync(legacyAppIndex, 'utf8');
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
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /app', 'Disallow: /legacy-app', 'Disallow: /api/', 'Disallow: /react-preview/'];
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

// Household management + first-run orchestration
app.use('/api/household', require('./routes/household'));
app.use('/api/onboarding', require('./routes/onboarding'));

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

function serveLegacyApp(req, res) {
  const html = legacyAppTemplate.replace(
    '</body>',
    '  <script src="/js/reactHomeBridge.js"></script>\n</body>'
  );
  return res.type('html').send(html);
}

function serveReactApp(req, res) {
  // Development/test environments can still run the legacy app before the
  // client build exists. Production and CI build React before starting.
  if (!fs.existsSync(reactAppIndex)) return serveLegacyApp(req, res);
  return res.sendFile(reactAppIndex);
}

function serveReactPreview(req, res) {
  if (!fs.existsSync(reactAppIndex)) {
    return res.status(404).type('text/plain').send('React migration preview has not been built');
  }
  return res.sendFile(reactAppIndex);
}

// The public root explains Provista before asking someone to create an account.
// Returning users with a valid session now enter the migrated React Home.
app.get('/', (req, res) => {
  try {
    jwt.verify(req.cookies?.token, process.env.JWT_SECRET);
    return serveReactApp(req, res);
  } catch (_) {
    return res.type('html').send(renderLandingPage(req));
  }
});

// `/app` without a feature deep link is the migrated React Home. During the
// strangler migration, explicit `?tab=` links continue to open the legacy
// feature renderer until that destination moves to React.
app.get('/app', appShellLimiter, (req, res) => {
  if (req.query.tab || req.query.legacy === '1') return serveLegacyApp(req, res);
  return serveReactApp(req, res);
});

// Migrated authenticated feature routes. The matching legacy `?tab=` deep
// links remain available until PRO-56 retires the compatibility renderer.
app.get('/app/list', appShellLimiter, serveReactApp);
app.get('/app/pantry', appShellLimiter, serveReactApp);
app.get('/app/plan', appShellLimiter, serveReactApp);
app.get('/app/more', appShellLimiter, serveReactApp);
app.get('/app/more/products', appShellLimiter, serveReactApp);
app.get('/app/more/help', appShellLimiter, serveReactApp);
app.get('/app/more/account', appShellLimiter, serveReactApp);
app.get('/app/more/household', appShellLimiter, serveReactApp);
app.get('/app/more/stores', appShellLimiter, serveReactApp);
app.get('/app/more/insights', appShellLimiter, serveReactApp);
app.get('/app/more/insights/prices', appShellLimiter, serveReactApp);
app.get('/app/more/insights/spending', appShellLimiter, serveReactApp);

// Compatibility surface remains available while Import, scanner, and legacy
// authenticated JavaScript are retired under PRO-56.
app.get('/legacy-app', serveLegacyApp);

// Vite's output lives under public/react-preview, but static directory indexes are
// intentionally disabled for the rest of Provista. Serve only extensionless
// React shell routes through the generated index while normal assets continue
// through express.static above.
app.get('/react-preview', serveReactPreview);
app.get('/react-preview/', serveReactPreview);
app.get('/react-preview/*', (req, res, next) => {
  if (path.extname(req.path)) return next();
  return serveReactPreview(req, res);
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(legacyAppIndex);
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
