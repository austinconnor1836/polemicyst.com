#!/usr/bin/env node
/**
 * Reads tokens/colors.json and generates platform-specific theme files:
 *   - Web:     src/app/ui/tokens.css      (CSS custom properties, RGB channels)
 *   - Android: android/.../ui/theme/Tokens.kt  (Compose Color constants)
 *   - iOS:     ios/Polemicyst/Theme/Tokens.swift (SwiftUI Color extensions)
 *
 * Run:  npm run tokens   (or:  node scripts/generate-tokens.mjs)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const tokens = JSON.parse(readFileSync(resolve(root, 'tokens/colors.json'), 'utf8'));
const { colors } = tokens;

// ── helpers ──────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function camelToKebab(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function ensureDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

// ── CSS ──────────────────────────────────────────────────────────────

function generateCSS() {
  const lines = ['/* AUTO-GENERATED \u2014 do not edit. Run `npm run tokens` to regenerate. */\n'];

  lines.push(':root {');
  for (const [name, { light }] of Object.entries(colors)) {
    const { r, g, b } = hexToRgb(light);
    lines.push(`  --color-${camelToKebab(name)}: ${r} ${g} ${b};`);
  }
  lines.push('}\n');

  lines.push('.dark,');
  lines.push("[data-mode='dark'] {");
  for (const [name, { dark }] of Object.entries(colors)) {
    const { r, g, b } = hexToRgb(dark);
    lines.push(`  --color-${camelToKebab(name)}: ${r} ${g} ${b};`);
  }
  lines.push('}');

  const out = resolve(root, 'src/app/ui/tokens.css');
  ensureDir(out);
  writeFileSync(out, lines.join('\n') + '\n');
  console.log(`  CSS     -> ${out}`);
}

// ── Kotlin ───────────────────────────────────────────────────────────

function generateKotlin() {
  const lines = [
    '// AUTO-GENERATED \u2014 do not edit. Run `npm run tokens` to regenerate.',
    'package com.polemicyst.android.ui.theme\n',
    'import androidx.compose.ui.graphics.Color\n',
    '// Light tokens',
  ];

  for (const [name, { light }] of Object.entries(colors)) {
    const hex = light.replace('#', '').toUpperCase();
    lines.push(`val Token${capitalize(name)}Light = Color(0xFF${hex})`);
  }

  lines.push('\n// Dark tokens');
  for (const [name, { dark }] of Object.entries(colors)) {
    const hex = dark.replace('#', '').toUpperCase();
    lines.push(`val Token${capitalize(name)}Dark = Color(0xFF${hex})`);
  }

  const out = resolve(
    root,
    'android/app/src/main/java/com/polemicyst/android/ui/theme/Tokens.kt'
  );
  ensureDir(out);
  writeFileSync(out, lines.join('\n') + '\n');
  console.log(`  Kotlin  -> ${out}`);
}

// ── Swift ────────────────────────────────────────────────────────────

function generateSwift() {
  const lines = [
    '// AUTO-GENERATED \u2014 do not edit. Run `npm run tokens` to regenerate.',
    'import SwiftUI\n',
    'extension Color {',
    '    // Light tokens',
  ];

  for (const [name, { light }] of Object.entries(colors)) {
    const { r, g, b } = hexToRgb(light);
    const prop = 'token' + capitalize(name) + 'Light';
    lines.push(
      `    static let ${prop} = Color(red: ${r}.0 / 255.0, green: ${g}.0 / 255.0, blue: ${b}.0 / 255.0)`
    );
  }

  lines.push('\n    // Dark tokens');
  for (const [name, { dark }] of Object.entries(colors)) {
    const { r, g, b } = hexToRgb(dark);
    const prop = 'token' + capitalize(name) + 'Dark';
    lines.push(
      `    static let ${prop} = Color(red: ${r}.0 / 255.0, green: ${g}.0 / 255.0, blue: ${b}.0 / 255.0)`
    );
  }

  lines.push('}');

  const out = resolve(root, 'ios/Polemicyst/Theme/Tokens.swift');
  ensureDir(out);
  writeFileSync(out, lines.join('\n') + '\n');
  console.log(`  Swift   -> ${out}`);
}

// ── run ──────────────────────────────────────────────────────────────

console.log('Generating design tokens...\n');
generateCSS();
generateKotlin();
generateSwift();
console.log('\nDone.');
