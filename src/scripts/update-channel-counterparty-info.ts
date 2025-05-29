// scripts/update-channel-counterparty-info.ts
import mongoose from 'mongoose';
import { Network } from '../types/finality';
import IBCChannelModel from '../database/models/ibc/IBCChannel';
import IBCConnectionModel from '../database/models/ibc/IBCConnection';
import IBCClientModel from '../database/models/ibc/IBCClient';
import { getChainName } from '../services/ibc/constants/chainMapping';
import { config } from 'dotenv';

// Load environment variables
config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/babylon-staker-indexer');

async function updateChannelCounterpartyInfo(network: Network) {
  console.log(`Updating channel counterparty info for ${network} network...`);
  
  // Get all channels
  const channels = await IBCChannelModel.find({ network: network.toString() });
  console.log(`Found ${channels.length} channels`);
  
  for (const channel of channels) {
    try {
      // Get connection using connection_id
      if (!channel.connection_id) {
        console.log(`No connection_id for channel ${channel.channel_id}`);
        continue;
      }
      
      const connection = await IBCConnectionModel.findOne({
        connection_id: channel.connection_id,
        network: network.toString()
      });
      
      if (!connection || !connection.client_id) {
        console.log(`No connection or client_id found for connection ${channel.connection_id}`);
        continue;
      }
      
      // Get client using client_id
      const client = await IBCClientModel.findOne({
        client_id: connection.client_id,
        network: network.toString()
      });
      
      if (!client || !client.chain_id) {
        console.log(`No client or chain_id found for client ${connection.client_id}`);
        continue;
      }
      
      // Update channel with counterparty chain info
      const counterpartyChainId = client.chain_id;
      const counterpartyChainName = getChainName(counterpartyChainId);
      
      await IBCChannelModel.updateOne(
        { _id: channel._id },
        { 
          counterparty_chain_id: counterpartyChainId,
          counterparty_chain_name: counterpartyChainName
        }
      );
      
      console.log(`Updated channel ${channel.channel_id} with counterparty chain ${counterpartyChainId} (${counterpartyChainName})`);
    } catch (error) {
      console.error(`Error updating channel ${channel.channel_id}:`, error);
    }
  }
  
  console.log(`Finished updating channel counterparty info for ${network} network`);
}

// Run the update for both networks
async function main() {
  await updateChannelCounterpartyInfo(Network.MAINNET);
  await updateChannelCounterpartyInfo(Network.TESTNET);
  mongoose.disconnect();
}

main().catch(console.error);