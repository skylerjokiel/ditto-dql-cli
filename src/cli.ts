#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const args = process.argv.slice(2);
  
  // Handle special commands
  if (args.length > 0) {
    if (args[0] === '--list-versions' || args[0] === '-l') {
      const dqlHome = path.join(os.homedir(), '.dql', 'versions');
      if (fs.existsSync(dqlHome)) {
        const versions = fs.readdirSync(dqlHome).filter(d => d.startsWith('v'));
        if (versions.length > 0) {
          console.log('Found old version cache from previous implementation:');
          versions.forEach(v => console.log(`  ${v.substring(1)}`));
          console.log('\nVersion management is currently not supported with ES modules.');
          console.log('You can clean these up with: dql --clean-versions');
        } else {
          console.log('No cached versions found.');
        }
      } else {
        console.log('No cached versions found.');
      }
      console.log('\nTo use different Ditto versions, install them in your project directly.');
      return;
    }
    
    if (args[0] === '--clean-versions') {
      const dqlHome = path.join(os.homedir(), '.dql');
      if (fs.existsSync(dqlHome)) {
        console.log('Cleaning up old version cache...');
        fs.rmSync(dqlHome, { recursive: true, force: true });
        console.log('Version cache cleaned up.');
      } else {
        console.log('No version cache to clean up.');
      }
      return;
    }
    
    if (args[0] === '--help' || args[0] === '-h') {
      console.log('DQL Terminal - Ditto Query Language CLI');
      console.log('\nUsage:');
      console.log('  dql                    Run with the installed Ditto version');
      console.log('  dql --help             Show this help message');
      console.log('\nTo use different Ditto versions:');
      console.log('  npm install @dittolive/ditto@4.10.0  # Install specific version');
      console.log('  dql                                   # Run with that version');
      return;
    }
    
    // For now, if a version is specified, show a message
    if (args[0].match(/^\d+\.\d+\.\d+/)) {
      console.log(`Dynamic version switching is not yet supported with ES modules.`);
      console.log(`To use Ditto version ${args[0]}, run:`);
      console.log(`  npm install @dittolive/ditto@${args[0]}`);
      console.log(`  dql`);
      return;
    }
  }
  
  // No version specified, run with default
  await import('./index.js');
}

main().catch(console.error);