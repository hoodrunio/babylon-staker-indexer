import 'dotenv/config';
import { BabylonClient } from './src/clients/BabylonClient';
import { Network } from './src/types/finality';
import { logger } from './src/utils/logger';

async function main() {
    // Create an instance and use it
    const client = BabylonClient.getInstance(Network.TESTNET); // or Network.TESTNET depending on your needs
    
    const currentHeight = await client.getCurrentHeight();
    logger.info(currentHeight);
}

main().catch(logger.error);