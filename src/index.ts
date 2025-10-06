#!/usr/bin/env node
import { init, Ditto, Logger as DittoLogger, LogLevel, CustomLogCallback } from '@dittolive/ditto';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// When running with specific version, files might be in original directory
const baseDir = process.env.INIT_CWD || join(__dirname, '..');
const scenarios = JSON.parse(readFileSync(join(baseDir, 'scenarios.json'), 'utf-8'));
const benchmarks = JSON.parse(readFileSync(join(baseDir, 'benchmarks.json'), 'utf-8'));

// Setup auto-logging with circular buffer
DittoLogger.enabled = true;
DittoLogger.minimumLogLevel = 'Info';
const levelNames: Record<LogLevel, string> = {
  'Error': 'ERROR',
  'Warning': 'WARN', 
  'Info': 'INFO',
  'Debug': 'DEBUG',
  'Verbose': 'VERBOSE'
};

const customLogger: CustomLogCallback = (logLevel: LogLevel, message: string) => {
  const level = levelNames[logLevel] || 'UNKNOWN';
  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    logLevel
  };
  
  // Add to circular buffer
  logBuffer.add(logEntry);
  
  // Export logs on warnings and errors
  if (logLevel === 'Error' || logLevel === 'Warning') {
    exportLogsOnError().catch(error => {
      console.error('Failed to export logs on error:', error);
    });
  }
};
await DittoLogger.setCustomLogCallback(customLogger);

// Circular buffer for log storage
class CircularBuffer<T> {
  private buffer: T[] = [];
  private maxSize: number;
  private currentIndex: number = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  add(item: T): void {
    if (this.buffer.length < this.maxSize) {
      this.buffer.push(item);
    } else {
      this.buffer[this.currentIndex] = item;
      this.currentIndex = (this.currentIndex + 1) % this.maxSize;
    }
  }

  getAll(): T[] {
    if (this.buffer.length < this.maxSize) {
      return [...this.buffer];
    }
    return [
      ...this.buffer.slice(this.currentIndex),
      ...this.buffer.slice(0, this.currentIndex)
    ];
  }

  clear(): void {
    this.buffer = [];
    this.currentIndex = 0;
  }
}

type LogEntry = {
  timestamp: string;
  level: string;
  message: string;
  logLevel: LogLevel;
};

const logBuffer = new CircularBuffer<LogEntry>(100);

async function exportLogsOnError(): Promise<void> {
  try {
    const logsDir = path.join(process.cwd(), 'logs');
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const logs = logBuffer.getAll();
    if (logs.length === 0) {
      return;
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `error-logs-${timestamp}.ndjson`;
    const filepath = path.join(logsDir, filename);
    
    const logData = logs.map(log => JSON.stringify(log)).join('\n');
    fs.writeFileSync(filepath, logData);
    
    console.log(`\n${applyColor('📋 Logs exported:', 'yellow_highlight')} ${filename}`);
    console.log(`   Location: ${filepath}`);
    console.log(`   Entries: ${logs.length}`);
  } catch (error) {
    console.error('Failed to export logs:', error);
  }
}

async function manualLogDump(): Promise<void> {
  try {
    const logsDir = path.join(process.cwd(), 'logs');
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const logs = logBuffer.getAll();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `manual-logs-${timestamp}.ndjson`;
    const filepath = path.join(logsDir, filename);
    
    const logData = logs.length > 0 ? logs.map(log => JSON.stringify(log)).join('\n') : '';
    fs.writeFileSync(filepath, logData);
    
    console.log(`\n${applyColor('📋 Log buffer dumped:', 'green')} ${filename}`);
    console.log(`   Location: ${filepath}`);
    console.log(`   Entries: ${logs.length}`);
    if (logs.length === 0) {
      console.log(`   ${applyColor('Note:', 'blue')} Buffer was empty`);
    }
  } catch (error) {
    console.error('Failed to dump logs:', error);
  }
}

type ScenarioQuery = string | {
  query: string;
  expectedCount?: number;
  expectedIndex?: string | 'full_scan';
  maxExecutionTime?: number; // in milliseconds
}

type Benchmark = {
  query: string;
  preQueries?: string[];
  postQueries?: string[];
}

type BenchmarkBaseline = {
  _id: {
    query: string;
    hash: string;
    ditto_version: string;
  };
  metrics: {
    mean: number;
    median: number;
    min: number;
    max: number;
    stdDev: number;
    p95: number;
    p99: number;
    resultCount: number;
    runs: number;
    timestamp: string;
  };
}

function generateBenchmarkHash(preQueries: string[] = [], query: string): string {
  const combined = [...preQueries, query].join('|');
  return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 16);
}

async function getDittoVersion(): Promise<string> {
  try {
    const dittoPackagePath = path.join(process.cwd(), 'node_modules', '@dittolive', 'ditto', 'package.json');
    if (fs.existsSync(dittoPackagePath)) {
      const packageJson = JSON.parse(fs.readFileSync(dittoPackagePath, 'utf8'));
      return packageJson.version;
    }
  } catch (error) {
    console.error('Could not read Ditto version:', error);
  }
  return 'unknown';
}

function parseVersion(version: string): { major: number; minor: number; patch: number; raw: string } {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return { major: 0, minor: 0, patch: 0, raw: version };
  }
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]), 
    patch: parseInt(match[3]),
    raw: version
  };
}

function compareVersions(a: string, b: string): number {
  const vA = parseVersion(a);
  const vB = parseVersion(b);
  
  if (vA.major !== vB.major) return vB.major - vA.major;
  if (vA.minor !== vB.minor) return vB.minor - vA.minor;
  return vB.patch - vA.patch;
}

function isVersionAtLeast(version: string, minMajor: number, minMinor: number, minPatch: number = 0): boolean {
  const v = parseVersion(version);
  if (v.major > minMajor) return true;
  if (v.major < minMajor) return false;
  if (v.minor > minMinor) return true;
  if (v.minor < minMinor) return false;
  return v.patch >= minPatch;
}

async function getBaseline(ditto: Ditto, hash: string, dittoVersion: string): Promise<BenchmarkBaseline | null> {
  try {
    const result = await ditto.store.execute(
      "SELECT * FROM COLLECTION benchmark_baselines (metrics MAP) WHERE _id.hash = :hash AND _id.ditto_version = :version",
      { hash, version: dittoVersion }
    );
    
    if (result.items.length > 0) {
      return result.items[0].value as BenchmarkBaseline;
    }
  } catch (error) {
    // Collection might not exist yet, that's ok
  }
  return null;
}

async function getComparisonBaselines(ditto: Ditto, hash: string, currentVersion: string): Promise<BenchmarkBaseline[]> {
  try {
    const result = await ditto.store.execute(
      "SELECT * FROM COLLECTION benchmark_baselines (metrics MAP) WHERE _id.hash = :hash",
      { hash }
    );
    
    if (result.items.length === 0) return [];
    
    const allBaselines = result.items.map(item => item.value as BenchmarkBaseline);
    
    // Return ALL baselines except current version, sorted alphabetically
    return allBaselines
      .filter(baseline => baseline._id.ditto_version !== currentVersion)
      .sort((a, b) => a._id.ditto_version.localeCompare(b._id.ditto_version));
  } catch (error) {
    return [];
  }
}

async function saveBaseline(ditto: Ditto, baseline: BenchmarkBaseline): Promise<void> {
  try {
    await ditto.store.execute(
      "INSERT INTO COLLECTION benchmark_baselines (metrics MAP) DOCUMENTS (:baseline) ON ID CONFLICT DO UPDATE",
      { baseline }
    );
  } catch (error) {
    console.error('Failed to save baseline:', error);
  }
}

async function importMovies(ditto: Ditto) {
  const docName = 'movies.ndjson';
  const baseDir = process.env.INIT_CWD || process.cwd();
  const filePath = path.join(baseDir, docName);
  
  if (!fs.existsSync(filePath)) {
    console.error(`Error: ${docName} not found.`);
    return;
  }

  console.log('Starting movie import...');
  
  try {   
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const lines = fileContent.trim().split('\n');
    
    let successCount = 0;
    let errorCount = 0;
    
    // Process in batches
    const batchSize = 100;
    for (let i = 0; i < lines.length; i += batchSize) {
      const batch = lines.slice(i, i + batchSize);
      const documents = [];
      
      for (const line of batch) {
        try {
          const doc = JSON.parse(line);
          documents.push(doc);
        } catch (e) {
          errorCount++;
          console.error(`Failed to parse line: ${e}`);
        }
      }
      
      if (documents.length > 0) {
        try {
          // Insert batch
          for (const doc of documents) {
            await ditto.store.execute(
              `INSERT INTO movies DOCUMENTS (:doc)
              ON ID CONFLICT DO UPDATE`
            , { doc });
            successCount++;
          }
          
          if (successCount % 1000 === 0) {
            console.log(`Imported ${successCount} movies...`);
          }
        } catch (e) {
          errorCount += documents.length;
          console.error(`Batch insert failed: ${e}`);
        }
      }
    }
    
    console.log(`\nImport complete!`);
    console.log(`Successfully imported: ${successCount} movies`);
    console.log(`Errors: ${errorCount}`);
    
    // Show count
    const countResult = await ditto.store.execute(`SELECT COUNT(*) FROM movies`);
    console.log(`Total movies in collection: ${(countResult.items[0] as any).count}`);
    
  } catch (error) {
    console.error('Import failed:', error);
  }
}

