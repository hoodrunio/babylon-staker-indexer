import { getDelegationTxInfo } from './get-delegation-tx-info';

/**
 * Example function that shows how to integrate the getDelegationTxInfo with the existing
 * createDelegationFromChainData implementation to complete the missing txHash and blockHeight.
 * 
 * Note: This is a demonstration and should be adjusted to your actual implementation.
 */
async function completeDelegationData(stakerAddr: string, delegationData: any): Promise<any> {
  try {
    // First, check if the delegationData already has the txHash and blockHeight
    if (delegationData.txHash && delegationData.blockHeight) {
      console.log('Delegation data already complete with txHash and blockHeight');
      return delegationData;
    }

    // If not, fetch the missing txHash and blockHeight using our utility
    const txInfo = await getDelegationTxInfo(stakerAddr);
    
    if (!txInfo) {
      throw new Error(`Could not find transaction info for staker: ${stakerAddr}`);
    }

    // Add the txHash and blockHeight to the delegation data
    const completeData = {
      ...delegationData,
      txHash: txInfo.txHash,
      blockHeight: txInfo.blockHeight
    };

    console.log('Delegation data completed with txHash and blockHeight:');
    console.log(`txHash: ${txInfo.txHash}`);
    console.log(`blockHeight: ${txInfo.blockHeight}`);

    return completeData;
  } catch (error) {
    console.error('Error completing delegation data:');
    console.error(error);
    throw error;
  }
}

/**
 * Main function to demonstrate usage
 */
async function main() {
  // Get staker address from command line args
  const stakerAddr = process.argv[2];
  
  if (!stakerAddr) {
    console.error('Please provide a staker address as a command line argument');
    console.error('Usage: npx ts-node src/scripts/complete-delegation-data.ts <staker_address>');
    process.exit(1);
  }

  try {
    // Mock example: In a real scenario, this would be the data from createDelegationFromChainData
    const mockDelegationData = {
      stakerAddr,
      delegationType: 'btc',
      status: 'pending',
      // Note: txHash and blockHeight are missing!
    };

    // Complete the delegation data with txHash and blockHeight
    const completeData = await completeDelegationData(stakerAddr, mockDelegationData);
    
    console.log('Complete delegation data:');
    console.log(JSON.stringify(completeData, null, 2));
  } catch (error) {
    console.error('Error in demo:');
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

export { completeDelegationData }; 