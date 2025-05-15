import { BaseClient, CustomError } from './BaseClient';
import { logger } from '../utils/logger';

/**
 * Client used to retrieve transaction data
 */
export class TransactionClient extends BaseClient {
    /**
     * @param network Network type
     * @param nodeUrl Node URL
     * @param rpcUrl RPC URL
     * @param wsUrl WebSocket URL (optional)
     */
    public constructor(
        network: any,
        nodeUrl: string,
        rpcUrl: string,
        wsUrl?: string
    ) {
        super(network, nodeUrl, rpcUrl, wsUrl);
    }

    /**
     * Retrieves transaction information by a specific hash
     * @param txHash Transaction hash
     */
    public async getTransaction(txHash: string): Promise<any | null> {
        try {
            logger.debug(`[TransactionClient] Getting transaction ${txHash} for ${this.network}`);
            
            const response = await this.client.get(`/cosmos/tx/v1beta1/txs/${txHash}`);
            
            if (!response || !response.data || !response.data.tx) {
                return null;
            }
            
            return response.data;
        } catch (error: any) {
            // Special case for "tx not found" error
            if (error.response?.data?.message && 
                error.response.data.message.includes('tx not found')) {
                
                logger.warn(`[TransactionClient] Transaction ${txHash} not found for ${this.network}`);
                
                // Create a special error
                const txNotFoundError: CustomError = new Error('SPECIAL_ERROR_TX_NOT_FOUND');
                txNotFoundError.name = 'TxNotFoundError';
                txNotFoundError.originalError = error;
                throw txNotFoundError;
            }
            
            // Check for invalid hex format error
            if (error.response?.data?.message && 
                typeof error.response.data.message === 'string' &&
                (error.response.data.message.includes('odd length hex string') ||
                 error.response.data.message.includes('invalid byte'))) {
                
                logger.warn(`[TransactionClient] Invalid hex format in transaction hash ${txHash} for ${this.network}`);
                
                // Create a special error
                const invalidHexError: CustomError = new Error('INVALID_HEX_FORMAT');
                invalidHexError.name = 'InvalidHexFormatError';
                invalidHexError.originalError = error;
                throw invalidHexError;
            }
            
            logger.error(`[TransactionClient] Error getting transaction ${txHash} for ${this.network}:`, error);
            throw error;
        }
    }

    /**
     * Searches for transactions with a specific query
     * @param query Search query
     * @param page Page number
     * @param limit Number of results per page
     */
    public async searchTxs(query: string, page: number = 1, limit: number = 100): Promise<any> {
        try {
            logger.info(`[TransactionClient] Searching transactions with query: ${query}, page: ${page}, limit: ${limit}`);
            const params = new URLSearchParams({
                'query': query,
                'pagination.limit': limit.toString(),
                'page': page.toString(),
                'order_by': 'ORDER_BY_DESC'
            });

            const url = `/cosmos/tx/v1beta1/txs?${params.toString()}`;

            const response = await this.client.get(url);
            
            if (!response.data) {
                logger.warn('[TransactionClient] No transactions found in response');
                return null;
            }

            if (response.data.txs) {
                logger.info(`[TransactionClient] Found ${response.data.txs.length} transactions`);
            }

            return response.data;
        } catch (error) {
            logger.error('[TransactionClient] Error searching transactions:', error);
            return null;
        }
    }

