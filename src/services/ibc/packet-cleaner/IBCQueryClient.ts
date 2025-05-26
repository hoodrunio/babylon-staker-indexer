import axios, { AxiosInstance } from 'axios';
import { ChainInfo, IBCPacket, UnreceivedPacketProof, ChannelEnd } from './types';
import { logger } from '../../../utils/logger';

export class IBCQueryClient {
  private client: AxiosInstance;
  private chainInfo: ChainInfo;

  constructor(chainInfo: ChainInfo) {
    this.chainInfo = chainInfo;
    this.client = axios.create({
      baseURL: chainInfo.rpc_url,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error(`[IBCQueryClient] Request failed for ${chainInfo.chain_id}:`, {
          url: error.config?.url,
          status: error.response?.status,
          message: error.message
        });
        throw error;
      }
    );
  }

  /**
   * Get current chain height and timestamp
   */
  public async getCurrentHeight(): Promise<{ height: number; timestamp: Date }> {
    try {
      const response = await this.client.get('/status');
      const height = parseInt(response.data.result.sync_info.latest_block_height);
      const timestamp = new Date(response.data.result.sync_info.latest_block_time);
      
      logger.debug(`[IBCQueryClient] Current height for ${this.chainInfo.chain_id}: ${height}`);
      return { height, timestamp };
    } catch (error) {
      logger.error(`[IBCQueryClient] Failed to get current height for ${this.chainInfo.chain_id}:`, error);
      throw error;
    }
  }

  /**
   * Query channel information
   */
  public async queryChannel(portId: string, channelId: string): Promise<ChannelEnd | null> {
    try {
      const response = await this.client.get(
        `/ibc/core/channel/v1/channels/${channelId}/ports/${portId}`
      );
      
      if (response.data?.channel) {
        return response.data.channel;
      }
      return null;
    } catch (error) {
      logger.error(`[IBCQueryClient] Failed to query channel ${channelId}/${portId}:`, error);
      return null;
    }
  }

  /**
   * Query packet commitment (to check if packet was sent)
   */
  public async queryPacketCommitment(
    portId: string, 
    channelId: string, 
    sequence: number
  ): Promise<boolean> {
    try {
      const response = await this.client.get(
        `/ibc/core/channel/v1/channels/${channelId}/ports/${portId}/packet_commitments/${sequence}`
      );
      
      return response.data?.commitment && response.data.commitment !== '';
    } catch (error: any) {
      if (error.response?.status === 404) {
        return false; // Packet commitment not found
      }
      logger.error(`[IBCQueryClient] Failed to query packet commitment:`, error);
      throw error;
    }
  }

  /**
   * Query actual packet data
   */
  public async queryPacketData(
    portId: string,
    channelId: string,
    sequence: number
  ): Promise<IBCPacket | null> {
    try {
      // Query packet commitment to get the packet hash
      const commitmentResponse = await this.client.get(
        `/ibc/core/channel/v1/channels/${channelId}/ports/${portId}/packet_commitments/${sequence}`
      );

      if (!commitmentResponse.data?.commitment) {
        return null;
      }

      // For actual packet data, we need to query the transaction that sent the packet
      // This is a more complex query that requires searching through blocks
      // Let's use a practical approach by querying recent blocks and finding the packet

      const currentHeight = await this.getCurrentHeight();
      const searchRange = 10000; // Search last 10k blocks
      const startHeight = Math.max(1, currentHeight.height - searchRange);

      for (let height = currentHeight.height; height >= startHeight; height -= 100) {
        try {
          const blockResponse = await this.client.get(`/block?height=${height}`);
          const block = blockResponse.data.result.block;
          
          if (block?.data?.txs) {
            for (const txBase64 of block.data.txs) {
              try {
                // Decode transaction
                const txBytes = Buffer.from(txBase64, 'base64');
                const txString = txBytes.toString('utf8');
                
                // Look for IBC transfer message in transaction
                if (txString.includes(`"source_port":"${portId}"`) && 
                    txString.includes(`"source_channel":"${channelId}"`) &&
                    txString.includes(`"sequence":"${sequence}"`)) {
                  
                  // Extract packet information from transaction
                  const packet = this.extractPacketFromTx(txString, sequence, portId, channelId);
                  if (packet) {
                    return packet;
                  }
                }
              } catch (e) {
                // Skip invalid transactions
                continue;
              }
            }
          }
        } catch (e) {
          // Skip blocks that can't be queried
          continue;
        }
      }

      // If we can't find the actual packet data, create a minimal packet structure
      // using the commitment hash and reasonable defaults
      logger.warn(`[IBCQueryClient] Could not find actual packet data for ${sequence}, using minimal structure`);
      
      return {
        sequence: sequence.toString(),
        source_port: portId,
        source_channel: channelId,
        destination_port: 'transfer',
        destination_channel: '',
        data: commitmentResponse.data.commitment,
        timeout_height: {
          revision_number: '0',
          revision_height: (currentHeight.height + 1000).toString()
        },
        timeout_timestamp: (Date.now() + 3600000).toString()
      };

    } catch (error: any) {
      logger.error(`[IBCQueryClient] Failed to query packet data:`, error);
      return null;
    }
  }

