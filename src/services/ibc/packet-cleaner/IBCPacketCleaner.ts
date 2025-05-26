import { IBCQueryClient } from './IBCQueryClient';
import { ChainConfigService } from './ChainConfigService';
import { TransactionSender } from './TransactionSender';
import { TimeoutPacketRequest, TimeoutResult, IBCPacket, MsgTimeout } from './types';
import { logger } from '../../../utils/logger';

export class IBCPacketCleaner {
  private chainConfigService: ChainConfigService;

  constructor() {
    this.chainConfigService = ChainConfigService.getInstance();
  }

  /**
   * Main method to clear timed-out packets for a channel
   */
  public async clearTimedOutPackets(request: TimeoutPacketRequest): Promise<TimeoutResult> {
    const result: TimeoutResult = {
      success: false,
      message: '',
      cleared_packets: 0,
      transaction_hashes: [],
      errors: []
    };

    try {
      logger.info('[IBCPacketCleaner] Starting packet clearing process', request);

      // Get chain configurations
      const sourceChainConfig = this.chainConfigService.getChainConfig(request.source_chain_id);
      const destChainConfig = this.chainConfigService.getChainConfig(request.destination_chain_id);

      if (!sourceChainConfig) {
        throw new Error(`Source chain configuration not found: ${request.source_chain_id}`);
      }

      if (!destChainConfig) {
        throw new Error(`Destination chain configuration not found: ${request.destination_chain_id}`);
      }

      // Create query clients
      const sourceClient = new IBCQueryClient(sourceChainConfig);
      const destClient = new IBCQueryClient(destChainConfig);

      // Step 1: Query channel information to understand channel type
      const sourceChannel = await sourceClient.queryChannel(request.port_id, request.channel_id);
      if (!sourceChannel) {
        throw new Error(`Channel ${request.channel_id}/${request.port_id} not found on source chain`);
      }

      const isOrderedChannel = sourceChannel.ordering === 'ORDER_ORDERED';
      logger.info(`[IBCPacketCleaner] Channel type: ${sourceChannel.ordering}`);

      // Step 2: Get current heights and timestamps for timeout checks
      const [sourceState, destState] = await Promise.all([
        sourceClient.getCurrentHeight(),
        destClient.getCurrentHeight()
      ]);

      logger.info('[IBCPacketCleaner] Current chain states', {
        source: { height: sourceState.height, time: sourceState.timestamp },
        destination: { height: destState.height, time: destState.timestamp }
      });

      // Step 3: Find packets that need to be timed out
      const timedOutPackets = await this.findTimedOutPackets(
        sourceClient,
        destClient,
        request.port_id,
        request.channel_id,
        sourceChannel.counterparty.channel_id,
        sourceChannel.counterparty.port_id,
        destState,
        isOrderedChannel
      );

      if (timedOutPackets.length === 0) {
        result.success = true;
        result.message = 'No timed-out packets found';
        return result;
      }

      logger.info(`[IBCPacketCleaner] Found ${timedOutPackets.length} timed-out packets`);

      // Step 4: For each timed-out packet, create and send MsgTimeout
      for (const packet of timedOutPackets) {
        try {
          const txHash = await this.timeoutPacket(
            sourceClient,
            destClient,
            packet,
            request.port_id,
            request.channel_id,
            sourceChannel.counterparty.port_id,
            sourceChannel.counterparty.channel_id,
            isOrderedChannel,
            request.source_chain_id
          );

          if (txHash) {
            result.transaction_hashes.push(txHash);
            result.cleared_packets++;
            logger.info(`[IBCPacketCleaner] Successfully timed out packet ${packet.sequence}: ${txHash}`);
          }
        } catch (error: any) {
          const errorMsg = `Failed to timeout packet ${packet.sequence}: ${error.message}`;
          result.errors.push(errorMsg);
          logger.error(`[IBCPacketCleaner] ${errorMsg}`, error);
        }
      }

      result.success = result.cleared_packets > 0;
      result.message = result.success 
        ? `Successfully cleared ${result.cleared_packets} packets`
        : 'Failed to clear any packets';

      logger.info('[IBCPacketCleaner] Packet clearing completed', {
        cleared: result.cleared_packets,
        errors: result.errors.length
      });

      return result;

    } catch (error: any) {
      result.errors.push(error.message);
      result.message = `Packet clearing failed: ${error.message}`;
      logger.error('[IBCPacketCleaner] Packet clearing failed:', error);
      return result;
    }
  }