    /**
     * Retrieves delegate transactions within a specific block range
     * @param startHeight Starting block height
     * @param endHeight Ending block height
     */
    public async getDelegateTransactions(startHeight: number, endHeight: number): Promise<any[]> {
        try {
            logger.debug(`[TransactionClient] Getting delegate transactions from block ${startHeight} to ${endHeight} for ${this.network}`);
            
            // Due to the AND operator not working correctly in Cosmos SDK v0.50.x, we only use the message.action parameter
            // and perform height filtering on the JavaScript side
            const searchParams = new URLSearchParams();
            
            // Use only the message.action filter
            searchParams.append('query', "message.action='/babylon.epoching.v1.MsgWrappedDelegate'");
            searchParams.append('pagination.limit', '1000'); // Increase the limit for more results
            searchParams.append('pagination.count_total', 'true');
            
            const url = '/cosmos/tx/v1beta1/txs';
            const fullUrl = `${url}?${searchParams.toString()}`;

            logger.debug(`[TransactionClient] Constructed URL for delegate transactions: ${fullUrl}`);
            
            const response = await this.client.get(fullUrl);
            
            if (!response || !response.data) {
                throw new Error('Invalid response from Babylon node');
            }
            
            // Process and normalize the transactions
            const transactions = response.data.txs || [];
            
            // Perform height filtering on the JavaScript side
            return transactions
                .filter((tx: any) => {
                    const height = parseInt(tx.height);
                    return height >= startHeight && height <= endHeight;
                })
                .map((tx: any) => {
                    // Extract the delegate message from the transaction
                    const delegateMsg = tx.body.messages.find((msg: any) => 
                        msg['@type'] === '/babylon.epoching.v1.MsgWrappedDelegate'
                    );
                    
                    if (!delegateMsg) {
                        return null;
                    }
                    
                    return {
                        hash: tx.txhash,
                        height: parseInt(tx.height),
                        timestamp: new Date(tx.timestamp).getTime(),
                        sender: delegateMsg.delegator_address,
                        message: {
                            validatorAddress: delegateMsg.validator_address,
                            amount: parseFloat(delegateMsg.amount.amount) / 1000000, // Convert from uBBN to BABY
                            denom: delegateMsg.amount.denom
                        }
                    };
                }).filter(Boolean); // Remove any null entries
        } catch (error) {
            logger.error(`[TransactionClient] Error getting delegate transactions for ${this.network}:`, error);
            throw error;
        }
    }
    
    /**
     * Retrieves unbonding transactions within a specific block range
     * @param startHeight Starting block height
     * @param endHeight Ending block height
     */
    public async getUnbondingTransactions(startHeight: number, endHeight: number): Promise<any[]> {
        try {
            logger.debug(`[TransactionClient] Getting unbonding transactions from block ${startHeight} to ${endHeight} for ${this.network}`);
            
            // Due to the AND operator not working correctly in Cosmos SDK v0.50.x, we only use the message.action parameter
            // and perform height filtering on the JavaScript side
            const searchParams = new URLSearchParams();
            
            // Use only the message.action filter
            searchParams.append('query', "message.action='/babylon.epoching.v1.MsgWrappedUndelegate'");
            searchParams.append('pagination.limit', '1000'); // Increase the limit for more results
            searchParams.append('pagination.count_total', 'true');
            
            const url = '/cosmos/tx/v1beta1/txs';
            const fullUrl = `${url}?${searchParams.toString()}`;

            logger.debug(`[TransactionClient] Constructed URL for unbonding transactions: ${fullUrl}`);
            
            const response = await this.client.get(fullUrl);
            
            if (!response || !response.data) {
                throw new Error('Invalid response from Babylon node');
            }
            
            // Process and normalize the transactions
            const transactions = response.data.txs || [];
            
            // Perform height filtering on the JavaScript side
            return transactions
                .filter((tx: any) => {
                    const height = parseInt(tx.height);
                    return height >= startHeight && height <= endHeight;
                })
                .map((tx: any) => {
                    // Extract the undelegate message from the transaction
                    const undelegateMsg = tx.body.messages.find((msg: any) => 
                        msg['@type'] === '/babylon.epoching.v1.MsgWrappedUndelegate'
                    );
                    
                    if (!undelegateMsg) {
                        return null;
                    }
                    
                    return {
                        hash: tx.txhash,
                        height: parseInt(tx.height),
                        timestamp: new Date(tx.timestamp).getTime(),
                        sender: undelegateMsg.delegator_address,
                        message: {
                            validatorAddress: undelegateMsg.validator_address,
                            amount: parseFloat(undelegateMsg.amount.amount) / 1000000, // Convert from uBBN to BABY
                            denom: undelegateMsg.amount.denom
                        }
                    };
                }).filter(Boolean); // Remove any null entries
        } catch (error) {
            logger.error(`[TransactionClient] Error getting unbonding transactions for ${this.network}:`, error);
            throw error;
        }
    }