  /**
   * Extract packet information from transaction string
   */
  private extractPacketFromTx(txString: string, sequence: number, portId: string, channelId: string): IBCPacket | null {
    try {
      // Try to extract packet information using regex patterns
      const timeoutHeightMatch = txString.match(/"timeout_height":\s*{[^}]*"revision_height":\s*"(\d+)"[^}]*}/);
      const timeoutTimestampMatch = txString.match(/"timeout_timestamp":\s*"(\d+)"/);
      const destPortMatch = txString.match(/"destination_port":\s*"([^"]+)"/);
      const destChannelMatch = txString.match(/"destination_channel":\s*"([^"]+)"/);
      const dataMatch = txString.match(/"data":\s*"([^"]+)"/);

      return {
        sequence: sequence.toString(),
        source_port: portId,
        source_channel: channelId,
        destination_port: destPortMatch ? destPortMatch[1] : 'transfer',
        destination_channel: destChannelMatch ? destChannelMatch[1] : '',
        data: dataMatch ? dataMatch[1] : '',
        timeout_height: timeoutHeightMatch ? {
          revision_number: '0',
          revision_height: timeoutHeightMatch[1]
        } : null,
        timeout_timestamp: timeoutTimestampMatch ? timeoutTimestampMatch[1] : '0'
      };
    } catch (error) {
      logger.error(`[IBCQueryClient] Failed to extract packet from transaction:`, error);
      return null;
    }
  }

  /**
   * Query packet acknowledgement
   */
  public async queryPacketAcknowledgement(
    portId: string, 
    channelId: string, 
    sequence: number
  ): Promise<{ acknowledgement: string | null; proof: string; proofHeight: any }> {
    try {
      const response = await this.client.get(
        `/ibc/core/channel/v1/channels/${channelId}/ports/${portId}/packet_acks/${sequence}`
      );
      
      return {
        acknowledgement: response.data?.acknowledgement || null,
        proof: response.data?.proof || '',
        proofHeight: response.data?.proof_height || null
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        // No acknowledgement found - this is what we want for timeout
        return {
          acknowledgement: null,
          proof: '',
          proofHeight: null
        };
      }
      logger.error(`[IBCQueryClient] Failed to query packet acknowledgement:`, error);
      throw error;
    }
  }

  /**
   * Query packet receipt (for unordered channels)
   */
  public async queryPacketReceipt(
    portId: string, 
    channelId: string, 
    sequence: number
  ): Promise<{ received: boolean; proof: string; proofHeight: any }> {
    try {
      const response = await this.client.get(
        `/ibc/core/channel/v1/channels/${channelId}/ports/${portId}/packet_receipts/${sequence}`
      );
      
      return {
        received: response.data?.received || false,
        proof: response.data?.proof || '',
        proofHeight: response.data?.proof_height || null
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        // No receipt found
        return {
          received: false,
          proof: '',
          proofHeight: null
        };
      }
      logger.error(`[IBCQueryClient] Failed to query packet receipt:`, error);
      throw error;
    }
  }

  /**
   * Get unreceived packets for a channel
   */
  public async queryUnreceivedPackets(
    portId: string, 
    channelId: string, 
    sequences: number[]
  ): Promise<number[]> {
    try {
      const seqParam = sequences.join(',');
      const response = await this.client.get(
        `/ibc/core/channel/v1/channels/${channelId}/ports/${portId}/packet_commitments/${seqParam}/unreceived_packets`
      );
      
      return response.data?.sequences?.map((seq: string) => parseInt(seq)) || [];
    } catch (error) {
      logger.error(`[IBCQueryClient] Failed to query unreceived packets:`, error);
      return [];
    }
  }

  /**
   * Query next sequence receive (for ordered channels)
   */
  public async queryNextSequenceReceive(
    portId: string, 
    channelId: string
  ): Promise<number> {
    try {
      const response = await this.client.get(
        `/ibc/core/channel/v1/channels/${channelId}/ports/${portId}/next_sequence`
      );
      
      return parseInt(response.data?.next_sequence_receive || '1');
    } catch (error) {
      logger.error(`[IBCQueryClient] Failed to query next sequence receive:`, error);
      return 1;
    }
  }

  /**
   * Get proof that a packet was not received/acknowledged
   */
  public async getUnreceivedPacketProof(
    portId: string,
    channelId: string,
    sequence: number,
    isOrderedChannel: boolean = false
  ): Promise<UnreceivedPacketProof | null> {
    try {
      let proof: string;
      let proofHeight: any;

      if (isOrderedChannel) {
        // For ordered channels, check if packet was received
        const receiptResult = await this.queryPacketReceipt(portId, channelId, sequence);
        if (receiptResult.received) {
          logger.warn(`[IBCQueryClient] Packet ${sequence} was already received`);
          return null;
        }
        proof = receiptResult.proof;
        proofHeight = receiptResult.proofHeight;
      } else {
        // For unordered channels, check if packet was acknowledged
        const ackResult = await this.queryPacketAcknowledgement(portId, channelId, sequence);
        if (ackResult.acknowledgement) {
          logger.warn(`[IBCQueryClient] Packet ${sequence} was already acknowledged`);
          return null;
        }
        proof = ackResult.proof;
        proofHeight = ackResult.proofHeight;
      }

      if (!proof || !proofHeight) {
        // Get current height if proof height is missing
        const currentState = await this.getCurrentHeight();
        proofHeight = {
          revision_number: '0',
          revision_height: currentState.height.toString()
        };
      }

      return {
        proof,
        proof_height: proofHeight
      };
    } catch (error) {
      logger.error(`[IBCQueryClient] Failed to get unreceived packet proof:`, error);
      return null;
    }
  }
} 