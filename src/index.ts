import { init, Ditto } from '@dittolive/ditto';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

import scenarios from "../scenarios.json"

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

async function main() {
  await init();

  const executeDql = async (query:string) => {
    const start = Date.now();
    const result = await ditto.store.execute(query);
    const elapsed = Date.now() - start;
    console.log(`execute-time: ${applyColor(elapsed.toString() + 'ms', 'yellow_highlight')}`);
    console.log(`Result Count: ${result.items.length}\n`);
    
    // If it's an explain or profile we'll log it.
    const qLower = query.toLowerCase();
    if (qLower.startsWith('explain') || qLower.startsWith('profile')) {
      console.log(JSON.stringify(result.items[0].value,null, 2));
    }
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
      console.log('  .exit    - Exit the DQL terminal');
      console.log('\nDQL queries:');
      console.log('  - Enter any valid DQL query to execute');
      console.log('  - Queries starting with EXPLAIN will show execution plan');
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
          
          console.log(`\nRunning scenario: ${scenarioName}`);
          for (let index = 0; index < scenario.length; index++) {
            const query = scenario[index];
            console.log(applyColor(`Executing: ${index + 1}/${scenario.length}`, 'blue'));
            console.log(`Query: ${applyColor(query, 'green')}`);
            await executeDql(query);
          }
        }
        else {
          await executeDql(input);
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