async function importBaselines(ditto: Ditto) {
  const docName = 'benchmark_baselines.ndjson';
  const baseDir = process.env.INIT_CWD || process.cwd();
  const filePath = path.join(baseDir, docName);
  
  if (!fs.existsSync(filePath)) {
    console.log(`${docName} not found, skipping baseline import.`);
    return;
  }

  console.log('Starting benchmark baseline import...');
  
  try {   
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const lines = fileContent.trim().split('\n');
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const line of lines) {
      try {
        const baseline = JSON.parse(line);
        await ditto.store.execute(
          "INSERT INTO COLLECTION benchmark_baselines (metrics MAP) DOCUMENTS (:baseline) ON ID CONFLICT DO UPDATE",
          { baseline }
        );
        successCount++;
        
        if (successCount % 50 === 0) {
          console.log(`Imported ${successCount} baselines...`);
        }
      } catch (e) {
        errorCount++;
        console.error(`Failed to import baseline: ${e}`);
      }
    }
    
    console.log(`\nBaseline import complete!`);
    console.log(`Successfully imported: ${successCount} baselines`);
    console.log(`Errors: ${errorCount}`);
    
    // Show count
    try {
      const countResult = await ditto.store.execute("SELECT COUNT(*) FROM COLLECTION benchmark_baselines (metrics MAP)");
      console.log(`Total baselines in collection: ${(countResult.items[0] as any).count}`);
    } catch (error) {
      // Collection might not exist yet, that's ok
    }
    
  } catch (error) {
    console.error('Baseline import failed:', error);
  }
}

function extractIndexInfo(explainResult: any): string | null {
  try {
    const plan = explainResult?.plan;
    if (!plan) return null;
    
    // Check for full scan
    if (plan['#operator'] === 'scan' || 
        (plan['#operator'] === 'sequence' && plan.children?.some((child: any) => child['#operator'] === 'scan'))) {
      // Look for full_scan in descriptor
      const scanOp = plan['#operator'] === 'scan' ? plan : plan.children.find((child: any) => child['#operator'] === 'scan');
      if (scanOp?.descriptor?.path?._id === 'query_details' && scanOp?.descriptor?.path?.full_scan !== undefined) {
        return 'full_scan';
      }
    }
    
    // Check for index scan
    if (plan['#operator'] === 'index_scan' || 
        (plan['#operator'] === 'sequence' && plan.children?.some((child: any) => child['#operator'] === 'index_scan'))) {
      const indexOp = plan['#operator'] === 'index_scan' ? plan : plan.children.find((child: any) => child['#operator'] === 'index_scan');
      return indexOp?.desc?.index || null;
    }
    
    return null;
  } catch {
    return null;
  }
}

