import 'dotenv/config';
import { BabylonClient } from './src/clients/BabylonClient';
import { Network } from './src/types/finality';

async function main() {
    // Create an instance and use it
    const client = BabylonClient.getInstance(Network.TESTNET); // or Network.TESTNET depending on your needs
    
    const currentHeight = await client.getCurrentHeight();
    console.log(currentHeight);
}

main().catch(console.error);