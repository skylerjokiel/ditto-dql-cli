import { init, Ditto } from '@dittolive/ditto';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

import scenarios from "../scenarios.json"
import benchmarks from "../benchmarks.json"

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

async function getBaseline(ditto: Ditto, hash: string, dittoVersion: string): Promise<BenchmarkBaseline | null> {
  try {
    const result = await ditto.store.execute(
      "SELECT * FROM benchmark_baselines WHERE _id.hash = :hash AND _id.ditto_version = :version",
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
      "SELECT * FROM benchmark_baselines WHERE _id.hash = :hash",
      { hash }
    );
    
    if (result.items.length === 0) return [];
    
    const allBaselines = result.items.map(item => item.value as BenchmarkBaseline);
    const currentParsed = parseVersion(currentVersion);
    
    // Filter out current version and sort by version descending
    const otherVersions = allBaselines
      .filter(baseline => baseline._id.ditto_version !== currentVersion)
      .sort((a, b) => compareVersions(a._id.ditto_version, b._id.ditto_version));
    
    const comparisons: BenchmarkBaseline[] = [];
    
    // Get last 3 patches from same major.minor
    const sameMinorVersions = otherVersions.filter(baseline => {
      const parsed = parseVersion(baseline._id.ditto_version);
      return parsed.major === currentParsed.major && parsed.minor === currentParsed.minor;
    });
    comparisons.push(...sameMinorVersions.slice(0, 3));
    
    // Get 1 latest from previous minor version (same major)
    const previousMinorVersions = otherVersions.filter(baseline => {
      const parsed = parseVersion(baseline._id.ditto_version);
      return parsed.major === currentParsed.major && parsed.minor < currentParsed.minor;
    });
    if (previousMinorVersions.length > 0) {
      comparisons.push(previousMinorVersions[0]);
    }
    
    return comparisons;
  } catch (error) {
    return [];
  }
}

async function saveBaseline(ditto: Ditto, baseline: BenchmarkBaseline): Promise<void> {
  try {
    await ditto.store.execute(
      "INSERT INTO benchmark_baselines DOCUMENTS (:baseline) ON ID CONFLICT DO UPDATE",
      { baseline }
    );
  } catch (error) {
    console.error('Failed to save baseline:', error);
  }
}