async function main() {
  await init();

  const executeDql = async (query:string, expectedCount?: number, expectedIndex?: string | 'full_scan', maxExecutionTime?: number, interactive: boolean = false, rl?: readline.Interface) => {
    const start = Date.now();
    const result = await ditto.store.execute(query);
    const elapsed = Date.now() - start;
    console.log(`execute-time: ${applyColor(elapsed.toString() + 'ms', 'yellow_highlight')}`);
    console.log(`Result Count: ${result.items.length}`);
    
    let countPassed = true;
    let indexPassed = true;
    let timePassed = true;
    
    // Validate expected count if provided
    if (expectedCount !== undefined) {
      if (result.items.length === expectedCount) {
        console.log(`Validation: ${applyColor('✓ PASSED', 'green')} - Expected ${expectedCount} documents`);
      } else {
        console.log(`Validation: ${applyColor('✗ FAILED', 'red')} - Expected ${expectedCount} documents, got ${result.items.length}`);
        countPassed = false;
      }
    }
    
    // Validate execution time if provided
    if (maxExecutionTime !== undefined) {
      if (elapsed <= maxExecutionTime) {
        console.log(`Time Validation: ${applyColor('✓ PASSED', 'green')} - Executed in ${elapsed}ms (limit: ${maxExecutionTime}ms)`);
      } else {
        console.log(`Time Validation: ${applyColor('✗ FAILED', 'red')} - Executed in ${elapsed}ms, exceeded limit of ${maxExecutionTime}ms`);
        timePassed = false;
      }
    }
    
    // If expectedIndex is provided and this isn't already an EXPLAIN query, run EXPLAIN version
    const qLower = query.toLowerCase();
    if (expectedIndex !== undefined && !qLower.startsWith('explain') && !qLower.startsWith('profile')) {
      const explainQuery = `EXPLAIN ${query}`;
      const explainResult = await ditto.store.execute(explainQuery);
      
      if (explainResult.items.length > 0 && explainResult.items[0].value) {
        const indexUsed = extractIndexInfo(explainResult.items[0].value);
        
        if (indexUsed === expectedIndex) {
          console.log(`Index Validation: ${applyColor('✓ PASSED', 'green')} - Using ${expectedIndex === 'full_scan' ? 'full scan' : `index '${expectedIndex}'`}`);
        } else {
          const actualDesc = indexUsed === 'full_scan' ? 'full scan' : indexUsed ? `index '${indexUsed}'` : 'unknown scan type';
          const expectedDesc = expectedIndex === 'full_scan' ? 'full scan' : `index '${expectedIndex}'`;
          console.log(`Index Validation: ${applyColor('✗ FAILED', 'red')} - Expected ${expectedDesc}, but using ${actualDesc}`);
          console.log('\nEXPLAIN output for debugging:');
          console.log(JSON.stringify(explainResult.items[0].value, null, 2));
          indexPassed = false;
        }
      }
    }
    
    // Handle regular EXPLAIN or PROFILE queries
    if (qLower.startsWith('explain') || qLower.startsWith('profile')) {
      console.log();
      console.log(JSON.stringify(result.items[0].value, null, 2));
    }
    
    // Interactive prompt for raw DQL commands
    if (interactive && result.items.length > 0 && !qLower.startsWith('explain') && !qLower.startsWith('profile') && rl) {
      const answer = await new Promise<string>((resolve) => {
        rl.question('Print results? (y/n, default: n): ', (answer) => {
          resolve(answer.toLowerCase().trim());
        });
      });
      
      if (answer === 'y' || answer === 'yes') {
        console.log('\nResults:');
        result.items.forEach((item, index) => {
          console.log(`${index + 1}. ${JSON.stringify(item.value, null, 2)}`);
        });
      }
    }
    
    console.log();
    return { result, countPassed, indexPassed, timePassed };
  }

  const ditto = new Ditto({
    type: 'offlinePlayground',
    appID: 'ditto-dql-terminal'
  });

  await ditto.disableSyncWithV3();
  ditto.updateTransportConfig((config) => {
    config.connect.websocketURLs.push('wss://i83inp.cloud.dittolive.app');
  });

  // Uses the new DQL Document Schema mode where type definitions are not required (4.11.0+)
  const dittoVersion = await getDittoVersion();
  if (isVersionAtLeast(dittoVersion, 4, 11, 0)) {
    await ditto.store.execute("ALTER SYSTEM SET DQL_STRICT_MODE = false");
  } else {
    console.warn("DQL_STRICT_MODE = true because running version is <4.11.0");
  }

  // Restrict collection to be local only (4.10.0+)
  if (isVersionAtLeast(dittoVersion, 4, 10, 0)) {
    const syncScopes = {
      movies: "LocalPeerOnly",
      benchmark_baselines: "LocalPeerOnly"
    };
    await ditto.store.execute(
      "ALTER SYSTEM SET USER_COLLECTION_SYNC_SCOPES = :syncScopes",
      { syncScopes }
    );
  } else {
    console.warn("USER_COLLECTION_SYNC_SCOPES not set because running version is <4.10.0");
  }

  const checkStoreResponse = await ditto.store.execute("SELECT * FROM movies LIMIT 1");
  if (checkStoreResponse.items.length === 0) {
    console.log("Initializing the database with movie records.");
    await importMovies(ditto);
  }

  // Check if baseline collection exists and is empty
  try {
    const checkBaselinesResponse = await ditto.store.execute("SELECT * FROM COLLECTION benchmark_baselines (metrics MAP) LIMIT 1");
    if (checkBaselinesResponse.items.length === 0) {
      console.log("Checking for baseline data to import...");
      await importBaselines(ditto);
    }
  } catch (error) {
    // Collection doesn't exist yet, try to import baselines
    console.log("Baseline collection doesn't exist, checking for baseline data to import...");
    await importBaselines(ditto);
  }

  const showSystemInfo = async () => {
    try {
      console.log(`\n${applyColor('System Information', 'blue')}`);
      console.log(`${applyColor('═'.repeat(50), 'blue')}`);
      
      // Get Ditto version
      let dittoVersion = 'Unknown';
      try {
        const dittoPackagePath = path.join(process.cwd(), 'node_modules', '@dittolive', 'ditto', 'package.json');
        if (fs.existsSync(dittoPackagePath)) {
          const packageJson = JSON.parse(fs.readFileSync(dittoPackagePath, 'utf8'));
          dittoVersion = packageJson.version;
        }
      } catch (error) {
        console.error('Could not read Ditto version:', error);
      }
      
      console.log(`\nDitto SDK Version: ${applyColor(dittoVersion, 'green')}`);
      
      // Get system information
      const platform = os.platform();
      const arch = os.arch();
      const release = os.release();
      const hostname = os.hostname();
      const uptime = Math.floor(os.uptime() / 60); // Convert to minutes
      
      // Memory information
      const totalMemory = Math.round(os.totalmem() / (1024 * 1024 * 1024)); // GB
      const freeMemory = Math.round(os.freemem() / (1024 * 1024 * 1024)); // GB
      const usedMemory = totalMemory - freeMemory;
      const memoryUsage = Math.round((usedMemory / totalMemory) * 100);
      
      // CPU information
      const cpus = os.cpus();
      const cpuModel = cpus[0]?.model || 'Unknown';
      const cpuCores = cpus.length;
      
      // Load averages (Unix-like systems)
      const loadAvg = os.loadavg();
      
      console.log(`\nSystem Information:`);
      console.log(`  Platform: ${applyColor(`${platform} ${arch}`, 'green')}`);
      console.log(`  OS Release: ${applyColor(release, 'green')}`);
      console.log(`  Hostname: ${applyColor(hostname, 'green')}`);
      console.log(`  Uptime: ${applyColor(`${uptime} minutes`, 'green')}`);
      
      console.log(`\nCPU Information:`);
      console.log(`  Model: ${applyColor(cpuModel, 'green')}`);
      console.log(`  Cores: ${applyColor(cpuCores.toString(), 'green')}`);
      if (platform !== 'win32') {
        console.log(`  Load Average: ${applyColor(`${loadAvg[0].toFixed(2)}, ${loadAvg[1].toFixed(2)}, ${loadAvg[2].toFixed(2)}`, 'green')}`);
      }
      
      console.log(`\nMemory Information:`);
      console.log(`  Total: ${applyColor(`${totalMemory} GB`, 'green')}`);
      console.log(`  Used: ${applyColor(`${usedMemory} GB`, usedMemory / totalMemory > 0.8 ? 'red' : 'green')} (${memoryUsage}%)`);
      console.log(`  Free: ${applyColor(`${freeMemory} GB`, 'green')}`);
      
      // Node.js Process Information
      const processMemory = process.memoryUsage();
      const heapUsed = Math.round(processMemory.heapUsed / (1024 * 1024)); // MB
      const heapTotal = Math.round(processMemory.heapTotal / (1024 * 1024)); // MB
      const external = Math.round(processMemory.external / (1024 * 1024)); // MB
      const nodeVersion = process.version;
      const processUptime = Math.floor(process.uptime() / 60); // Minutes
      
      console.log(`\nNode.js Information:`);
      console.log(`  Version: ${applyColor(nodeVersion, 'green')}`);
      console.log(`  Process Uptime: ${applyColor(`${processUptime} minutes`, 'green')}`);
      console.log(`  Heap Used: ${applyColor(`${heapUsed} MB`, heapUsed > heapTotal * 0.8 ? 'red' : 'green')} / ${heapTotal} MB`);
      console.log(`  External Memory: ${applyColor(`${external} MB`, 'green')}`);
      
      // Storage Information
      let diskInfo = '';
      let dittoDirSize = '';
      try {
        const stats = fs.statSync('./');
        const dittoPath = path.join(process.cwd(), 'ditto');
        
        // Get available disk space (approximate via fs.statSync)
        if (fs.existsSync(dittoPath)) {
          const getDirSize = (dirPath: string): number => {
            let totalSize = 0;
            const files = fs.readdirSync(dirPath);
            for (const file of files) {
              const filePath = path.join(dirPath, file);
              const stat = fs.statSync(filePath);
              if (stat.isDirectory()) {
                totalSize += getDirSize(filePath);
              } else {
                totalSize += stat.size;
              }
            }
            return totalSize;
          };
          
          const size = getDirSize(dittoPath);
          const sizeMB = Math.round(size / (1024 * 1024));
          dittoDirSize = `${sizeMB} MB`;
        } else {
          dittoDirSize = 'Not found';
        }
      } catch (error) {
        dittoDirSize = 'Unable to calculate';
      }
      
      console.log(`\nStorage Information:`);
      console.log(`  Working Directory: ${applyColor(process.cwd(), 'green')}`);
      console.log(`  Ditto Directory: ${applyColor(ditto.persistenceDirectory, 'green')}`);
      console.log(`  Ditto Database Size: ${applyColor(dittoDirSize, 'green')}`);
      
      // Database Statistics Section
      console.log(`\n${applyColor('Database Statistics', 'blue')}`);
      console.log(`${applyColor('─'.repeat(30), 'blue')}`);
      
      // Get document count
      const countResult = await ditto.store.execute("SELECT COUNT(*) FROM movies");
      
      let documentCount = 0;
      if (countResult.items.length > 0) {
        const item = countResult.items[0];
        const value = item.value;
        // COUNT(*) returns an object like {"($1)": 23539}
        if (value && typeof value === 'object') {
          // Get the first (and only) value from the object
          documentCount = Object.values(value)[0] as number;
        }
      }
      
      console.log(`\nDocument Counts:`);
      if (documentCount !== undefined) {
        console.log(`  movies: ${applyColor(documentCount.toString(), 'green')}`);
      } else {
        console.log(`  movies: ${applyColor('Unable to get count', 'red')}`);
      }
      
      // Get DQL configuration
      let dqlStrictMode = 'Unknown';
      try {
        const strictModeResult = await ditto.store.execute("SHOW DQL_STRICT_MODE");
        if (strictModeResult.items.length > 0) {
          dqlStrictMode = strictModeResult.items[0].value?.dql_strict_mode.toString() || 'Unknown';
        }
      } catch (error) {
        dqlStrictMode = 'Unable to fetch';
      }
      
      // Get document size statistics
      let avgDocSize = 'Unknown';
      let minDocSize = 'Unknown';
      let maxDocSize = 'Unknown';
      try {
        // Sample a subset of documents to calculate size statistics
        const sampleResult = await ditto.store.execute("SELECT * FROM movies LIMIT 100");
        if (sampleResult.items.length > 0) {
          const sizes = sampleResult.items.map(item => {
            const jsonStr = JSON.stringify(item.value);
            return jsonStr.length;
          });
          
          const totalSize = sizes.reduce((sum, size) => sum + size, 0);
          avgDocSize = `${Math.round(totalSize / sizes.length)} bytes`;
          minDocSize = `${Math.min(...sizes)} bytes`;
          maxDocSize = `${Math.max(...sizes)} bytes`;
        }
      } catch (error) {
        avgDocSize = 'Unable to calculate';
      }
      
      console.log(`\nDatabase Configuration:`);
      console.log(`  DQL Strict Mode: ${applyColor(dqlStrictMode, dqlStrictMode === 'false' ? 'green' : 'yellow_highlight')}`);
      console.log(`  Sync Enabled: ${applyColor('false', 'green')} (disabled for benchmarking)`);
      
      console.log(`\nDocument Statistics (sample of 100):`);
      console.log(`  Average Size: ${applyColor(avgDocSize, 'green')}`);
      console.log(`  Min Size: ${applyColor(minDocSize, 'green')}`);
      console.log(`  Max Size: ${applyColor(maxDocSize, 'green')}`)
      
      // Get current indexes
      const indexesResult = await ditto.store.execute("SELECT * FROM system:indexes");
      
      console.log(`\nIndexes:`);
      if (!indexesResult || !indexesResult.items || indexesResult.items.length === 0) {
        console.log(`  ${applyColor('None', 'yellow_highlight')}`);
      } else {
        // Count valid indexes
        let validIndexes = 0;
        const indexDetails: string[] = [];
        
        for (const indexItem of indexesResult.items) {
          const indexData = indexItem.value;
          if (indexData && indexData._id && indexData.collection && indexData.fields) {
            validIndexes++;
            const indexId = indexData._id; // Format: "collection.index_name"
            const collection = indexData.collection;
            const fields = indexData.fields;
            
            // Extract index name from the ID
            const indexName = indexId.substring(collection.length + 1);
            
            indexDetails.push(`    • ${applyColor(indexName, 'green')} on ${applyColor(collection, 'blue')} (${fields.join(', ')})`);
          }
        }
        
        console.log(validIndexes)
        if (validIndexes === 0) {
          console.log(`  ${applyColor('None', 'yellow_highlight')}`);
        } else {
          console.log(`  Total: ${applyColor(validIndexes.toString(), 'green')}`);
          console.log(`  Details:`);
          indexDetails.forEach(detail => console.log(detail));
        }
      }

      console.log(`\n${applyColor('═'.repeat(50), 'blue')}\n`);
    } catch (error) {
      console.log(`${applyColor('Failed to get system information:', 'red')} ${error}`);
    }
  };

  const cleanupIndexes = async () => {
    try {
      // Get all existing indexes
      const indexesResult = await ditto.store.execute("SELECT * FROM system:indexes");
      
      if (indexesResult.items.length === 0) {
        console.log(`${applyColor('No indexes to clean up', 'blue')}`);
        return;
      }
      
      console.log(`${applyColor(`Cleaning up ${indexesResult.items.length} indexes...`, 'blue')}`);
      
      // Drop each index
      for (const indexItem of indexesResult.items) {
        const indexData = indexItem.value;
        const indexId = indexData._id; // Format: "collection.index_name"
        const collection = indexData.collection;
        
        // Extract index name from the ID (remove collection prefix)
        const indexName = indexId.substring(collection.length + 1);
        
        try {
          await ditto.store.execute(`DROP INDEX IF EXISTS ${indexName} ON ${collection}`);
          console.log(`  Dropped index: ${indexName} on ${collection}`);
        } catch (error) {
          console.log(`  Failed to drop index ${indexName} on ${collection}: ${error}`);
        }
      }
      
      console.log(`${applyColor('Index cleanup complete', 'green')}`);
    } catch (error) {
      console.log(`${applyColor('Index cleanup failed:', 'red')} ${error}`);
    }
  };

  const benchmarkQuery = async (query: string, count: number = 20, preQueries: string[] = [], compareBaseline: boolean = true) => {
    console.log(`\n${applyColor('Benchmarking Query', 'blue')}`);
    console.log(`Query: ${applyColor(query, 'green')}`);
    console.log(`Runs: ${count}`);
    console.log(`${applyColor('─'.repeat(50), 'blue')}`);
    
    const times: number[] = [];
    let resultCount = 0;
    
    console.log('Running benchmark...');
    
    for (let i = 0; i < count; i++) {
      const start = Date.now();
      try {
        const result = await ditto.store.execute(query);
        const elapsed = Date.now() - start;
        times.push(elapsed);
        if (i === 0) resultCount = result.items.length; // Store result count from first run
        
        // Show progress every 20% or every 10 runs for small counts
        const progressInterval = Math.max(1, Math.floor(count / 5));
        if ((i + 1) % progressInterval === 0 || i === count - 1) {
          const percent = Math.round(((i + 1) / count) * 100);
          console.log(`Progress: ${percent}% (${i + 1}/${count})`);
        }
      } catch (error) {
        console.log(`\n${applyColor('Feature not supported:', 'yellow_highlight')} ${error instanceof Error ? error.message : String(error)}`);
        console.log('Skipping benchmark for this query');
        return {
          mean: -1, median: -1, min: -1, max: -1, stdDev: -1, p95: -1, p99: -1, resultCount: -1, times: []
        };
      }
    }
    
    // Calculate statistics
    times.sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    const mean = sum / times.length;
    const median = times.length % 2 === 0 
      ? (times[times.length / 2 - 1] + times[times.length / 2]) / 2
      : times[Math.floor(times.length / 2)];
    const min = times[0];
    const max = times[times.length - 1];
    const p95 = times[Math.floor(times.length * 0.95)];
    const p99 = times[Math.floor(times.length * 0.99)];
    
    // Calculate standard deviation
    const variance = times.reduce((acc, time) => acc + Math.pow(time - mean, 2), 0) / times.length;
    const stdDev = Math.sqrt(variance);
    
    console.log(`\n${applyColor('Benchmark Results', 'blue')}`);
    console.log(`${applyColor('═'.repeat(50), 'blue')}`);
    console.log(`Result Count: ${resultCount}`);
    console.log(`Total Runs: ${count}`);
    console.log(`\nTiming Statistics (ms):`);
    console.log(`  Mean:     ${mean.toFixed(2)}`);
    console.log(`  Median:   ${median.toFixed(2)}`);
    console.log(`  Min:      ${min}`);
    console.log(`  Max:      ${max}`);
    console.log(`  Std Dev:  ${stdDev.toFixed(2)}`);
    console.log(`  95th %:   ${p95}`);
    console.log(`  99th %:   ${p99}`);
    console.log(`\nThroughput:`);
    console.log(`  Queries/sec: ${(1000 / mean).toFixed(2)}`);
    console.log(`  Total time:  ${(sum / 1000).toFixed(2)}s`);
    
    // Compare with baselines if requested (only if query is supported)
    if (compareBaseline && mean !== -1) {
      const hash = generateBenchmarkHash(preQueries, query);
      const dittoVersion = await getDittoVersion();
      const comparisonBaselines = await getComparisonBaselines(ditto, hash, dittoVersion);
      const currentBaseline = await getBaseline(ditto, hash, dittoVersion);
      
      if (comparisonBaselines.length > 0 || currentBaseline) {
        console.log(`\n${applyColor(`Baseline Comparisons (current: v${dittoVersion})`, 'blue')}`);
        console.log(`${applyColor('─'.repeat(50), 'blue')}`);
        
        const formatDiff = (current: number, baseline: number) => {
          const percentDiff = ((current - baseline) / baseline) * 100;
          const absoluteDiff = current - baseline;
          const sign = percentDiff >= 0 ? '+' : '';
          
          // Color based on performance impact (matching table format)
          let color: 'green' | 'yellow_highlight' | 'red' | 'blue';
          if (baseline < 10) {
            // For fast queries, use absolute difference
            if (Math.abs(absoluteDiff) < 1) {
              color = 'blue';
            } else if (absoluteDiff < 0) {
              color = 'green';
            } else if (absoluteDiff < 2) {
              color = 'yellow_highlight';
            } else {
              color = 'red';
            }
          } else {
            // For slow queries, use percentage
            if (Math.abs(percentDiff) < 5) {
              color = 'blue';
            } else if (percentDiff < 0) {
              color = 'green';
            } else if (percentDiff < 15) {
              color = 'yellow_highlight';
            } else {
              color = 'red';
            }
          }
          
          return applyColor(`${sign}${percentDiff.toFixed(1)}%`, color);
        };
        
        // Collect all baselines for display
        const allBaselines: BenchmarkBaseline[] = [];
        if (currentBaseline) {
          allBaselines.push(currentBaseline);
        }
        allBaselines.push(...comparisonBaselines);
        
        // Sort by version (current first, then by version number descending)
        allBaselines.sort((a, b) => {
          if (a._id.ditto_version === dittoVersion) return -1;
          if (b._id.ditto_version === dittoVersion) return 1;
          return compareVersions(a._id.ditto_version, b._id.ditto_version);
        });
        
        // Show all version comparisons
        allBaselines.forEach((baseline) => {
          const isCurrent = baseline._id.ditto_version === dittoVersion;
          const versionLabel = isCurrent ? `v${baseline._id.ditto_version} (current baseline)` : `v${baseline._id.ditto_version}`;
          console.log(`  ${versionLabel}: ${baseline.metrics.mean.toFixed(1)}ms ${formatDiff(mean, baseline.metrics.mean)} (→ ${mean.toFixed(1)}ms)`);
        });
      } else {
        console.log(`\n${applyColor('No baselines found for comparison', 'yellow_highlight')}`);
        console.log(`Create baselines with '.benchmark_baseline' first`);
      }
    }
    
    console.log(`${applyColor('═'.repeat(50), 'blue')}\n`);
    
    return {
      mean, median, min, max, stdDev, p95, p99, resultCount, times
    };
  };

  const runScenario = async (scenarioName: string, scenario: ScenarioQuery[]) => {
    console.log(`\nRunning scenario: ${scenarioName}`);
    let passedTests = 0;
    let totalTests = 0;
    
    for (let index = 0; index < scenario.length; index++) {
      const item = scenario[index];
      let query: string;
      let expectedCount: number | undefined;
      let expectedIndex: string | 'full_scan' | undefined;
      let maxExecutionTime: number | undefined;
      
      if (typeof item === 'string') {
        query = item;
      } else {
        query = item.query;
        expectedCount = item.expectedCount;
        expectedIndex = item.expectedIndex;
        maxExecutionTime = item.maxExecutionTime;
        if (expectedCount !== undefined || expectedIndex !== undefined || maxExecutionTime !== undefined) totalTests++;
      }
      
      console.log(applyColor(`Executing: ${index + 1}/${scenario.length}`, 'blue'));
      console.log(`Query: ${applyColor(query, 'green')}`);
      
      const { countPassed, indexPassed, timePassed } = await executeDql(query, expectedCount, expectedIndex, maxExecutionTime);
      
      // Check if tests passed
      const hasTest = expectedCount !== undefined || expectedIndex !== undefined || maxExecutionTime !== undefined;
      const allPassed = countPassed && indexPassed && timePassed;
      
      if (hasTest && allPassed) {
        passedTests++;
      }
    }
    
    if (totalTests > 0) {
      console.log(`\nScenario Summary: ${passedTests}/${totalTests} tests passed`);
      if (passedTests === totalTests) {
        console.log(applyColor('All tests passed! ✓', 'green'));
      } else {
        console.log(applyColor(`${totalTests - passedTests} tests failed ✗`, 'red'));
      }
    }
    
    // Clean up indexes after scenario completes
    console.log(`\n${applyColor('─'.repeat(50), 'blue')}`);
    await cleanupIndexes();
    
    return { passedTests, totalTests };
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'DQL> '
  });

  console.log('Ditto DQL Terminal');
  console.log(`Ditto SDK Version: ${applyColor(dittoVersion, 'green')}`);
  console.log(`\nType ${applyColor('.help', 'blue')} for available commands`);

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (input.toLowerCase() === '.exit') {
      rl.close();
      return;
    }

    if (input.toLowerCase() === '.help') {
      console.log('\nAvailable commands:');
      console.log('  .help    - Show this help message');
      console.log('  .list    - List all available scenarios');
      console.log('  .run <name|index> - Run a scenario by name or index number');
      console.log('  .all     - Run all scenarios in sequence');
      console.log('  .bench <query> - Benchmark a query (20 runs)');
      console.log('  .benchmarks - List all available benchmarks');
      console.log('  .benchmark <name|index> [runs] - Run a specific benchmark (default: 5)');
      console.log('  .benchmark_all [runs] - Run all benchmarks (default: 5)');
      console.log('  .benchmark_baseline [runs] - Create baselines for all benchmarks (default: 50)');
      console.log('  .benchmark_baseline <name> [runs] - Create baseline for specific benchmark');
      console.log('  .benchmark_show - Show saved baseline comparison table');
      console.log('  .system  - Show system information (document counts, indexes)');
      console.log('  .export <query> - Export query results to exports/export_<timestamp>.ndjson');
      console.log('  .log_dump - Export current log buffer to logs/manual-logs_<timestamp>.ndjson');
      console.log('  .log_debug - Show log buffer debug information');
      console.log('  .exit    - Exit the DQL terminal');
      console.log('\nDQL queries:');
      console.log('  - Enter any valid DQL query to execute');
      console.log('  - Queries starting with EXPLAIN will show execution plan');
      console.log('\nScenario validation:');
      console.log('  - Scenarios can include expected result counts, index usage, and execution time');
      console.log('  - expectedCount: validates the number of results returned');
      console.log('  - expectedIndex: automatically runs EXPLAIN and validates index usage');
      console.log('  - maxExecutionTime: validates query executes within time limit (ms)');
      console.log('  - Use "full_scan" to expect a full table scan');
      console.log('\nBaseline overwrite options:');
      console.log('  y/yes  - Overwrite this baseline');
      console.log('  N/no   - Skip this baseline (default)');
      console.log('  a/all  - Overwrite all remaining baselines');
      console.log('  n/none - Skip all remaining baselines');
      console.log('\nExample queries:');
      console.log('  SELECT * FROM movies LIMIT 10');
      console.log('  SELECT title FROM movies WHERE year > 2020');
      console.log('  EXPLAIN SELECT * FROM movies WHERE genre = "Action"');
      console.log();
      rl.prompt();
      return;
    }

    if (input) {
      try {
        if (input.toLowerCase() === '.list') {
          const scenarioKeys = Object.keys(scenarios);
          console.log('\nAvailable scenarios:');
          scenarioKeys.forEach((key, index) => {
            console.log(`  ${index + 1}. ${applyColor(key, 'green')}`);
          });
          console.log();
        }
        else if (input.toLowerCase().startsWith('.run')) {
          const arg = input.split(' ')[1];
          if (!arg) {
            console.log('Please provide a scenario name or index number');
            rl.prompt();
            return;
          }
          
          const scenarioKeys = Object.keys(scenarios);
          let scenarioName: string;
          
          // Check if arg is a number (index)
          const index = parseInt(arg);
          if (!isNaN(index) && index > 0 && index <= scenarioKeys.length) {
            scenarioName = scenarioKeys[index - 1];
          } else {
            scenarioName = arg;
          }
          
          const scenario = scenarios[scenarioName as keyof typeof scenarios];
          
          if (!scenario) {
            console.log(`Scenario '${arg}' not found. Use .list to see available scenarios.`);
            rl.prompt();
            return;
          }
          
          await runScenario(scenarioName, scenario as ScenarioQuery[]);
        }
        else if (input.toLowerCase() === '.all') {
          const scenarioKeys = Object.keys(scenarios);
          let totalPassed = 0;
          let totalTestCount = 0;
          const scenarioResults: { name: string; passed: number; total: number; status: 'pass' | 'fail' | 'no-tests' }[] = [];
          
          console.log(`\n${applyColor('Running all scenarios...', 'blue')}`);
          console.log(`${applyColor('━'.repeat(50), 'blue')}\n`);
          
          // Clean up any existing indexes before starting
          console.log(`${applyColor('Pre-run cleanup:', 'blue')}`);
          await cleanupIndexes();
          console.log(`${applyColor('━'.repeat(50), 'blue')}\n`);
          
          for (const scenarioName of scenarioKeys) {
            const scenario = scenarios[scenarioName as keyof typeof scenarios];
            const { passedTests, totalTests } = await runScenario(scenarioName, scenario as ScenarioQuery[]);
            totalPassed += passedTests;
            totalTestCount += totalTests;
            
            let status: 'pass' | 'fail' | 'no-tests';
            if (totalTests === 0) {
              status = 'no-tests';
            } else if (passedTests === totalTests) {
              status = 'pass';
            } else {
              status = 'fail';
            }
            
            scenarioResults.push({ name: scenarioName, passed: passedTests, total: totalTests, status });
            console.log(`${applyColor('─'.repeat(50), 'blue')}\n`);
          }
          
          console.log(`${applyColor('═'.repeat(50), 'blue')}`);
          console.log(applyColor('SUMMARY', 'blue'));
          console.log(`${applyColor('═'.repeat(50), 'blue')}\n`);
          
          // Scenario summary
          const passedScenarios = scenarioResults.filter(r => r.status === 'pass').length;
          const failedScenarios = scenarioResults.filter(r => r.status === 'fail').length;
          const noTestScenarios = scenarioResults.filter(r => r.status === 'no-tests').length;
          
          console.log('Scenario Results:');
          for (const result of scenarioResults) {
            const statusIcon = result.status === 'pass' ? '✓' : result.status === 'fail' ? '✗' : '-';
            const statusColor = result.status === 'pass' ? 'green' : result.status === 'fail' ? 'red' : 'blue';
            const testInfo = result.total > 0 ? ` (${result.passed}/${result.total} tests)` : ' (no validation tests)';
            console.log(`  ${applyColor(statusIcon, statusColor)} ${result.name}${testInfo}`);
          }
          
          // Scenario-level summary
          console.log(`\n${applyColor('─'.repeat(50), 'blue')}`);
          console.log(`Scenario Summary: ${passedScenarios} passed, ${failedScenarios} failed, ${noTestScenarios} no tests`);
          if (failedScenarios > 0) {
            const scenarioFailRate = Math.round((failedScenarios / (passedScenarios + failedScenarios)) * 100);
            console.log(`Scenario Fail Rate: ${scenarioFailRate}%`);
          }
          
          // Test-level summary
          if (totalTestCount > 0) {
            console.log(`\nTest Summary: ${totalPassed}/${totalTestCount} tests passed`);
            const testPassRate = Math.round((totalPassed / totalTestCount) * 100);
            if (totalPassed === totalTestCount) {
              console.log(applyColor(`Overall Result: PASS (100%) ✓`, 'green'));
            } else {
              const testFailRate = 100 - testPassRate;
              console.log(applyColor(`Overall Result: FAIL (${testPassRate}% pass, ${testFailRate}% fail) ✗`, 'red'));
            }
          } else {
            console.log('\nNo validation tests were run.');
          }
          console.log(`${applyColor('═'.repeat(50), 'blue')}\n`);
        }
        else if (input.toLowerCase() === '.benchmarks') {
          const benchmarkKeys = Object.keys(benchmarks);
          console.log('\nAvailable benchmarks:');
          benchmarkKeys.forEach((key, index) => {
            const benchmark = benchmarks[key as keyof typeof benchmarks] as Benchmark;
            console.log(`  ${index + 1}. ${applyColor(key, 'green')} - ${benchmark.query}`);
          });
          console.log();
        }
        else if (input.toLowerCase().startsWith('.benchmark ')) {
          const args = input.split(' ');
          const arg = args[1];
          const runCount = args[2] ? parseInt(args[2]) : 5;
          
          if (!arg) {
            console.log('Please provide a benchmark name or index number');
            rl.prompt();
            return;
          }
          
          if (isNaN(runCount) || runCount < 1) {
            console.log('Run count must be a positive number');
            rl.prompt();
            return;
          }
          
          const benchmarkKeys = Object.keys(benchmarks);
          let benchmarkName: string;
          
          // Check if arg is a number (index)
          const index = parseInt(arg);
          if (!isNaN(index) && index > 0 && index <= benchmarkKeys.length) {
            benchmarkName = benchmarkKeys[index - 1];
          } else {
            benchmarkName = arg;
          }
          
          const benchmark = benchmarks[benchmarkName as keyof typeof benchmarks] as Benchmark;
          
          if (!benchmark) {
            console.log(`Benchmark '${arg}' not found. Use .benchmarks to see available benchmarks.`);
            rl.prompt();
            return;
          }
          
          console.log(`\nRunning benchmark: ${benchmarkName}`);
          
          // Run pre-queries if they exist
          if (benchmark.preQueries && benchmark.preQueries.length > 0) {
            console.log(`${applyColor('Running setup queries...', 'blue')}`);
            for (const preQuery of benchmark.preQueries) {
              console.log(`  Setup: ${preQuery}`);
              await ditto.store.execute(preQuery);
            }
          }
          
          console.log(`Query: ${benchmark.query}`);
          await benchmarkQuery(benchmark.query, runCount, benchmark.preQueries || []);
          
          // Run post-queries if they exist
          if (benchmark.postQueries && benchmark.postQueries.length > 0) {
            console.log(`${applyColor('Running cleanup queries...', 'blue')}`);
            for (const postQuery of benchmark.postQueries) {
              console.log(`  Cleanup: ${postQuery}`);
              await ditto.store.execute(postQuery);
            }
          }
        }
        else if (input.toLowerCase().startsWith('.benchmark_all')) {
          const args = input.split(' ');
          const runCount = args[1] ? parseInt(args[1]) : 5;
          
          if (isNaN(runCount) || runCount < 1) {
            console.log('Run count must be a positive number');
            rl.prompt();
            return;
          }
          
          const benchmarkKeys = Object.keys(benchmarks);
          const benchmarkResults: Array<{
            name: string;
            mean: number;
            baselineMean?: number;
            percentChange?: number;
            hasBaseline: boolean;
          }> = [];
          
          // Collect all baseline data by benchmark and version
          const baselinesByBenchmark = new Map<string, Map<string, number>>();
          const allVersions = new Set<string>();
          const dittoVersion = await getDittoVersion();
          allVersions.add(dittoVersion);
          
          console.log(`\n${applyColor('Running all benchmarks...', 'blue')}`);
          console.log(`${applyColor(`Runs per benchmark: ${runCount}`, 'blue')}`);
          console.log(`${applyColor('━'.repeat(50), 'blue')}\n`);
          
          let skippedBenchmarks = 0;
          let benchmarkIndex = 0;
          
          for (const benchmarkName of benchmarkKeys) {
            benchmarkIndex++;
            const benchmark = benchmarks[benchmarkName as keyof typeof benchmarks] as Benchmark;
            console.log(`${applyColor(`Running benchmark (${benchmarkIndex}/${benchmarkKeys.length}): ${benchmarkName}`, 'blue')}`);
            
            try {
              // Run pre-queries if they exist
              if (benchmark.preQueries && benchmark.preQueries.length > 0) {
                console.log(`${applyColor('Running setup queries...', 'blue')}`);
                for (const preQuery of benchmark.preQueries) {
                  console.log(`  Setup: ${preQuery}`);
                  await ditto.store.execute(preQuery);
                }
              }
              
              console.log(`Query: ${benchmark.query}`);
              const results = await benchmarkQuery(benchmark.query, runCount, benchmark.preQueries || []);
            
              // Only collect baseline data if query is supported
              if (results.mean !== -1) {
                // Collect results for summary
                const hash = generateBenchmarkHash(benchmark.preQueries || [], benchmark.query);
                const comparisonBaselines = await getComparisonBaselines(ditto, hash, dittoVersion);
                const currentBaseline = await getBaseline(ditto, hash, dittoVersion);
                
                // Store current run results
                if (!baselinesByBenchmark.has(benchmarkName)) {
                  baselinesByBenchmark.set(benchmarkName, new Map());
                }
                const benchmarkData = baselinesByBenchmark.get(benchmarkName)!;
                benchmarkData.set(dittoVersion, results.mean);
                
                // Store all historical baselines for this benchmark
                comparisonBaselines.forEach(baseline => {
                  allVersions.add(baseline._id.ditto_version);
                  benchmarkData.set(baseline._id.ditto_version, baseline.metrics.mean);
                });
                
                // Also include current version baseline if it exists (different from current run)
                if (currentBaseline && currentBaseline.metrics.mean !== results.mean) {
                  benchmarkData.set(`${dittoVersion}-baseline`, currentBaseline.metrics.mean);
                  allVersions.add(`${dittoVersion}-baseline`);
                }
              }
              
              // For backward compatibility with existing summary logic
              let baselineMean: number | undefined;
              let percentChange: number | undefined;
              let hasBaseline = false;
              
              if (results.mean !== -1) {
                const hash = generateBenchmarkHash(benchmark.preQueries || [], benchmark.query);
                const comparisonBaselines = await getComparisonBaselines(ditto, hash, dittoVersion);
                const currentBaseline = await getBaseline(ditto, hash, dittoVersion);
                
                if (comparisonBaselines.length > 0) {
                  // Use the most recent comparison baseline
                  baselineMean = comparisonBaselines[0].metrics.mean;
                  percentChange = ((results.mean - baselineMean) / baselineMean) * 100;
                  hasBaseline = true;
                } else if (currentBaseline) {
                  // Fall back to current version baseline
                  baselineMean = currentBaseline.metrics.mean;
                  percentChange = ((results.mean - baselineMean) / baselineMean) * 100;
                  hasBaseline = true;
                }
              }
              
              benchmarkResults.push({
                name: benchmarkName,
                mean: results.mean,
                baselineMean,
                percentChange,
                hasBaseline
              });
              
              // Run post-queries if they exist
              if (benchmark.postQueries && benchmark.postQueries.length > 0) {
                console.log(`${applyColor('Running cleanup queries...', 'blue')}`);
                for (const postQuery of benchmark.postQueries) {
                  try {
                    console.log(`  Cleanup: ${postQuery}`);
                    await ditto.store.execute(postQuery);
                  } catch (cleanupError) {
                    console.log(`${applyColor('⚠️ Cleanup query failed:', 'yellow_highlight')} ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`);
                  }
                }
              }
              
            } catch (error: any) {
              console.log(`${applyColor('❌ Benchmark failed:', 'red')} ${error.message || error}`);
              console.log(`${applyColor('Skipping benchmark:', 'yellow_highlight')} ${benchmarkName}`);
              skippedBenchmarks++;
              
              // Still add to results but with error indicators
              benchmarkResults.push({
                name: benchmarkName,
                mean: -1,
                baselineMean: undefined,
                percentChange: undefined,
                hasBaseline: false
              });
              
              // Try to run cleanup queries even if main benchmark failed
              if (benchmark.postQueries && benchmark.postQueries.length > 0) {
                console.log(`${applyColor('Attempting cleanup after failure...', 'blue')}`);
                for (const postQuery of benchmark.postQueries) {
                  try {
                    console.log(`  Cleanup: ${postQuery}`);
                    await ditto.store.execute(postQuery);
                  } catch (cleanupError) {
                    console.log(`${applyColor('⚠️ Cleanup query failed:', 'yellow_highlight')} ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`);
                  }
                }
              }
            }
            
            console.log(`${applyColor('─'.repeat(50), 'blue')}\n`);
          }
          
          // Generate comprehensive summary
          console.log(`${applyColor('═'.repeat(80), 'blue')}`);
          console.log(`${applyColor('BENCHMARK SUMMARY', 'blue')}`);
          console.log(`${applyColor('═'.repeat(80), 'blue')}\n`);
          
          // Sort versions (current first, then alphabetically) - show ALL versions
          const sortedVersions = Array.from(allVersions).sort((a, b) => {
            if (a === dittoVersion) return -1;
            if (b === dittoVersion) return 1;
            return a.localeCompare(b);
          });
          
          // Show all versions (no limit)
          const displayVersions = sortedVersions;
          
          // Generate table header
          console.log('Benchmark Name                 ' + displayVersions.map(v => {
            if (v === dittoVersion) {
              return `Current (${v})`.padStart(15);
            } else if (v.endsWith('-baseline')) {
              const baseVersion = v.replace('-baseline', '');
              return `${baseVersion} Baseline`.padStart(15);
            } else {
              return v.padStart(15);
            }
          }).join(' '));
          console.log('─'.repeat(30) + ' ' + displayVersions.map(() => '─'.repeat(15)).join(' '));
          
          // Helper functions for table formatting
          const formatCell = (value: number | undefined) => {
            if (value === undefined) return '       -       ';
            if (value === -1) return '      N/A      ';
            return value.toFixed(1).padStart(15);
          };
          
          const formatDiffCell = (displayValue: number | undefined, comparisonValue: number | undefined) => {
            if (displayValue === undefined || comparisonValue === undefined) return '       -       ';
            if (displayValue === -1 || comparisonValue === -1) return '      N/A      ';
            
            const percentDiff = ((comparisonValue - displayValue) / displayValue) * 100;
            const absoluteDiff = comparisonValue - displayValue;
            
            // Color based on performance impact
            let color: 'green' | 'yellow_highlight' | 'red' | 'blue';
            if (displayValue < 10) {
              // For fast queries, use absolute difference
              if (Math.abs(absoluteDiff) < 1) {
                color = 'blue';
              } else if (absoluteDiff < 0) {
                color = 'green';
              } else if (absoluteDiff < 2) {
                color = 'yellow_highlight';
              } else {
                color = 'red';
              }
            } else {
              // For slow queries, use percentage
              if (Math.abs(percentDiff) < 5) {
                color = 'blue';
              } else if (percentDiff < 0) {
                color = 'green';
              } else if (percentDiff < 15) {
                color = 'yellow_highlight';
              } else {
                color = 'red';
              }
            }
            
            // Format the difference display
            let formattedOutput: string;
            if (displayValue < 10) {
              // For fast queries, show absolute difference
              const sign = absoluteDiff >= 0 ? '+' : '';
              formattedOutput = `${displayValue.toFixed(1)} (${sign}${absoluteDiff.toFixed(1)})`;
            } else {
              // For slow queries, show percentage
              const sign = percentDiff >= 0 ? '+' : '';
              formattedOutput = `${displayValue.toFixed(1)} (${sign}${percentDiff.toFixed(0)}%)`;
            }
            
            return applyColor(formattedOutput.padStart(15), color);
          };
          
          let regressions = 0;
          let improvements = 0;
          let noChange = 0;
          let noBaseline = 0;
          
          // Sort benchmarks by name for consistent ordering
          const sortedBenchmarks = Array.from(baselinesByBenchmark.entries()).sort(([a], [b]) => a.localeCompare(b));
          
          // Generate table rows
          for (const [benchmarkName, versionData] of sortedBenchmarks) {
            const row = [benchmarkName.padEnd(30)];
            const currentValue = versionData.get(dittoVersion);
            let hasAnyBaseline = false;
            
            for (let i = 0; i < displayVersions.length; i++) {
              const version = displayVersions[i];
              const value = versionData.get(version);
              
              if (version === dittoVersion) {
                // Current version - just show the value
                row.push(formatCell(value));
              } else if (version.endsWith('-baseline')) {
                // Current version baseline - just show the value without comparison
                row.push(formatCell(value));
              } else {
                // Other versions - show that version's value with comparison to current
                row.push(formatDiffCell(value, currentValue));
                
                // Count regressions/improvements (skip unsupported features)
                if (currentValue !== undefined && currentValue !== -1 && 
                    value !== undefined && value !== -1) {
                  hasAnyBaseline = true;
                  const percentDiff = ((currentValue - value) / value) * 100;
                  const absoluteDiff = currentValue - value;
                  const isSignificant = value < 10 ? Math.abs(absoluteDiff) >= 1 : Math.abs(percentDiff) >= 5;
                  
                  if (isSignificant) {
                    if (percentDiff > 0) regressions++;
                    else improvements++;
                  } else {
                    noChange++;
                  }
                }
              }
            }
            
            if (!hasAnyBaseline) noBaseline++;
            console.log(row.join(' '));
          }
          
          console.log(`\n${applyColor('Legend:', 'blue')}`);
          console.log(`  ${applyColor('Green', 'green')}  = Improvement (>1ms or >5% faster)`);
          console.log(`  ${applyColor('Yellow', 'yellow_highlight')} = Small regression (1-2ms or 5-15% slower)`);
          console.log(`  ${applyColor('Red', 'red')}    = Large regression (>2ms or >15% slower)`);
          console.log(`  ${applyColor('Blue', 'blue')}   = No significant change (≤1ms or ≤5%)`);
          
          const totalComparisons = regressions + improvements + noChange;
          const totalBenchmarks = benchmarkKeys.length;
          const successfulBenchmarks = totalBenchmarks - skippedBenchmarks;
          
          console.log(`\n${applyColor('Benchmark Execution Summary:', 'blue')}`);
          console.log(`  Total Benchmarks: ${totalBenchmarks}`);
          console.log(`  ${applyColor('Successful:', 'green')} ${successfulBenchmarks}`);
          if (skippedBenchmarks > 0) {
            console.log(`  ${applyColor('Skipped (errors):', 'red')} ${skippedBenchmarks}`);
          }
          
          if (totalComparisons > 0) {
            console.log(`\n${applyColor('Performance Comparison Summary:', 'blue')}`);
            console.log(`  Total Comparisons: ${totalComparisons}`);
            console.log(`  ${applyColor('Improvements:', 'green')} ${improvements} (${(improvements/totalComparisons*100).toFixed(0)}%)`);
            console.log(`  ${applyColor('Regressions:', 'red')} ${regressions} (${(regressions/totalComparisons*100).toFixed(0)}%)`);
            console.log(`  ${applyColor('No change:', 'blue')} ${noChange} (${(noChange/totalComparisons*100).toFixed(0)}%)`);
            console.log(`  ${applyColor('No baseline:', 'blue')} ${noBaseline}`);
            
            if (regressions > 0) {
              console.log(`\n${applyColor('⚠️  Performance Alert:', 'red')} ${regressions} comparison(s) showing regression`);
            } else if (improvements > noChange) {
              console.log(`\n${applyColor('✅ Performance Improvement:', 'green')} More improvements than regressions detected`);
            } else {
              console.log(`\n${applyColor('✓ Performance Stable:', 'green')} No significant regressions detected`);
            }
          }
          
          console.log(`${applyColor('═'.repeat(60), 'blue')}\n`);
          console.log(`${applyColor('All benchmarks complete!', 'green')}`);
        }
        else if (input.toLowerCase().startsWith('.benchmark_baseline')) {
          const args = input.split(' ');
          let benchmarkArg: string | undefined = args[1];
          let runCount = 50;
          
          // Check if first arg is a number (run count for all) or benchmark name
          if (benchmarkArg && !isNaN(parseInt(benchmarkArg))) {
            // First arg is a number, so running all benchmarks
            runCount = parseInt(benchmarkArg);
            benchmarkArg = undefined;
          } else if (args[2]) {
            // Second arg might be run count
            const secondArg = parseInt(args[2]);
            if (!isNaN(secondArg) && secondArg > 0) {
              runCount = secondArg;
            }
          }
          
          const benchmarkKeys = Object.keys(benchmarks);
          const dittoVersion = await getDittoVersion();
          
          // Determine which benchmarks to run
          let benchmarksToRun: string[];
          
          if (benchmarkArg) {
            // Specific benchmark requested
            let benchmarkName: string;
            
            // Check if arg is a number (index)
            const index = parseInt(benchmarkArg);
            if (!isNaN(index) && index > 0 && index <= benchmarkKeys.length) {
              benchmarkName = benchmarkKeys[index - 1];
            } else {
              benchmarkName = benchmarkArg;
            }
            
            if (!benchmarks[benchmarkName as keyof typeof benchmarks]) {
              console.log(`Benchmark '${benchmarkArg}' not found. Use .benchmarks to see available benchmarks.`);
              rl.prompt();
              return;
            }
            
            benchmarksToRun = [benchmarkName];
            console.log(`\n${applyColor(`Creating Baseline for: ${benchmarkName}`, 'blue')}`);
          } else {
            // Run all benchmarks
            benchmarksToRun = benchmarkKeys;
            console.log(`\n${applyColor('Creating Baselines for All Benchmarks', 'blue')}`);
          }
          let overwritePolicy: 'ask' | 'all' | 'none' = 'ask';
          
          console.log(`${applyColor('━'.repeat(50), 'blue')}`);
          console.log(`Ditto Version: ${dittoVersion}`);
          console.log(`Runs per baseline: ${runCount}\n`);
          
          let skippedBaselines = 0;
          let benchmarkIndex = 0;
          
          for (const benchmarkName of benchmarksToRun) {
            benchmarkIndex++;
            const benchmark = benchmarks[benchmarkName as keyof typeof benchmarks] as Benchmark;
            const hash = generateBenchmarkHash(benchmark.preQueries || [], benchmark.query);
            
            console.log(`${applyColor(`Creating baseline (${benchmarkIndex}/${benchmarksToRun.length}): ${benchmarkName}`, 'blue')}`);
            console.log(`Hash: ${hash}`);
            
            try {
              // Check if baseline already exists
              const existingBaseline = await getBaseline(ditto, hash, dittoVersion);
              if (existingBaseline) {
                console.log(`${applyColor('⚠️  Baseline already exists for this version!', 'yellow_highlight')}`);
                console.log(`  Existing: ${existingBaseline.metrics.mean.toFixed(1)}ms (${existingBaseline.metrics.runs} runs, ${existingBaseline.metrics.timestamp})`);
                
                let shouldOverwrite = false;
                
                if (overwritePolicy === 'ask') {
                  const answer = await new Promise<string>((resolve) => {
                    rl.question('Overwrite existing baseline? (y/N/a=all/n=none): ', (answer) => {
                      resolve(answer.toLowerCase().trim());
                    });
                  });
                  
                  if (answer === 'a' || answer === 'all') {
                    overwritePolicy = 'all';
                    shouldOverwrite = true;
                    console.log(`${applyColor('✓ Will overwrite all remaining baselines', 'green')}`);
                  } else if (answer === 'n' || answer === 'none') {
                    overwritePolicy = 'none';
                    shouldOverwrite = false;
                    console.log(`${applyColor('✗ Will skip all remaining baselines', 'red')}`);
                  } else if (answer === 'y' || answer === 'yes') {
                    shouldOverwrite = true;
                  } else {
                    shouldOverwrite = false;
                  }
                } else if (overwritePolicy === 'all') {
                  shouldOverwrite = true;
                } else if (overwritePolicy === 'none') {
                  shouldOverwrite = false;
                }
                
                if (!shouldOverwrite) {
                  console.log(`${applyColor('Skipped baseline creation for:', 'blue')} ${benchmarkName}`);
                  console.log(`${applyColor('─'.repeat(50), 'blue')}\n`);
                  continue;
                }
                
                console.log(`${applyColor('Overwriting existing baseline...', 'blue')}`);
              }
              
              // Run pre-queries if they exist
              if (benchmark.preQueries && benchmark.preQueries.length > 0) {
                console.log(`${applyColor('Running setup queries...', 'blue')}`);
                for (const preQuery of benchmark.preQueries) {
                  console.log(`  Setup: ${preQuery}`);
                  await ditto.store.execute(preQuery);
                }
              }
              
              console.log(`Query: ${benchmark.query}`);
              const results = await benchmarkQuery(benchmark.query, runCount, benchmark.preQueries || [], false);
            
              // Only save baseline if query is supported
              if (results.mean !== -1) {
                // Create baseline document (truncate query if too long to fit in 256 byte _id limit)
                const maxQueryLength = 100; // Conservative limit to ensure _id stays under 256 bytes
                const queryForId = benchmark.query.length > maxQueryLength 
                  ? `${benchmark.query.substring(0, maxQueryLength)}...` 
                  : benchmark.query;
                  
                const baseline: BenchmarkBaseline = {
                  _id: {
                    query: queryForId,
                    hash: hash,
                    ditto_version: dittoVersion
                  },
                  metrics: {
                    mean: results.mean,
                    median: results.median,
                    min: results.min,
                    max: results.max,
                    stdDev: results.stdDev,
                    p95: results.p95,
                    p99: results.p99,
                    resultCount: results.resultCount,
                    runs: runCount,
                    timestamp: new Date().toISOString()
                  }
                };
                
                await saveBaseline(ditto, baseline);
                console.log(`${applyColor('✓ Baseline saved', 'green')}`);
              } else {
                console.log(`${applyColor('⚠️ Skipped baseline creation (feature not supported)', 'yellow_highlight')}`);
              }
              
              // Run post-queries if they exist
              if (benchmark.postQueries && benchmark.postQueries.length > 0) {
                console.log(`${applyColor('Running cleanup queries...', 'blue')}`);
                for (const postQuery of benchmark.postQueries) {
                  try {
                    console.log(`  Cleanup: ${postQuery}`);
                    await ditto.store.execute(postQuery);
                  } catch (cleanupError) {
                    console.log(`${applyColor('⚠️ Cleanup query failed:', 'yellow_highlight')} ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`);
                  }
                }
              }
              
            } catch (error: any) {
              console.log(`${applyColor('❌ Baseline creation failed:', 'red')} ${error.message || error}`);
              console.log(`${applyColor('Skipping baseline for:', 'yellow_highlight')} ${benchmarkName}`);
              skippedBaselines++;
              
              // Try to run cleanup queries even if baseline creation failed
              if (benchmark.postQueries && benchmark.postQueries.length > 0) {
                console.log(`${applyColor('Attempting cleanup after failure...', 'blue')}`);
                for (const postQuery of benchmark.postQueries) {
                  try {
                    console.log(`  Cleanup: ${postQuery}`);
                    await ditto.store.execute(postQuery);
                  } catch (cleanupError) {
                    console.log(`${applyColor('⚠️ Cleanup query failed:', 'yellow_highlight')} ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`);
                  }
                }
              }
            }
            
            console.log(`${applyColor('─'.repeat(50), 'blue')}\n`);
          }
          
          const totalBaselines = benchmarksToRun.length;
          const successfulBaselines = totalBaselines - skippedBaselines;
          
          console.log(`${applyColor('═'.repeat(50), 'blue')}`);
          console.log(`${applyColor('BASELINE CREATION SUMMARY', 'blue')}`);
          console.log(`${applyColor('═'.repeat(50), 'blue')}`);
          console.log(`  Total Benchmarks: ${totalBaselines}`);
          console.log(`  ${applyColor('Baselines Created:', 'green')} ${successfulBaselines}`);
          if (skippedBaselines > 0) {
            console.log(`  ${applyColor('Skipped (errors):', 'red')} ${skippedBaselines}`);
          }
          
          if (skippedBaselines === 0) {
            console.log(`\n${applyColor('✅ All baselines created successfully!', 'green')}`);
          } else if (successfulBaselines > 0) {
            console.log(`\n${applyColor('⚠️ Baseline creation completed with some failures', 'yellow_highlight')}`);
          } else {
            console.log(`\n${applyColor('❌ No baselines were created due to errors', 'red')}`);
          }
        }
        else if (input.toLowerCase() === '.benchmark_show') {
          const benchmarkKeys = Object.keys(benchmarks);
          const dittoVersion = await getDittoVersion();
          
          console.log(`\n${applyColor('Loading saved baselines...', 'blue')}`);
          
          // Collect all baseline data by benchmark and version
          const baselinesByBenchmark = new Map<string, Map<string, number>>();
          const allVersions = new Set<string>();
          allVersions.add(dittoVersion);
          
          for (const benchmarkName of benchmarkKeys) {
            const benchmark = benchmarks[benchmarkName as keyof typeof benchmarks] as Benchmark;
            const hash = generateBenchmarkHash(benchmark.preQueries || [], benchmark.query);
            
            // Get all baselines for this hash
            try {
              const result = await ditto.store.execute(
                "SELECT * FROM COLLECTION benchmark_baselines (metrics MAP) WHERE _id.hash = :hash",
                { hash }
              );
              
              if (result.items.length > 0) {
                if (!baselinesByBenchmark.has(benchmarkName)) {
                  baselinesByBenchmark.set(benchmarkName, new Map());
                }
                const benchmarkData = baselinesByBenchmark.get(benchmarkName)!;
                
                result.items.forEach(item => {
                  const baseline = item.value as BenchmarkBaseline;
                  if (baseline.metrics && baseline.metrics.mean !== undefined) {
                    allVersions.add(baseline._id.ditto_version);
                    benchmarkData.set(baseline._id.ditto_version, baseline.metrics.mean);
                  }
                });
              }
            } catch (error) {
              // Skip if error
            }
          }
          
          if (baselinesByBenchmark.size === 0) {
            console.log(`\n${applyColor('No baseline data found!', 'yellow_highlight')}`);
            console.log(`Run '.benchmark_baseline' to create baselines first.`);
            rl.prompt();
            return;
          }
          
          // Generate comprehensive summary
          console.log(`\n${applyColor('═'.repeat(80), 'blue')}`);
          console.log(`${applyColor('SAVED BASELINES', 'blue')}`);
          console.log(`${applyColor('═'.repeat(80), 'blue')}\n`);
          
          // Sort versions (current first, then alphabetically) - show ALL versions
          const sortedVersions = Array.from(allVersions).sort((a, b) => {
            if (a === dittoVersion) return -1;
            if (b === dittoVersion) return 1;
            return a.localeCompare(b);
          });
          
          // Show all versions (no limit)
          const displayVersions = sortedVersions;
          
          // Generate table header
          console.log('Benchmark Name                 ' + displayVersions.map(v => {
            if (v === dittoVersion) {
              return `${v} (current)`.padStart(15);
            } else {
              return v.padStart(15);
            }
          }).join(' '));
          console.log('─'.repeat(30) + ' ' + displayVersions.map(() => '─'.repeat(15)).join(' '));
          
          // Helper function for formatting cells
          const formatCell = (value: number | undefined) => {
            if (value === undefined) return '       -       ';
            return value.toFixed(1).padStart(15);
          };
          
          // Helper function for formatting diff cells
          const formatDiffCell = (current: number | undefined, baseline: number | undefined) => {
            if (current === undefined || baseline === undefined) return '       -       ';
            
            const percentDiff = ((current - baseline) / baseline) * 100;
            const absoluteDiff = current - baseline;
            
            // Color based on performance impact (matching table format)
            let color: 'green' | 'yellow_highlight' | 'red' | 'blue';
            if (displayValue < 10) {
              // For fast queries, use absolute difference
              if (Math.abs(absoluteDiff) < 1) {
                color = 'blue';
              } else if (absoluteDiff < 0) {
                color = 'green';
              } else if (absoluteDiff < 2) {
                color = 'yellow_highlight';
              } else {
                color = 'red';
              }
            } else {
              // For slow queries, use percentage
              if (Math.abs(percentDiff) < 5) {
                color = 'blue';
              } else if (percentDiff < 0) {
                color = 'green';
              } else if (percentDiff < 15) {
                color = 'yellow_highlight';
              } else {
                color = 'red';
              }
            }
            
            // Format the difference display
            let formattedOutput: string;
            if (displayValue < 10) {
              // For fast queries, show absolute difference
              const sign = absoluteDiff >= 0 ? '+' : '';
              formattedOutput = `${displayValue.toFixed(1)} (${sign}${absoluteDiff.toFixed(1)})`;
            } else {
              // For slow queries, show percentage
              const sign = percentDiff >= 0 ? '+' : '';
              formattedOutput = `${displayValue.toFixed(1)} (${sign}${percentDiff.toFixed(0)}%)`;
            }
            
            return applyColor(formattedOutput.padStart(15), color);
          };
          
          // Sort benchmarks by name for consistent ordering
          const sortedBenchmarks = Array.from(baselinesByBenchmark.entries()).sort(([a], [b]) => a.localeCompare(b));
          
          // Generate table rows
          for (const [benchmarkName, versionData] of sortedBenchmarks) {
            const row = [benchmarkName.padEnd(30)];
            const currentValue = versionData.get(dittoVersion);
            
            for (const version of displayVersions) {
              const value = versionData.get(version);
              
              if (version === dittoVersion || currentValue === undefined) {
                // Current version or no current value - just show the value
                row.push(formatCell(value));
              } else {
                // Other versions - show with comparison to current
                row.push(formatDiffCell(currentValue, value));
              }
            }
            
            console.log(row.join(' '));
          }
          
          console.log(`\n${applyColor('Legend:', 'blue')}`);
          console.log(`  ${applyColor('Green', 'green')}  = Improvement (>1ms or >5% faster)`);
          console.log(`  ${applyColor('Yellow', 'yellow_highlight')} = Small regression (1-2ms or 5-15% slower)`);
          console.log(`  ${applyColor('Red', 'red')}    = Large regression (>2ms or >15% slower)`);
          console.log(`  ${applyColor('Blue', 'blue')}   = No significant change (≤1ms or ≤5%)`);
          
          console.log(`\n${applyColor('Total benchmarks with baselines:', 'blue')} ${baselinesByBenchmark.size}`);
          console.log(`${applyColor('Total versions tracked:', 'blue')} ${allVersions.size}`);
        }
        else if (input.toLowerCase().startsWith('.bench')) {
          const queryStart = input.indexOf(' ') + 1;
          if (queryStart === 0) {
            console.log('Usage: .bench <query>');
            console.log('Example: .bench SELECT * FROM movies LIMIT 10');
            rl.prompt();
            return;
          }
          
          let query = input.substring(queryStart).trim();
          
          // Remove quotes if present
          if ((query.startsWith('"') && query.endsWith('"')) || 
              (query.startsWith("'") && query.endsWith("'"))) {
            query = query.slice(1, -1);
          }
          
          await benchmarkQuery(query, 20, [], false); // Don't compare baseline for ad-hoc queries
        }
        else if (input.toLowerCase().startsWith('.export ')) {
          const queryStart = input.indexOf(' ') + 1;
          if (queryStart === 0) {
            console.log('Usage: .export <query>');
            console.log('Examples:');
            console.log('  .export SELECT * FROM movies');
            console.log('  .export SELECT * FROM movies WHERE rated = "PG"');
            console.log('  .export SELECT * FROM benchmark_baselines');
            rl.prompt();
            return;
          }
          
          const query = input.substring(queryStart).trim();
          
          console.log(`\n${applyColor('Executing export query...', 'blue')}`);
          console.log(`Query: ${applyColor(query, 'green')}`);
          
          try {
            // Execute the query
            const result = await ditto.store.execute(query);
            
            if (result.items.length === 0) {
              console.log(`${applyColor('No documents returned by query', 'yellow_highlight')}`);
              rl.prompt();
              return;
            }
            
            // Prepare NDJSON content
            const ndjsonLines = result.items.map(item => JSON.stringify(item.value));
            const ndjsonContent = ndjsonLines.join('\n');
            
            // Create exports directory if it doesn't exist
            const exportsDir = path.join(process.cwd(), 'exports');
            if (!fs.existsSync(exportsDir)) {
              fs.mkdirSync(exportsDir, { recursive: true });
            }
            
            // Generate filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const filename = `export_${timestamp}.ndjson`;
            const filepath = path.join(exportsDir, filename);
            
            fs.writeFileSync(filepath, ndjsonContent);
            
            console.log(`${applyColor('✅ Export successful!', 'green')}`);
            console.log(`  Documents exported: ${result.items.length}`);
            console.log(`  File: ${filepath}`);
            console.log(`  Size: ${(Buffer.byteLength(ndjsonContent) / 1024).toFixed(2)} KB`);
            console.log(`  Query: ${query}`);
            
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log(`${applyColor('❌ Export failed:', 'red')} ${errorMessage}`);
            console.log('Make sure the query is valid and syntactically correct.');
          }
        }
        else if (input.toLowerCase() === '.system') {
          await showSystemInfo();
        }
        else if (input.toLowerCase() === '.log_dump') {
          await manualLogDump();
        }
        else if (input.toLowerCase() === '.log_debug') {
          const logs = logBuffer.getAll();
          console.log(`\n${applyColor('Log Buffer Debug Info:', 'blue')}`);
          console.log(`  Buffer size: ${logs.length}/100`);
          console.log(`  Logger enabled: ${DittoLogger.enabled}`);
          console.log(`  Minimum log level: ${DittoLogger.minimumLogLevel}`);
          if (logs.length > 0) {
            console.log(`  Latest log: ${logs[logs.length - 1].level} - ${logs[logs.length - 1].message.substring(0, 100)}`);
            console.log(`  Oldest log: ${logs[0].level} - ${logs[0].message.substring(0, 100)}`);
          } else {
            console.log(`  ${applyColor('No logs in buffer', 'yellow_highlight')}`);
          }
        }
        else {
          await executeDql(input, undefined, undefined, undefined, true, rl);
        }
      } catch (err) {
        console.error('Error:', err);
      }
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nGoodbye!');
    process.exit(0);
  });
}

main();

type TextColors = 'blue' | 'red' | 'green' | 'yellow_highlight'
const applyColor = (text:string, color:TextColors) => {
  switch(color){
    case 'blue': return `\x1b[34m${text}\x1b[0m`;
    case 'red': return `\x1b[31m${text}\x1b[0m`;
    case 'green': return `\x1b[32m${text}\x1b[0m`;
    case 'yellow_highlight': return `\x1b[43m${text}\x1b[0m`
  }
}