    /**
     * Retrieves both delegate and unbonding transactions with a single query
     * @param startHeight Starting block height
     * @param endHeight Ending block height
     */
    public async getAllStakingTransactions(startHeight: number, endHeight: number): Promise<{
        delegateTransactions: any[];
        unbondingTransactions: any[];
    }> {
        try {
            logger.debug(`[TransactionClient] Getting all staking transactions from block ${startHeight} to ${endHeight} for ${this.network}`);
            
            // Create a more general query for the transaction type - we can only query transactions related to "staking" or "epoching"
            // For example: message.module='staking' or message.module='epoching'
            // Then we will filter on the client side
            const searchParams = new URLSearchParams();
            
            // Use a more general query or an OR-like query approach
            // For this example, we query all transactions in the babylon.epoching module
            searchParams.append('query', "message.module='epoching'");
            searchParams.append('pagination.limit', '1000'); // Increase the limit for more results
            searchParams.append('pagination.count_total', 'true');
            
            const url = '/cosmos/tx/v1beta1/txs';
            const fullUrl = `${url}?${searchParams.toString()}`;

            logger.debug(`[TransactionClient] Constructed URL for all staking transactions: ${fullUrl}`);
            
            const response = await this.client.get(fullUrl);
            
            if (!response || !response.data) {
                throw new Error('Invalid response from Babylon node');
            }
            
            // Get all transactions
            const transactions = response.data.txs || [];
            
            // Perform height filtering on the JavaScript side
            const filteredTransactions = transactions.filter((tx: any) => {
                const height = parseInt(tx.height);
                return height >= startHeight && height <= endHeight;
            });
            
            // Separate delegate and unbonding transactions
            const delegateTransactions = filteredTransactions
                .filter((tx: any) => {
                    const hasDelegate = tx.body.messages.some((msg: any) => 
                        msg['@type'] === '/babylon.epoching.v1.MsgWrappedDelegate'
                    );
                    return hasDelegate;
                })
                .map((tx: any) => {
                    // Find the delegate message
                    const delegateMsg = tx.body.messages.find((msg: any) => 
                        msg['@type'] === '/babylon.epoching.v1.MsgWrappedDelegate'
                    );
                    
                    if (!delegateMsg) {
                        return null;
                    }
                    
                    return {
                        hash: tx.txhash,
                        height: parseInt(tx.height),
                        timestamp: new Date(tx.timestamp).getTime(),
                        sender: delegateMsg.delegator_address,
                        message: {
                            validatorAddress: delegateMsg.validator_address,
                            amount: parseFloat(delegateMsg.amount.amount) / 1000000, // Convert from uBBN to BABY
                            denom: delegateMsg.amount.denom
                        }
                    };
                })
                .filter(Boolean);
                
            const unbondingTransactions = filteredTransactions
                .filter((tx: any) => {
                    const hasUndelegate = tx.body.messages.some((msg: any) => 
                        msg['@type'] === '/babylon.epoching.v1.MsgWrappedUndelegate'
                    );
                    return hasUndelegate;
                })
                .map((tx: any) => {
                    // Find the undelegate message
                    const undelegateMsg = tx.body.messages.find((msg: any) => 
                        msg['@type'] === '/babylon.epoching.v1.MsgWrappedUndelegate'
                    );
                    
                    if (!undelegateMsg) {
                        return null;
                    }
                    
                    return {
                        hash: tx.txhash,
                        height: parseInt(tx.height),
                        timestamp: new Date(tx.timestamp).getTime(),
                        sender: undelegateMsg.delegator_address,
                        message: {
                            validatorAddress: undelegateMsg.validator_address,
                            amount: parseFloat(undelegateMsg.amount.amount) / 1000000, // Convert from uBBN to BABY
                            denom: undelegateMsg.amount.denom
                        }
                    };
                })
                .filter(Boolean); // Clear null values
                
            return {
                delegateTransactions,
                unbondingTransactions
            };
        } catch (error) {
            logger.error(`[TransactionClient] Error getting all staking transactions for ${this.network}:`, error);
            throw error;
        }
    }
}