async function importMovies(ditto: Ditto) {
  const docName = 'movies.ndjson';
  const filePath = path.join(process.cwd(), docName);
  
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
    type: 'onlinePlayground',
    appID: '28144349-0a59-4136-9490-705a4c14e75a',
    token: '88779f89-4bd4-4b5c-ad19-1aa0a70c4a4b',
    customAuthURL: "https://i83inp.cloud.dittolive.app",
    enableDittoCloudSync: false,
  });

  await ditto.disableSyncWithV3();
  ditto.updateTransportConfig((config) => {
    config.connect.websocketURLs.push('wss://i83inp.cloud.dittolive.app');
  });

  // Uses the new DQL Document Schema mode where type definitions are not required 
  await ditto.store.execute("ALTER SYSTEM SET DQL_STRICT_MODE = false");

  // Restrict `movies` collection to be local only 
  const syncScopes = {
    movies: "LocalPeerOnly"
  };
  await ditto.store.execute(
    "ALTER SYSTEM SET USER_COLLECTION_SYNC_SCOPES = :syncScopes",
    { syncScopes }
  );

  const checkStoreResponse = await ditto.store.execute("SELECT * FROM movies LIMIT 1");
  if (checkStoreResponse.items.length === 0) {
    console.log("Initializing the database with movie records.");
    await importMovies(ditto);
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
      console.log(`  Ditto Directory: ${applyColor(ditto.absolutePersistenceDirectory, 'green')}`);
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
        console.error(`Error on run ${i + 1}:`, error);
        return {
          mean: 0, median: 0, min: 0, max: 0, stdDev: 0, p95: 0, p99: 0, resultCount: 0, times: []
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
    
    // Compare with baselines if requested
    if (compareBaseline) {
      const hash = generateBenchmarkHash(preQueries, query);
      const dittoVersion = await getDittoVersion();
      const comparisonBaselines = await getComparisonBaselines(ditto, hash, dittoVersion);
      
      if (comparisonBaselines.length > 0) {
        console.log(`\n${applyColor(`Version Comparisons (current: v${dittoVersion})`, 'blue')}`);
        console.log(`${applyColor('─'.repeat(50), 'blue')}`);
        
        const formatDiff = (diff: number) => {
          const sign = diff >= 0 ? '+' : '';
          const color = Math.abs(diff) < 5 ? 'green' : Math.abs(diff) < 15 ? 'yellow_highlight' : 'red';
          return applyColor(`${sign}${diff.toFixed(1)}%`, color);
        };
        
        comparisonBaselines.forEach((baseline, index) => {
          const meanDiff = ((mean - baseline.metrics.mean) / baseline.metrics.mean) * 100;
          const versionType = index < 3 ? 'patch' : 'minor';
          console.log(`  vs v${baseline._id.ditto_version} (${versionType}): ${formatDiff(meanDiff)} (${baseline.metrics.mean.toFixed(1)}ms → ${mean.toFixed(1)}ms)`);
        });
      } else {
        // Check if baseline exists for current version
        const currentBaseline = await getBaseline(ditto, hash, dittoVersion);
        if (currentBaseline) {
          console.log(`\n${applyColor(`Baseline Comparison (current: v${dittoVersion})`, 'blue')}`);
          console.log(`${applyColor('─'.repeat(40), 'blue')}`);
          
          const meanDiff = ((mean - currentBaseline.metrics.mean) / currentBaseline.metrics.mean) * 100;
          const formatDiff = (diff: number) => {
            const sign = diff >= 0 ? '+' : '';
            const color = Math.abs(diff) < 5 ? 'green' : Math.abs(diff) < 15 ? 'yellow_highlight' : 'red';
            return applyColor(`${sign}${diff.toFixed(1)}%`, color);
          };
          
          console.log(`  vs v${currentBaseline._id.ditto_version} baseline: ${formatDiff(meanDiff)} (${currentBaseline.metrics.mean.toFixed(1)}ms → ${mean.toFixed(1)}ms)`);
          console.log(`  No other versions available for comparison`);
        } else {
          console.log(`\n${applyColor('No baselines found for comparison', 'yellow_highlight')}`);
          console.log(`Create baselines with '.benchmark_baseline' first`);
        }
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
      console.log('  .system  - Show system information (document counts, indexes)');
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
          
          console.log(`\n${applyColor('Running all benchmarks...', 'blue')}`);
          console.log(`${applyColor(`Runs per benchmark: ${runCount}`, 'blue')}`);
          console.log(`${applyColor('━'.repeat(50), 'blue')}\n`);
          
          for (const benchmarkName of benchmarkKeys) {
            const benchmark = benchmarks[benchmarkName as keyof typeof benchmarks] as Benchmark;
            console.log(`${applyColor(`Running benchmark: ${benchmarkName}`, 'blue')}`);
            
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
            
            // Collect results for summary
            const hash = generateBenchmarkHash(benchmark.preQueries || [], benchmark.query);
            const dittoVersion = await getDittoVersion();
            const comparisonBaselines = await getComparisonBaselines(ditto, hash, dittoVersion);
            const currentBaseline = await getBaseline(ditto, hash, dittoVersion);
            
            let baselineMean: number | undefined;
            let percentChange: number | undefined;
            let hasBaseline = false;
            
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
                console.log(`  Cleanup: ${postQuery}`);
                await ditto.store.execute(postQuery);
              }
            }
            
            console.log(`${applyColor('─'.repeat(50), 'blue')}\n`);
          }
          
          // Generate comprehensive summary
          console.log(`${applyColor('═'.repeat(60), 'blue')}`);
          console.log(`${applyColor('BENCHMARK SUMMARY', 'blue')}`);
          console.log(`${applyColor('═'.repeat(60), 'blue')}\n`);
          
          const formatDiff = (current: number, baseline: number) => {
            const percentDiff = ((current - baseline) / baseline) * 100;
            const absoluteDiff = current - baseline;
            
            // For fast queries (<10ms), show absolute difference; for slow queries, show percentage
            const useAbsolute = baseline < 10;
            const displayValue = useAbsolute ? 
              `${absoluteDiff >= 0 ? '+' : ''}${absoluteDiff.toFixed(1)}ms` :
              `${percentDiff >= 0 ? '+' : ''}${percentDiff.toFixed(1)}%`;
            
            // Color based on performance impact
            let color: 'green' | 'yellow_highlight' | 'red' | 'blue';
            if (useAbsolute) {
              // For absolute differences
              if (Math.abs(absoluteDiff) < 1) {
                color = 'blue'; // No significant change
              } else if (absoluteDiff < 0) {
                color = 'green'; // Improvement (faster)
              } else if (absoluteDiff < 2) {
                color = 'yellow_highlight'; // Small regression
              } else {
                color = 'red'; // Large regression
              }
            } else {
              // For percentage differences
              if (Math.abs(percentDiff) < 5) {
                color = 'blue'; // No significant change
              } else if (percentDiff < 0) {
                color = 'green'; // Improvement (faster)
              } else if (percentDiff < 15) {
                color = 'yellow_highlight'; // Small regression
              } else {
                color = 'red'; // Large regression
              }
            }
            
            return { displayValue: applyColor(displayValue, color), percentDiff, absoluteDiff };
          };
          
          // Sort results: regressions first, then improvements, then no baseline
          const sortedResults = benchmarkResults.sort((a, b) => {
            if (!a.hasBaseline && !b.hasBaseline) return 0;
            if (!a.hasBaseline) return 1;
            if (!b.hasBaseline) return -1;
            return (b.percentChange || 0) - (a.percentChange || 0);
          });
          
          let regressions = 0;
          let improvements = 0;
          let noChange = 0;
          let noBaseline = 0;
          
          console.log(`${applyColor('Performance Changes:', 'blue')}`);
          sortedResults.forEach((result) => {
            if (!result.hasBaseline) {
              console.log(`  ${applyColor('○', 'blue')} ${result.name.padEnd(30)} ${result.mean.toFixed(1)}ms (no baseline)`);
              noBaseline++;
            } else {
              const diffResult = formatDiff(result.mean, result.baselineMean!);
              const isSignificant = (result.baselineMean! < 10) ? 
                Math.abs(diffResult.absoluteDiff) >= 1 : 
                Math.abs(diffResult.percentDiff) >= 5;
              
              const changeIcon = isSignificant ? 
                (diffResult.percentDiff > 0 ? '▲' : '▼') : '─';
              const changeColor = isSignificant ? 
                (diffResult.percentDiff > 0 ? 'red' : 'green') : 'blue';
              
              console.log(`  ${applyColor(changeIcon, changeColor)} ${result.name.padEnd(30)} ${result.mean.toFixed(1)}ms vs ${result.baselineMean?.toFixed(1)}ms (${diffResult.displayValue})`);
              
              if (!isSignificant) {
                noChange++;
              } else if (diffResult.percentDiff > 0) {
                regressions++;
              } else {
                improvements++;
              }
            }
          });
          
          console.log(`\n${applyColor('Summary Statistics:', 'blue')}`);
          console.log(`  Total Benchmarks: ${benchmarkResults.length}`);
          console.log(`  ${applyColor('▲ Regressions:', 'red')} ${regressions} (>1ms or >5% slower)`);
          console.log(`  ${applyColor('▼ Improvements:', 'green')} ${improvements} (>1ms or >5% faster)`);
          console.log(`  ${applyColor('─ No significant change:', 'blue')} ${noChange} (≤1ms or ≤5%)`);
          console.log(`  ${applyColor('○ No baseline:', 'blue')} ${noBaseline}`);
          
          if (regressions > 0) {
            console.log(`\n${applyColor('⚠️  Performance Alert:', 'red')} ${regressions} benchmark(s) showing regression`);
          } else if (improvements > noChange) {
            console.log(`\n${applyColor('✅ Performance Improvement:', 'green')} More improvements than regressions detected`);
          } else {
            console.log(`\n${applyColor('✓ Performance Stable:', 'green')} No significant regressions detected`);
          }
          
          console.log(`${applyColor('═'.repeat(60), 'blue')}\n`);
          console.log(`${applyColor('All benchmarks complete!', 'green')}`);
        }
        else if (input.toLowerCase().startsWith('.benchmark_baseline')) {
          const args = input.split(' ');
          const runCount = args[1] ? parseInt(args[1]) : 50;
          
          if (isNaN(runCount) || runCount < 1) {
            console.log('Run count must be a positive number');
            rl.prompt();
            return;
          }
          
          const benchmarkKeys = Object.keys(benchmarks);
          const dittoVersion = await getDittoVersion();
          let overwritePolicy: 'ask' | 'all' | 'none' = 'ask';
          
          console.log(`\n${applyColor('Creating Baselines for All Benchmarks', 'blue')}`);
          console.log(`${applyColor('━'.repeat(50), 'blue')}`);
          console.log(`Ditto Version: ${dittoVersion}`);
          console.log(`Runs per baseline: ${runCount}\n`);
          
          for (const benchmarkName of benchmarkKeys) {
            const benchmark = benchmarks[benchmarkName as keyof typeof benchmarks] as Benchmark;
            const hash = generateBenchmarkHash(benchmark.preQueries || [], benchmark.query);
            
            console.log(`${applyColor(`Creating baseline: ${benchmarkName}`, 'blue')}`);
            console.log(`Hash: ${hash}`);
            
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
            
            // Run post-queries if they exist
            if (benchmark.postQueries && benchmark.postQueries.length > 0) {
              console.log(`${applyColor('Running cleanup queries...', 'blue')}`);
              for (const postQuery of benchmark.postQueries) {
                console.log(`  Cleanup: ${postQuery}`);
                await ditto.store.execute(postQuery);
              }
            }
            
            console.log(`${applyColor('─'.repeat(50), 'blue')}\n`);
          }
          
          console.log(`${applyColor('All baselines created successfully!', 'green')}`);
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
        else if (input.toLowerCase() === '.system') {
          await showSystemInfo();
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