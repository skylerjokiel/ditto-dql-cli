#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create necessary directories
const dirs = ['ditto', 'exports', 'logs'];

dirs.forEach(dir => {
  const dirPath = join(process.cwd(), dir);
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
    console.log(`Created ${dir}/ directory`);
  }
});

console.log('Ditto DQL Terminal setup complete!');
console.log('Run "ditto-dql-terminal" to start the application.');