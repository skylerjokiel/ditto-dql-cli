import { init, Ditto } from '@dittolive/ditto';
import * as readline from 'readline';

async function main() {
  try {
    await init();
    
    const ditto = new Ditto({
      type: 'onlinePlayground',
      appID: '28144349-0a59-4136-9490-705a4c14e75a',
      token: '88779f89-4bd4-4b5c-ad19-1aa0a70c4a4b',
      customAuthURL: "https://i83inp.cloud.dittolive.app",
      enableDittoCloudSync: false, // This is required to be set to false to use the correct URLs
    });

    ditto.updateTransportConfig((config) => {
      config.connect.websocketURLs.push(
        'wss://i83inp.cloud.dittolive.app'
      );
    });

    // await ditto.startSync();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'DQL> '
    });

    console.log('Ditto DQL Terminal');
    console.log('Type "exit" to quit\n');

    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();
      
      if (input.toLowerCase() === 'exit') {
        rl.close();
        return;
      }

      if (input) {
        try {
          const result = await ditto.store.execute(input);
          console.log(JSON.stringify(result, null, 2));
        } catch (error) {
          console.error('Error executing DQL:', error);
        }
      }

      rl.prompt();
    });

    rl.on('close', () => {
      console.log('\nGoodbye!');
      ditto.stopSync();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to initialize Ditto:', error);
    process.exit(1);
  }
}

main();