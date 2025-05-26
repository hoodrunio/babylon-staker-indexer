#!/usr/bin/env ts-node

import { IBCPacketCleaner } from './IBCPacketCleaner';
import { ChainConfigService } from './ChainConfigService';
import { TimeoutPacketRequest } from './types';

/**
 * Example usage of IBC Packet Cleaner
 * 
 * Required environment variables:
 * - IBC_CLEANER_MNEMONIC: Your wallet mnemonic (24 words)
 * - BABYLON_RPC_URL: Babylon RPC endpoint
 * - COSMOS_RPC_URL: Cosmos Hub RPC endpoint (or other destination chain)
 */

async function exampleUsage() {
  console.log('🚀 IBC Packet Cleaner Example Usage\n');

  // Initialize the packet cleaner
  const packetCleaner = new IBCPacketCleaner();
  
  // Example request to clear packets from Babylon to Cosmos Hub
  const request: TimeoutPacketRequest = {
    channel_id: 'channel-0',           // IBC channel ID
    port_id: 'transfer',               // Usually 'transfer' for token transfers
    source_chain_id: 'bbn-1',          // Babylon mainnet
    destination_chain_id: 'cosmoshub-4' // Cosmos Hub
  };

  console.log('📋 Request Details:');
  console.log(`   Channel: ${request.channel_id}`);
  console.log(`   Port: ${request.port_id}`);
  console.log(`   Source: ${request.source_chain_id}`);
  console.log(`   Destination: ${request.destination_chain_id}\n`);

  try {
    console.log('🔍 Scanning for timed-out packets...');
    
    // Execute packet clearing
    const result = await packetCleaner.clearTimedOutPackets(request);
    
    console.log('\n✅ Operation completed!');
    console.log(`   Success: ${result.success}`);
    console.log(`   Message: ${result.message}`);
    console.log(`   Cleared packets: ${result.cleared_packets}`);
    
    if (result.transaction_hashes.length > 0) {
      console.log('\n📝 Transaction Hashes:');
      result.transaction_hashes.forEach((hash, index) => {
        console.log(`   ${index + 1}. ${hash}`);
      });
    }
    
    if (result.errors.length > 0) {
      console.log('\n❌ Errors:');
      result.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

  } catch (error: any) {
    console.error('\n💥 Error occurred:', error.message);
    console.error('Full error:', error);
  }
}

async function showSupportedChains() {
  console.log('\n🌐 Supported Chains:');
  
  const chainConfig = ChainConfigService.getInstance();
  const chainIds = chainConfig.getAllChainIds();
  
  chainIds.forEach((chainId, index) => {
    const config = chainConfig.getChainConfig(chainId);
    console.log(`   ${index + 1}. ${config?.chain_id} (${chainId})`);
    console.log(`      RPC: ${config?.rpc_url}`);
    console.log(`      Prefix: ${config?.prefix}\n`);
  });
}

// Main execution
async function main() {
  console.log('🔧 Environment Check:');
  console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Mnemonic provided: ${process.env.IBC_CLEANER_MNEMONIC ? '✅ Yes' : '❌ No'}`);
  console.log(`   Signer address: ${process.env.IBC_CLEANER_SIGNER_ADDRESS || 'Will be derived from mnemonic'}\n`);

  await showSupportedChains();
  await exampleUsage();
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { main as runExample }; 