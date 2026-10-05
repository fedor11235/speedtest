#!/usr/bin/env node
'use strict';

/**
 * Internet download-speed meter.
 *
 * Fires a number of sequential GET requests at a given URL (a heavy file,
 * e.g. a large image), waits for each full response, then reports:
 *   - average request time
 *   - total volume of downloaded data
 *   - download speed (both MB/s and Mbit/s)
 *
 * No external dependencies — uses only Node.js built-ins.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// Default target — a 10 MB static test file (no server-side processing,
// no rate-limiting), so the number reflects the network and not the host.
// Pass your own URL as the first argument to test any "heavy picture", e.g.
//   https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg
const DEFAULT_URL = 'https://proof.ovh.net/files/10Mb.dat';
const DEFAULT_REQUESTS = 10;

/**
 * Perform a single GET request, draining the whole body.
 * Resolves with { ms, bytes } — elapsed time in ms and bytes downloaded.
 */
function downloadOnce(targetUrl) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (err) {
      reject(new Error(`Invalid URL: ${targetUrl}`));
      return;
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const start = process.hrtime.bigint();
    let bytes = 0;

    const req = client.get(
      targetUrl,
      { headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'speedtest.js' } },
      (res) => {
        // Follow one level of redirects (common for CDN-hosted files).
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume(); // drain
          const next = new URL(res.headers.location, targetUrl).href;
          downloadOnce(next).then(resolve, reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Unexpected status code: ${res.statusCode}`));
          return;
        }

        res.on('data', (chunk) => {
          bytes += chunk.length;
        });
        res.on('end', () => {
          const end = process.hrtime.bigint();
          const ms = Number(end - start) / 1e6;
          resolve({ ms, bytes });
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy(new Error('Request timed out after 60s'));
    });
  });
}

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

async function main() {
  const url = process.argv[2] || DEFAULT_URL;
  const count = Number(process.argv[3]) || DEFAULT_REQUESTS;

  if (process.argv[2] === '--help' || process.argv[2] === '-h') {
    console.log('Usage: node speedtest.js [url] [requests]');
    console.log(`  url       target file to download (default: ${DEFAULT_URL})`);
    console.log(`  requests  number of sequential requests (default: ${DEFAULT_REQUESTS})`);
    return;
  }

  console.log(`Target:   ${url}`);
  console.log(`Requests: ${count} (sequential)\n`);

  const results = [];

  for (let i = 0; i < count; i++) {
    process.stdout.write(`  Request ${i + 1}/${count} ... `);
    try {
      const r = await downloadOnce(url);
      results.push(r);
      const perReqMbps = (r.bytes * 8) / (r.ms / 1000) / 1e6;
      console.log(
        `${r.ms.toFixed(0)} ms, ${formatBytes(r.bytes)}, ${perReqMbps.toFixed(2)} Mbit/s`
      );
    } catch (err) {
      console.log(`FAILED (${err.message})`);
    }
  }

  if (results.length === 0) {
    console.error('\nAll requests failed — could not measure speed.');
    process.exitCode = 1;
    return;
  }

  const totalMs = results.reduce((s, r) => s + r.ms, 0);
  const totalBytes = results.reduce((s, r) => s + r.bytes, 0);
  const avgMs = totalMs / results.length;

  // Speed = total data downloaded / total time spent downloading.
  const seconds = totalMs / 1000;
  const mbPerSec = totalBytes / (1024 * 1024) / seconds; // megabytes per second
  const mbitPerSec = (totalBytes * 8) / seconds / 1e6; // megabits per second

  console.log('\n--- Results ---');
  console.log(`Successful requests: ${results.length}/${count}`);
  console.log(`Average request time: ${avgMs.toFixed(0)} ms`);
  console.log(`Total data downloaded: ${formatBytes(totalBytes)}`);
  console.log(`Speed: ${mbPerSec.toFixed(2)} MB/s  (${mbitPerSec.toFixed(2)} Mbit/s)`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exitCode = 1;
});