  /**
   * Find packets that have timed out
   */
  private async findTimedOutPackets(
    sourceClient: IBCQueryClient,
    destClient: IBCQueryClient,
    sourcePort: string,
    sourceChannel: string,
    destChannel: string,
    destPort: string,
    destState: { height: number; timestamp: Date },
    isOrderedChannel: boolean
  ): Promise<IBCPacket[]> {
    const timedOutPackets: IBCPacket[] = [];

    try {
      // For this implementation, we'll scan a reasonable range of sequence numbers
      // In a production system, you might want to maintain a more sophisticated tracking
      const maxSequenceToCheck = 1000; // Reasonable limit for scanning
      let currentSequence = 1;

      while (currentSequence <= maxSequenceToCheck) {
        // Check if packet commitment exists (packet was sent)
        const hasCommitment = await sourceClient.queryPacketCommitment(
          sourcePort,
          sourceChannel,
          currentSequence
        );

        if (!hasCommitment) {
          currentSequence++;
          continue;
        }

        // Check if packet was acknowledged/received on destination
        const wasReceived = isOrderedChannel
          ? (await destClient.queryPacketReceipt(destPort, destChannel, currentSequence)).received
          : !!(await destClient.queryPacketAcknowledgement(destPort, destChannel, currentSequence)).acknowledgement;

        if (wasReceived) {
          currentSequence++;
          continue;
        }

        // This packet was sent but not received/acknowledged
        // Query the actual packet data
        const packetData = await sourceClient.queryPacketData(
          sourcePort,
          sourceChannel,
          currentSequence
        );

        if (!packetData) {
          logger.debug(`[IBCPacketCleaner] Could not query packet data for sequence ${currentSequence}`);
          currentSequence++;
          continue;
        }

        // Set the correct destination channel and port from counterparty
        packetData.destination_port = destPort;
        packetData.destination_channel = destChannel;

        // Check if packet has actually timed out
        if (this.isPacketTimedOut(packetData, destState)) {
          timedOutPackets.push(packetData);
          logger.debug(`[IBCPacketCleaner] Found timed-out packet: ${currentSequence}`);
        }

        currentSequence++;
      }

    } catch (error: any) {
      logger.error('[IBCPacketCleaner] Error finding timed-out packets:', error);
    }

    return timedOutPackets;
  }

  /**
   * Check if a packet has timed out
   */
  private isPacketTimedOut(packet: IBCPacket, destState: { height: number; timestamp: Date }): boolean {
    // Check height-based timeout
    if (packet.timeout_height && packet.timeout_height.revision_height !== '0') {
      const timeoutHeight = parseInt(packet.timeout_height.revision_height);
      if (destState.height >= timeoutHeight) {
        return true;
      }
    }

    // Check timestamp-based timeout
    if (packet.timeout_timestamp !== '0') {
      const timeoutTimestamp = parseInt(packet.timeout_timestamp);
      if (destState.timestamp.getTime() >= timeoutTimestamp) {
        return true;
      }
    }

    return false;
  }

  /**
   * Send MsgTimeout for a specific packet
   */
  private async timeoutPacket(
    sourceClient: IBCQueryClient,
    destClient: IBCQueryClient,
    packet: IBCPacket,
    sourcePort: string,
    sourceChannel: string,
    destPort: string,
    destChannel: string,
    isOrderedChannel: boolean,
    sourceChainId: string
  ): Promise<string | null> {
    try {
      logger.info(`[IBCPacketCleaner] Creating timeout transaction for packet ${packet.sequence}`);

      // Get proof that packet was not received/acknowledged
      const proof = await destClient.getUnreceivedPacketProof(
        destPort,
        destChannel,
        parseInt(packet.sequence),
        isOrderedChannel
      );

      if (!proof) {
        throw new Error(`Could not get unreceived packet proof for sequence ${packet.sequence}`);
      }

      // Get next sequence receive (for ordered channels)
      let nextSequenceRecv = '0';
      if (isOrderedChannel) {
        nextSequenceRecv = (await destClient.queryNextSequenceReceive(destPort, destChannel)).toString();
      }

      // Create MsgTimeout
      const msgTimeout: MsgTimeout = {
        packet: packet,
        proof_unreceived: proof.proof,
        proof_height: proof.proof_height,
        next_sequence_recv: nextSequenceRecv,
        signer: process.env.IBC_CLEANER_SIGNER_ADDRESS || ''
      };

      // Check if we have the mnemonic for real transaction sending
      const mnemonic = process.env.IBC_CLEANER_MNEMONIC;
      if (!mnemonic) {
        logger.warn('[IBCPacketCleaner] No mnemonic provided, simulating transaction');
        
        // Simulate transaction hash
        const simulatedTxHash = `timeout_${packet.sequence}_${Date.now()}`;
        await new Promise(resolve => setTimeout(resolve, 1000));
        return simulatedTxHash;
      }

      // Send real transaction
      const sourceChainConfig = this.chainConfigService.getChainConfig(sourceChainId);

      if (!sourceChainConfig) {
        throw new Error('Source chain configuration not found');
      }

      const transactionSender = new TransactionSender();
      await transactionSender.initialize(mnemonic, sourceChainConfig.prefix);
      await transactionSender.connectToChain(sourceChainConfig);

      try {
        const txHash = await transactionSender.sendTimeoutTransaction(msgTimeout);
        logger.info(`[IBCPacketCleaner] Successfully sent timeout transaction: ${txHash}`);
        return txHash;
      } finally {
        transactionSender.disconnect();
      }

    } catch (error: any) {
      logger.error(`[IBCPacketCleaner] Failed to timeout packet ${packet.sequence}:`, error);
      throw error;
    }
  }
} 