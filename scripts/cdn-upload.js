// =============================================================================
// K-PHI SDK — CDN Upload Script
// =============================================================================
// Uploads built dist/ files to your CDN / object storage.
// Supports S3-compatible storage (AWS S3, Cloudflare R2, MinIO).
//
// Usage:
//   CDN_BUCKET=kphi-cdn CDN_REGION=eu-central-1 node scripts/cdn-upload.js
//
// Env vars:
//   CDN_BUCKET      — S3 bucket name (required)
//   CDN_REGION      — AWS region (default: eu-central-1)
//   CDN_ENDPOINT    — Custom endpoint for R2/MinIO (optional)
//   CDN_PREFIX      — Path prefix in bucket (default: sdk)
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY — credentials
// =============================================================================

'use strict';

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const crypto  = require('crypto');

const pkg = require('../package.json');

const BUCKET   = process.env.CDN_BUCKET;
const REGION   = process.env.CDN_REGION   || 'eu-central-1';
const ENDPOINT = process.env.CDN_ENDPOINT;
const PREFIX   = process.env.CDN_PREFIX    || 'sdk';
const VERSION  = pkg.version;

if (!BUCKET) {
  console.error('CDN_BUCKET env var required');
  process.exit(1);
}

const DIST_DIR = path.join(__dirname, '../dist');

// Files to upload with their content types
const FILES = [
  { file: 'kphi-sdk.umd.js',    contentType: 'application/javascript' },
  { file: 'kphi-sdk.esm.js',    contentType: 'application/javascript' },
  { file: 'ui-helpers.umd.js',  contentType: 'application/javascript' },
  { file: 'kphi-sdk.umd.js.map',contentType: 'application/json' },
  { file: 'kphi-sdk.esm.js.map',contentType: 'application/json' },
  { file: 'ui-helpers.umd.js.map', contentType: 'application/json' },
];

async function upload() {
  console.log(`Uploading @kphi/sdk v${VERSION} to CDN...\n`);

  // Check dist files exist
  const missing = FILES.filter(f => !fs.existsSync(path.join(DIST_DIR, f.file)));
  if (missing.length > 0) {
    console.error(`Missing dist files: ${missing.map(f => f.file).join(', ')}`);
    console.error('Run `npm run build` first.');
    process.exit(1);
  }

  for (const { file, contentType } of FILES) {
    const localPath = path.join(DIST_DIR, file);
    if (!fs.existsSync(localPath)) continue;

    const body = fs.readFileSync(localPath);

    // Upload to two paths:
    //   sdk/v1.0.0/kphi-sdk.umd.js  — pinned version
    //   sdk/latest/kphi-sdk.umd.js  — always latest
    for (const versionSlug of [`v${VERSION}`, 'latest']) {
      const key = `${PREFIX}/${versionSlug}/${file}`;
      await uploadToS3(key, body, contentType);
      console.log(`  ✓ ${key}`);
    }
  }

  console.log(`
CDN URLs:
  Pinned:  https://cdn.k-phi.com/${PREFIX}/v${VERSION}/kphi-sdk.umd.js
  Latest:  https://cdn.k-phi.com/${PREFIX}/latest/kphi-sdk.umd.js
  UI only: https://cdn.k-phi.com/${PREFIX}/latest/ui-helpers.umd.js

Usage in browser:
  <script src="https://cdn.k-phi.com/${PREFIX}/v${VERSION}/ui-helpers.umd.js"></script>
`);
}

// Minimal S3 PUT using AWS Signature v4 (no SDK dependency)
async function uploadToS3(key, body, contentType) {
  const host      = ENDPOINT || `${BUCKET}.s3.${REGION}.amazonaws.com`;
  const datetime  = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date      = datetime.slice(0, 8);
  const hash      = crypto.createHash('sha256').update(body).digest('hex');

  const headers = {
    'Content-Type':        contentType,
    'Content-Length':      body.length.toString(),
    'Host':                host,
    'x-amz-date':          datetime,
    'x-amz-content-sha256':hash,
    'Cache-Control':       'public, max-age=31536000, immutable',
  };

  if (!process.env.AWS_ACCESS_KEY_ID) {
    // Dry run without credentials
    console.log(`  [dry-run] Would upload: s3://${BUCKET}/${key}`);
    return;
  }

  const signedHeaders  = Object.keys(headers).sort().join(';');
  const canonicalReq   = [
    'PUT', `/${key}`, '',
    Object.keys(headers).sort().map(k => `${k.toLowerCase()}:${headers[k]}`).join('\n'), '',
    signedHeaders, hash,
  ].join('\n');

  const scope      = `${date}/${REGION}/s3/aws4_request`;
  const strToSign  = `AWS4-HMAC-SHA256\n${datetime}\n${scope}\n${crypto.createHash('sha256').update(canonicalReq).digest('hex')}`;
  const signingKey = ['aws4', date, REGION, 's3', 'aws4_request']
    .reduce((key, data) => crypto.createHmac('sha256', key).update(data).digest(), process.env.AWS_SECRET_ACCESS_KEY);
  const signature  = crypto.createHmac('sha256', signingKey).update(strToSign).digest('hex');

  headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${process.env.AWS_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  await new Promise((resolve, reject) => {
    const req = https.request({ hostname: host, path: `/${key}`, method: 'PUT', headers }, res => {
      if (res.statusCode >= 400) {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => reject(new Error(`S3 error ${res.statusCode}: ${data}`)));
      } else {
        resolve();
      }
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

upload().catch(err => {
  console.error('CDN upload failed:', err);
  process.exit(1);
});
