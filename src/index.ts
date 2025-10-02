import { init, Ditto, QueryResult, QueryResultItem } from '@dittolive/ditto';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'DQL> '
  });

  console.log('Ditto DQL Terminal');
  console.log('Type "exit" to quit');
  console.log('Type ".import movies" to import movies dataset\n');

  let awaitingSubPrompt = false;
  let lastResult: QueryResult<any> | undefined;

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (input.toLowerCase() === 'exit') {
      rl.close();
      return;
    }

    if (awaitingSubPrompt) {
      if (input.toLowerCase() === 'y' && lastResult) {
        lastResult.items.forEach((item: QueryResultItem<any>) =>
          console.log(JSON.stringify(item.value))
        );
      }
      awaitingSubPrompt = false;
      lastResult = undefined;
      rl.prompt();
      return;
    }

    if (input) {
      try {
        if (input.toLowerCase() === '.import movies') {
          await importMovies(ditto);
        } else {
          console.time("execute");
          const result = await ditto.store.execute(input);
          console.timeEnd("execute");
          console.log(`Result Count: ${result.items.length}`);

          console.log('Print full results (y/n) (default n)');
          awaitingSubPrompt = true;
          lastResult = result;
          return;
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