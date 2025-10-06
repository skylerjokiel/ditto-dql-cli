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
    if (args[0] === '--help' || args[0] === '-h') {
      console.log('DQL Terminal - Ditto Query Language CLI');
      console.log('\nUsage:');
      console.log('  dql                    Run with the installed Ditto version');
      console.log('  dql <version>          Run with a specific Ditto version (e.g., dql 4.10.0)');
      console.log('  dql --help             Show this help message');
      console.log('\nExamples:');
      console.log('  dql                    # Run with default version');
      console.log('  dql 4.10.0             # Run with Ditto 4.10.0');
      console.log('  dql 4.12.2             # Run with Ditto 4.12.2');
      return;
    }
    
    // Check if version argument is provided
    if (args[0].match(/^\d+\.\d+\.\d+/)) {
      const requestedVersion = args[0];
      console.log(`Setting up Ditto version ${requestedVersion}...`);
      
      // Create a temporary directory for this session
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dql-'));
      
      // Copy all necessary files to temp directory
      const filesToCopy = [
        'dist/index.js',
        'dist/index.js.map',
        'scenarios.json',
        'benchmarks.json',
        'movies.ndjson',
        'benchmark_baselines.ndjson'
      ];
      
      // Create dist directory in temp
      fs.mkdirSync(path.join(tmpDir, 'dist'), { recursive: true });
      
      for (const file of filesToCopy) {
        const src = path.join(__dirname, '..', file);
        const dest = path.join(tmpDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }
      
      // Create a package.json with the specific Ditto version
      const packageJson = {
        "name": "dql-temp",
        "version": "1.0.0",
        "type": "module",
        "dependencies": {
          "@dittolive/ditto": requestedVersion,
          "readline": "^1.3.0"
        }
      };
      
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );
      
      console.log(`Installing @dittolive/ditto@${requestedVersion}...`);
      
      // Install dependencies
      const install = spawn('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: tmpDir,
        stdio: 'inherit',
        shell: true
      });
      
      install.on('close', (installCode) => {
        if (installCode !== 0) {
          console.error(`Failed to install Ditto version ${requestedVersion}`);
          fs.rmSync(tmpDir, { recursive: true, force: true });
          process.exit(1);
        }
        
        console.log(`Running with Ditto version ${requestedVersion}...\n`);
        
        // Run the app
        const dql = spawn('node', ['dist/index.js'], {
          cwd: tmpDir,
          stdio: 'inherit',
          env: {
            ...process.env,
            // Point to the temp directory where files are copied
            INIT_CWD: tmpDir
          }
        });
        
        dql.on('close', (code) => {
          // Cleanup
          fs.rmSync(tmpDir, { recursive: true, force: true });
          process.exit(code || 0);
        });
      });
      
      return;
    }
  }
  
  // No version specified, run with default
  await import('./index.js');
}

main().catch(console.error);