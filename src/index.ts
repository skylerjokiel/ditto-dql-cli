import { init, Ditto } from '@dittolive/ditto';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

import scenarios from "../scenarios.json"

type ScenarioQuery = string | {
  query: string;
  expectedCount?: number;
  expectedIndex?: string | 'full_scan';
  maxExecutionTime?: number; // in milliseconds
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
    const countResult = await ditto.store.execute(`SELECT COUNT(*) as count FROM movies`);
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
  await ditto.store.execute("ALTER SYSTEM SET DQL_STRICT_MODE = false");

  const checkStoreResponse = await ditto.store.execute("SELECT * FROM movies LIMIT 1");
  if (checkStoreResponse.items.length === 0) {
    console.log("Initializing the database with movie records.");
    await importMovies(ditto);
  }

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

  const benchmarkQuery = async (query: string, count: number = 20) => {
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
        return;
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
    console.log(`${applyColor('═'.repeat(50), 'blue')}\n`);
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
          
          await benchmarkQuery(query, 20);
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