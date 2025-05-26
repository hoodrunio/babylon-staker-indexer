import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningStargateClient, GasPrice } from '@cosmjs/stargate';
import { MsgTimeout as CosmjsMsgTimeout } from 'cosmjs-types/ibc/core/channel/v1/tx';
import { MsgTimeout, ChainInfo } from './types';
import { logger } from '../../../utils/logger';

export class TransactionSender {
  private wallet: DirectSecp256k1HdWallet | null = null;
  private signingClient: SigningStargateClient | null = null;
  private signerAddress: string = '';
  private currentGasDenom: string = 'ubbn';
  private currentGasPrice: string = '0.025';

  /**
   * Initialize the transaction sender with mnemonic
   */
  public async initialize(mnemonic: string, prefix: string = 'bbn'): Promise<void> {
    try {
      this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
        prefix: prefix,
      });

      const [firstAccount] = await this.wallet.getAccounts();
      this.signerAddress = firstAccount.address;

      logger.info('[TransactionSender] Initialized with signer address:', this.signerAddress);
    } catch (error: any) {
      logger.error('[TransactionSender] Failed to initialize wallet:', error);
      throw error;
    }
  }

  /**
   * Connect to a chain
   */
  public async connectToChain(chainInfo: ChainInfo): Promise<void> {
    try {
      if (!this.wallet) {
        throw new Error('Wallet not initialized');
      }

      // Determine gas price based on chain
      let gasDenom = 'ubbn';
      let gasPrice = '0.025';

             switch (chainInfo.chain_id) {
         case 'bbn-1':
         case 'bbn-test-3':
           gasDenom = 'ubbn';
           gasPrice = '0.025';
           break;
         case 'cosmoshub-4':
           gasDenom = 'uatom';
           gasPrice = '0.025';
           break;
         case 'osmosis-1':
           gasDenom = 'uosmo';
           gasPrice = '0.025';
           break;
         default:
           // Try to determine from environment or use default
           gasDenom = process.env[`${chainInfo.chain_id.toUpperCase().replace(/-/g, '_')}_GAS_DENOM`] || 'utoken';
           gasPrice = process.env[`${chainInfo.chain_id.toUpperCase().replace(/-/g, '_')}_GAS_PRICE`] || '0.025';
       }

       // Store gas info for later use
       this.currentGasDenom = gasDenom;
       this.currentGasPrice = gasPrice;

       this.signingClient = await SigningStargateClient.connectWithSigner(
         chainInfo.rpc_url,
         this.wallet,
         {
           gasPrice: GasPrice.fromString(`${gasPrice}${gasDenom}`),
         }
       );

      logger.info(`[TransactionSender] Connected to chain: ${chainInfo.chain_id} with gas price: ${gasPrice}${gasDenom}`);
    } catch (error: any) {
      logger.error(`[TransactionSender] Failed to connect to chain ${chainInfo.chain_id}:`, error);
      throw error;
    }
  }

  /**
   * Send MsgTimeout transaction
   */
  public async sendTimeoutTransaction(msgTimeout: MsgTimeout): Promise<string> {
    try {
      if (!this.signingClient) {
        throw new Error('Signing client not initialized');
      }

      logger.info('[TransactionSender] Preparing MsgTimeout transaction', {
        packet_sequence: msgTimeout.packet.sequence,
        source_channel: msgTimeout.packet.source_channel,
        source_port: msgTimeout.packet.source_port
      });

      // Convert our MsgTimeout to CosmJS format
      const cosmjsMsgTimeout: CosmjsMsgTimeout = {
        packet: {
          sequence: BigInt(msgTimeout.packet.sequence),
          sourcePort: msgTimeout.packet.source_port,
          sourceChannel: msgTimeout.packet.source_channel,
          destinationPort: msgTimeout.packet.destination_port,
          destinationChannel: msgTimeout.packet.destination_channel,
          data: new Uint8Array(Buffer.from(msgTimeout.packet.data, 'base64')),
          timeoutHeight: msgTimeout.packet.timeout_height ? {
            revisionNumber: BigInt(msgTimeout.packet.timeout_height.revision_number),
            revisionHeight: BigInt(msgTimeout.packet.timeout_height.revision_height),
          } : {
            revisionNumber: BigInt(0),
            revisionHeight: BigInt(0),
          },
          timeoutTimestamp: BigInt(msgTimeout.packet.timeout_timestamp),
        },
        proofUnreceived: new Uint8Array(Buffer.from(msgTimeout.proof_unreceived, 'base64')),
        proofHeight: {
          revisionNumber: BigInt(msgTimeout.proof_height.revision_number),
          revisionHeight: BigInt(msgTimeout.proof_height.revision_height),
        },
        nextSequenceRecv: BigInt(msgTimeout.next_sequence_recv),
        signer: this.signerAddress,
      };

      // Create the transaction message
      const msg = {
        typeUrl: '/ibc.core.channel.v1.MsgTimeout',
        value: cosmjsMsgTimeout,
      };

      // Calculate gas and fees
      const gasEstimation = await this.signingClient.simulate(this.signerAddress, [msg], '');
      const gasLimit = Math.round(gasEstimation * 1.5); // Add 50% buffer
      
      const fee = {
        amount: [{ denom: this.currentGasDenom, amount: Math.round(gasLimit * parseFloat(this.currentGasPrice)).toString() }],
        gas: gasLimit.toString(),
      };

      logger.info('[TransactionSender] Sending transaction with gas:', {
        gasEstimation,
        gasLimit,
        fee: fee.amount[0]
      });

      // Send the transaction
      const result = await this.signingClient.signAndBroadcast(this.signerAddress, [msg], fee);

      if (result.code !== 0) {
        throw new Error(`Transaction failed with code ${result.code}: ${result.rawLog}`);
      }

      logger.info('[TransactionSender] Transaction sent successfully:', {
        txHash: result.transactionHash,
        gasUsed: result.gasUsed,
        gasWanted: result.gasWanted
      });

      return result.transactionHash;

    } catch (error: any) {
      logger.error('[TransactionSender] Failed to send timeout transaction:', error);
      throw error;
    }
  }

  /**
   * Get account balance
   */
  public async getBalance(denom: string = 'ubbn'): Promise<string> {
    try {
      if (!this.signingClient) {
        throw new Error('Signing client not initialized');
      }

      const balance = await this.signingClient.getBalance(this.signerAddress, denom);
      return balance.amount;
    } catch (error: any) {
      logger.error('[TransactionSender] Failed to get balance:', error);
      throw error;
    }
  }

  /**
   * Get signer address
   */
  public getSignerAddress(): string {
    return this.signerAddress;
  }

  /**
   * Disconnect from chain
   */
  public disconnect(): void {
    if (this.signingClient) {
      this.signingClient.disconnect();
      this.signingClient = null;
    }
    logger.info('[TransactionSender] Disconnected from chain');
  }
}

 