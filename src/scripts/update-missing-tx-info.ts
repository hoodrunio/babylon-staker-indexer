import axios from 'axios';
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config();

// Database configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/babylon_indexer';
const STAKERS_COLLECTION = process.env.STAKERS_COLLECTION || 'new_btc_delegations';

// API configuration
const BABYLON_API_URL = process.env.BABYLON_API_URL || 'https://babylon.nodes.guru/api';

/**
 * Fetches transaction information for a staker address and matches with staking_tx_hex
 * @param stakerAddr - The Babylon staker address (bbn1...)
 * @param stakingTxHex - The hex encoding of the staking transaction to match
 * @returns Object containing txHash and blockHeight if found
 */
async function fetchTxInfoByStakerAddrAndStakingTx(stakerAddr: string, stakingTxHex: string): Promise<{ txHash: string; blockHeight: number } | null> {
  try {
    // Build the query URL directly with proper encoding
    // Using the working curl example as reference
    const baseUrl = `${BABYLON_API_URL}/cosmos/tx/v1beta1/txs`;
    
    // Create the query string with proper encoding
    const queryStr = `message.action%3D%27%2Fbabylon.btcstaking.v1.MsgCreateBTCDelegation%27%20AND%20message.sender%3D%27${stakerAddr}%27`;
    
    // Request a larger number of transactions to ensure we find the matching one
    const url = `${baseUrl}?query=${queryStr}&pagination.limit=100&order_by=ORDER_BY_DESC`;
    
    console.log(`Querying URL: ${url}`);
    
    const response = await axios.get(url);

    // Check if any transactions were found
    if (!response.data.tx_responses || response.data.tx_responses.length === 0) {
      console.log(`No delegation transactions found for staker: ${stakerAddr}`);
      return null;
    }

    console.log(`Found ${response.data.tx_responses.length} transactions for staker ${stakerAddr}`);
    
    // Look through all transactions to find the one with matching stakingTxHex
    for (const txResponse of response.data.tx_responses) {
      try {
        // Extract messages from the transaction
        const messages = txResponse.tx.body.messages;
        
        // Check if there's a matching message in this transaction
        for (const msg of messages) {
          if (msg['@type'] === '/babylon.btcstaking.v1.MsgCreateBTCDelegation' && msg.staking_tx === stakingTxHex) {
            // Found a match in the message
            console.log(`Found matching transaction for stakingTxHex in message: ${stakingTxHex.substring(0, 20)}...`);
            
            const txHash = txResponse.txhash;
            const blockHeight = parseInt(txResponse.height, 10);
            
            console.log(`TxHash: ${txHash}`);
            console.log(`Block Height: ${blockHeight}`);
            
            return {
              txHash,
              blockHeight
            };
          }
        }
        
        // If not found in messages, check in the events
        if (txResponse.events) {
          for (const event of txResponse.events) {
            if (event.type === 'babylon.btcstaking.v1.EventBTCDelegationCreated') {
              for (const attribute of event.attributes) {
                if (attribute.key === 'staking_tx_hex') {
                  // Remove quotes from the value if present (the event value may be JSON stringified)
                  const attrValue = attribute.value.replace(/^"|"$/g, '');
                  
                  if (attrValue === stakingTxHex) {
                    console.log(`Found matching transaction for stakingTxHex in event: ${stakingTxHex.substring(0, 20)}...`);
                    
                    const txHash = txResponse.txhash;
                    const blockHeight = parseInt(txResponse.height, 10);
                    
                    console.log(`TxHash: ${txHash}`);
                    console.log(`Block Height: ${blockHeight}`);
                    
                    return {
                      txHash,
                      blockHeight
                    };
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.log(`Error processing transaction: ${err}`);
        // Continue with next transaction
      }
    }
    
    // If we get here, we need to try another approach - look for matching staker address and other fields
    console.log(`No exact match found, trying secondary approach...`);
    
    // If there's only one transaction, it's likely the one we want
    if (response.data.tx_responses.length === 1) {
      const txResponse = response.data.tx_responses[0];
      const txHash = txResponse.txhash;
      const blockHeight = parseInt(txResponse.height, 10);
      
      console.log(`Using the only available transaction:`);
      console.log(`TxHash: ${txHash}`);
      console.log(`Block Height: ${blockHeight}`);
      
      return {
        txHash,
        blockHeight
      };
    }
    
    console.log(`Could not find a transaction matching stakingTxHex for staker: ${stakerAddr}`);
    return null;
  } catch (error) {
    console.error(`Error fetching transaction info for staker ${stakerAddr}:`);
    console.error(error);
    return null;
  }
}

/**
 * Updates staking documents that have missing or invalid txHash values
 * @param specificStakerAddress - Optional staker address to update only a specific record
 */
async function updateMissingTxInfo(specificStakerAddress?: string): Promise<void> {
  let client: MongoClient | null = null;

  try {
    // Connect to MongoDB using the URI which already contains the database name
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('Connected to MongoDB');

    // Get database from connection string
    const db = client.db();
    const stakersCollection = db.collection(STAKERS_COLLECTION);

    // Create query based on whether a specific staker address was provided
    let query: any = {
      $or: [
        { txHash: { $exists: false } },
        { txHash: null },
        { txHash: "" },
        { txHash: /^[a-z0-9]*$/ } // This matches invalid txHash (only lowercase and numbers)
      ],
      stakingTxHex: { $exists: true, $ne: null } // Must have a valid stakingTxHex
    };

    // If a specific staker address was provided, add it to the query
    if (specificStakerAddress) {
      query.stakerAddress = specificStakerAddress;
      console.log(`Looking for records with staker address: ${specificStakerAddress}`);
    } else {
      // Only require stakerAddress field if we're processing all records
      query.stakerAddress = { $exists: true, $ne: null };
    }

    const stakingDocsToUpdate = await stakersCollection.find(query).toArray();

    console.log(`Found ${stakingDocsToUpdate.length} staking documents with missing or invalid txHash`);
    
    if (stakingDocsToUpdate.length === 0) {
      console.log('No documents found to update. Exiting...');
      return;
    }

    let updatedCount = 0;
    let errorCount = 0;

    // Process each document
    for (const doc of stakingDocsToUpdate) {
      try {
        // Skip if no stakerAddress or stakingTxHex
        if (!doc.stakerAddress) {
          console.log(`Document ID ${doc._id} has no stakerAddress, skipping...`);
          errorCount++;
          continue;
        }
        
        if (!doc.stakingTxHex) {
          console.log(`Document ID ${doc._id} has no stakingTxHex, skipping...`);
          errorCount++;
          continue;
        }

        console.log(`Processing document ID: ${doc._id} for staker: ${doc.stakerAddress}`);
        console.log(`StakingTxHex: ${doc.stakingTxHex.substring(0, 20)}...`);
        
        // Fetch transaction info using stakerAddress and stakingTxHex
        const txInfo = await fetchTxInfoByStakerAddrAndStakingTx(doc.stakerAddress, doc.stakingTxHex);
        
        if (!txInfo) {
          console.log(`Could not find matching transaction info for document ID: ${doc._id}`);
          errorCount++;
          continue;
        }

        // Update the document with txHash and blockHeight
        const updateResult = await stakersCollection.updateOne(
          { _id: doc._id },
          {
            $set: {
              txHash: txInfo.txHash,
              blockHeight: txInfo.blockHeight
            }
          }
        );

        if (updateResult.modifiedCount > 0) {
          console.log(`Updated document ID: ${doc._id} with txHash: ${txInfo.txHash} and blockHeight: ${txInfo.blockHeight}`);
          updatedCount++;
        } else {
          console.log(`Failed to update document ID: ${doc._id}`);
          errorCount++;
        }
      } catch (docError) {
        console.error(`Error processing document ID: ${doc._id}`);
        console.error(docError);
        errorCount++;
      }
    }

    console.log(`=== Summary ===`);
    console.log(`Total documents processed: ${stakingDocsToUpdate.length}`);
    console.log(`Successfully updated: ${updatedCount}`);
    console.log(`Errors/Skipped: ${errorCount}`);

  } catch (error) {
    console.error('Error updating missing transaction info:');
    console.error(error);
  } finally {
    // Close the MongoDB connection
    if (client) {
      await client.close();
      console.log('MongoDB connection closed');
    }
  }
}

/**
 * Main function to run the script
 */
async function main() {
  try {
    // Get staker address from command line arguments if provided
    const stakerAddress = process.argv[2];
    
    if (stakerAddress) {
      console.log(`Running in single staker mode for address: ${stakerAddress}`);
      
      // Validate staker address format
      if (!stakerAddress.startsWith('bbn1')) {
        console.error('Error: Invalid staker address format. Address should start with "bbn1"');
        process.exit(1);
      }
      
      await updateMissingTxInfo(stakerAddress);
    } else {
      console.log('Running in batch mode for all documents with missing txHash');
      await updateMissingTxInfo();
    }
    
    console.log('Script completed successfully');
  } catch (error) {
    console.error('Unhandled error:');
    console.error(error);
    process.exit(1);
  }
}

// Run the script if it's being executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:');
    console.error(error);
    process.exit(1);
  });
}

export { updateMissingTxInfo, fetchTxInfoByStakerAddrAndStakingTx }; 