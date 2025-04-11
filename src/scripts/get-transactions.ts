import axios from 'axios';
import { decodeTx } from '../services/decoders/transaction';

// RPC endpoint (can be modified by the user)
const DEFAULT_RPC_ENDPOINT = 'https://babylon-testnet-rpc-pruned-1.nodes.guru';

/**
 * Retrieves all transactions for a specific block height
 * @param height Block height
 * @param rpcEndpoint Optional RPC endpoint
 * @returns List of transactions or null in case of error
 */
async function getTxsByHeight(height: number, rpcEndpoint: string = DEFAULT_RPC_ENDPOINT): Promise<any[] | null> {
  try {
    console.log(`Retrieving transactions for block height ${height}...`);
    
    // Get transactions by block height using tx_search
    const response = await axios.get(`${rpcEndpoint}/tx_search?query="tx.height=${height}"&prove=false&page=1&per_page=100`);
    
    if (response.data?.result?.txs && response.data.result.txs.length > 0) {
      const txs = response.data.result.txs;
      console.log(`${txs.length} transactions found.`);
      
      // Return transactions with hash and tx info
      return txs.map((tx: any) => ({
        height: parseInt(tx.height, 10),
        hash: tx.hash,
        tx: tx.tx
      }));
    } else {
      console.log('No transactions found in this block.');
      return [];
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error occurred while retrieving transactions: ${errorMessage}`);
    return null;
  }
}

/**
 * Gets a transaction by its hash
 * @param hash Transaction hash
 * @param rpcEndpoint Optional RPC endpoint
 * @returns Transaction data or null in case of error
 */
async function getTxByHash(hash: string, rpcEndpoint: string = DEFAULT_RPC_ENDPOINT): Promise<any | null> {
  try {
    console.log(`Retrieving transaction with hash ${hash}...`);
    
    const response = await axios.get(`${rpcEndpoint}/tx?hash=0x${hash}`);
    
    if (response.data?.result?.tx) {
      console.log('Transaction retrieved successfully.');
      return {
        height: response.data.result.height,
        hash: hash,
        tx: response.data.result.tx
      };
    } else {
      console.log('Transaction not found.');
      return null;
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error occurred while retrieving transaction: ${errorMessage}`);
    return null;
  }
}

/**
 * Retrieves and decodes all transactions for a specific block height
 * @param height Block height
 * @param rpcEndpoint Optional RPC endpoint
 * @returns List of decoded transactions
 */
async function decodeBlockTransactions(height: number, rpcEndpoint: string = DEFAULT_RPC_ENDPOINT): Promise<any[]> {
  const txs = await getTxsByHeight(height, rpcEndpoint);
  
  if (!txs || txs.length === 0) {
    return [];
  }
  
  console.log(`${txs.length} transactions are being decoded...`);
  
  const decodedTxs = [];
  
  for (const tx of txs) {
    try {
      const decoded = decodeTx(tx.tx);
      decodedTxs.push({
        height: tx.height,
        hash: tx.hash,
        decoded
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error occurred while decoding transaction with hash ${tx.hash}: ${errorMessage}`);
      
      decodedTxs.push({
        height: tx.height,
        hash: tx.hash,
        error: `Decode error: ${errorMessage}`
      });
    }
  }
  
  return decodedTxs;
}

/**
 * Retrieves and decodes a transaction by its hash
 * @param hash Transaction hash
 * @param rpcEndpoint Optional RPC endpoint
 * @returns Decoded transaction
 */
async function decodeTxByHash(hash: string, rpcEndpoint: string = DEFAULT_RPC_ENDPOINT): Promise<any | null> {
  const tx = await getTxByHash(hash, rpcEndpoint);
  
  if (!tx) {
    return null;
  }
  
  try {
    const decoded = decodeTx(tx.tx);
    return {
      height: tx.height,
      hash: tx.hash,
      decoded
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error occurred while decoding transaction: ${errorMessage}`);
    
    return {
      height: tx.height,
      hash: tx.hash,
      error: `Decode error: ${errorMessage}`
    };
  }
}

/**
 * Main function - retrieves transactions based on arguments
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  npm run get-tx -- --height <block_height>');
    console.log('  npm run get-tx -- --hash <transaction_hash>');
    return;
  }
  
  const option = args[0];
  const value = args[1];
  
  let result = null;
  
  if (option === '--height' && value) {
    const height = parseInt(value, 10);
    
    if (isNaN(height)) {
      console.error('Invalid block height.');
      return;
    }
    
    result = await decodeBlockTransactions(height);
  } else if (option === '--hash' && value) {
    // Remove 0x prefix if present
    const hash = value.startsWith('0x') ? value.substring(2) : value;
    result = await decodeTxByHash(hash);
  } else {
    console.error('Invalid arguments.');
    console.log('Usage:');
    console.log('  npm run get-tx -- --height <block_height>');
    console.log('  npm run get-tx -- --hash <transaction_hash>');
    return;
  }
  
  // Show results
  console.log(JSON.stringify(result, null, 2));
}

// Start the application
main().catch(error => {
  console.error('Unexpected error occurred:', error);
  process.exit(1);
});