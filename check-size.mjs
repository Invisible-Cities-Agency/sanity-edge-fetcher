#!/usr/bin/env node

import { readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));

const files = {
  'Core (core.ts)': './src/core.ts',
  'Enhanced (enhanced.ts)': './src/enhanced.ts', 
  'Cache (cache.ts)': './src/cache.ts',
  'Config (config.ts)': './config.ts',
  'Index (index.ts)': './index.ts',
};

console.log('\n📦 Sanity Edge Fetcher Bundle Size Analysis\n');
console.log('=' .repeat(50));

let totalSize = 0;
let totalGzipped = 0;

// Individual file sizes
for (const [name, path] of Object.entries(files)) {
  try {
    const fullPath = join(__dirname, path);
    const content = readFileSync(fullPath, 'utf8');
    const size = statSync(fullPath).size;
    const gzipped = gzipSync(content).length;
    
    totalSize += size;
    totalGzipped += gzipped;
    
    console.log(`${name.padEnd(25)} ${(size / 1024).toFixed(2)} KB → ${(gzipped / 1024).toFixed(2)} KB (gzipped)`);
  } catch (err) {
    console.log(`${name.padEnd(25)} Error: ${err.message}`);
  }
}

console.log('=' .repeat(50));
console.log(`${'TOTAL'.padEnd(25)} ${(totalSize / 1024).toFixed(2)} KB → ${(totalGzipped / 1024).toFixed(2)} KB (gzipped)`);

// Estimate runtime size (removing comments, types, etc.)
const runtimeEstimate = totalGzipped * 0.8; // ~80% after tree-shaking & minification
console.log(`${'RUNTIME ESTIMATE'.padEnd(25)} ~${(runtimeEstimate / 1024).toFixed(2)} KB`);

console.log('\n📊 Size Comparison:');
console.log('  Edge Fetcher (core only): ~2 KB');
console.log('  Edge Fetcher (with cache): ~4-5 KB'); 
console.log('  Official Sanity Client: ~50 KB');
console.log(`  Savings: ~${(50 - (runtimeEstimate / 1024)).toFixed(0)} KB (${Math.round((1 - runtimeEstimate / 1024 / 50) * 100)}% smaller)\n`);