#!/usr/bin/env node
/**
 * Bumps the version in version.json.
 *
 * Usage:
 *   node scripts/bump-version.mjs patch      # 0.3.0 → 0.3.1
 *   node scripts/bump-version.mjs minor      # 0.3.0 → 0.4.0
 *   node scripts/bump-version.mjs major      # 0.3.0 → 1.0.0
 *   node scripts/bump-version.mjs 1.2.3      # explicit version
 *
 * Prints the new version to stdout for consumption by CI scripts.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const versionFile = resolve(__dirname, '..', 'version.json');

const bump = process.argv[2];
if (!bump) {
  console.error('Usage: bump-version.mjs <patch|minor|major|x.y.z>');
  process.exit(1);
}

const data = JSON.parse(readFileSync(versionFile, 'utf-8'));
const [major, minor, patch] = data.version.split('.').map(Number);

let newVersion;
switch (bump) {
  case 'patch':
    newVersion = `${major}.${minor}.${patch + 1}`;
    break;
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`;
    break;
  case 'major':
    newVersion = `${major + 1}.0.0`;
    break;
  default:
    if (!/^\d+\.\d+\.\d+$/.test(bump)) {
      console.error(`Invalid version "${bump}". Use patch, minor, major, or x.y.z`);
      process.exit(1);
    }
    newVersion = bump;
}

data.version = newVersion;
writeFileSync(versionFile, JSON.stringify(data, null, 2) + '\n');

// stdout only — CI captures this
console.log(newVersion);
