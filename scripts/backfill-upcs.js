#!/usr/bin/env node
/**
 * One-time script: attempts to find UPCs for seeded items by querying the
 * Open Food Facts search API by product name.
 *
 * Usage:
 *   node scripts/backfill-upcs.js [--dry-run] [--auto-accept]
 *
 *   --dry-run      Print matches, write nothing to DB.
 *   --auto-accept  Write UPCs for confident matches without prompting.
 *   (default)      Print each match and prompt Y/N before writing.
 */

require('dotenv').config();
const https = require('https');
const readline = require('readline');
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/grocerytracker';
const Item = require('../models/Item');
const { normalizeUpc } = require('../utils/upc');

const DRY_RUN = process.argv.includes('--dry-run');
const AUTO_ACCEPT = process.argv.includes('--auto-accept');
const DELAY_MS = 300; // polite delay between OFF API calls

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const items = await Item.find({
    isSeeded: true,
    upc: null
  }).select('_id name category').lean();

  console.log(`Found ${items.length} seeded items without UPCs\n`);

  let matched = 0;
  let skipped = 0;
  let pending = 0;

  const rl = AUTO_ACCEPT || DRY_RUN ? null : readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      process.stdout.write(`[${i + 1}/${items.length}] ${item.name}... `);

      let offResults = null;
      try {
        offResults = await searchOffByName(item.name);
      } catch (err) {
        process.stdout.write(`(OFF error: ${err.message})\n`);
      }

      const match = offResults ? findBestMatch(item.name, offResults) : null;

      if (!match) {
        process.stdout.write('no confident match\n');
        if (!DRY_RUN) {
          await Item.updateOne({ _id: item._id }, { $set: { upcPendingLookup: true } });
        }
        pending++;
        await sleep(DELAY_MS);
        continue;
      }

      const upc = normalizeUpc(match.code);
      if (!upc) {
        process.stdout.write('could not normalize UPC\n');
        pending++;
        await sleep(DELAY_MS);
        continue;
      }
      process.stdout.write(`→ ${upc} (${match.product_name || 'unknown'})\n`);

      if (DRY_RUN) {
        skipped++;
        await sleep(DELAY_MS);
        continue;
      }

      if (AUTO_ACCEPT) {
        await Item.updateOne({ _id: item._id }, { $set: { upc, upcSource: 'backfill', upcPendingLookup: false } });
        matched++;
      } else {
        const accept = await prompt(rl, `  Accept this UPC? [Y/n] `);
        if (accept.toLowerCase() !== 'n') {
          await Item.updateOne({ _id: item._id }, { $set: { upc, upcSource: 'backfill', upcPendingLookup: false } });
          matched++;
        } else {
          await Item.updateOne({ _id: item._id }, { $set: { upcPendingLookup: true } });
          skipped++;
        }
      }

      await sleep(DELAY_MS);
    }
  } finally {
    if (rl) rl.close();
    await mongoose.disconnect();
  }

  console.log('\n========= Summary =========');
  console.log(`Matched:  ${matched}`);
  console.log(`Skipped:  ${skipped}`);
  console.log(`Pending:  ${pending}`);
  console.log('===========================');
}

function searchOffByName(name) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(name);
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encoded}&search_simple=1&action=process&json=1&page_size=5`;
    const req = https.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.products || []);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', reject);
  });
}

function findBestMatch(itemName, products) {
  const nameWords = tokenize(itemName);
  let best = null;
  let bestScore = 0;

  for (const p of products) {
    if (!p.code || !/^\d{8,14}$/.test(p.code)) continue;
    const prodName = p.product_name_en || p.product_name || '';
    if (!prodName) continue;
    const prodWords = tokenize(prodName);
    const score = jaccardSimilarity(nameWords, prodWords);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return bestScore >= 0.5 ? best : null;
}

function tokenize(str) {
  return new Set(str.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = [...setA].filter(w => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

main().catch(err => {
  console.error('Fatal error:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});
