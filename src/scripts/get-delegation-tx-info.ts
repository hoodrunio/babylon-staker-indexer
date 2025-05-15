import axios from 'axios';
import { config } from 'dotenv';

config();

/**
 * Fetches the txHash and blockHeight for a staker's MsgCreateBTCDelegation transaction
 * @param stakerAddr - The staker's address (bbn1...)
 * @returns Object containing txHash and blockHeight
 */
async function getDelegationTxInfo(stakerAddr: string): Promise<{ txHash: string; blockHeight: number } | null> {
  try {
    // Get the node API URL from environment or use a default
    const apiUrl = process.env.BABYLON_API_URL || 'https://babylon.nodes.guru/api';
    
    // Build the query with the proper format for Cosmos SDK v0.50.x
    const query = `message.action='%2Fbabylon.btcstaking.v1.MsgCreateBTCDelegation' AND message.sender='${stakerAddr}'`;
    
    // Make the request to get the latest transaction
    const response = await axios.get(`${apiUrl}/cosmos/tx/v1beta1/txs`, {
      params: {
        query,
        'pagination.limit': 1,
        order_by: 'ORDER_BY_DESC'
      }
    });

    // Check if any transactions were found
    if (!response.data.tx_responses || response.data.tx_responses.length === 0) {
      console.log(`No delegation transactions found for staker: ${stakerAddr}`);
      return null;
    }

    // Extract txHash and blockHeight from the response
    const txResponse = response.data.tx_responses[0];
    const txHash = txResponse.txhash;
    const blockHeight = parseInt(txResponse.height, 10);

    console.log(`Found delegation transaction for staker ${stakerAddr}:`);
    console.log(`TxHash: ${txHash}`);
    console.log(`Block Height: ${blockHeight}`);

    return {
      txHash,
      blockHeight
    };
  } catch (error) {
    console.error('Error fetching delegation transaction info:');
    console.error(error);
    return null;
  }
}

/**
 * Main function to run the script from command line
 */
async function main() {
  // Get staker address from command line args
  const stakerAddr = process.argv[2];
  
  if (!stakerAddr) {
    console.error('Please provide a staker address as a command line argument');
    console.error('Usage: npx ts-node src/scripts/get-delegation-tx-info.ts <staker_address>');
    process.exit(1);
  }

  const result = await getDelegationTxInfo(stakerAddr);
  
  if (!result) {
    process.exit(1);
  }
  
  // Output in a format that can be easily parsed by other scripts
  console.log(JSON.stringify(result));
}

// Run the script if it's being executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:');
    console.error(error);
    process.exit(1);
  });
}

// Export the function for use in other modules
export { getDelegationTxInfo }; 