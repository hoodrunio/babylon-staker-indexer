import { BaseClient } from './BaseClient';
import { logger } from '../utils/logger';

/**
 * Client for querying transaction data
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
     * Retrieves transaction information with a given hash
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
        } catch (error) {
            // Forward to upper layers
            logger.error(`[TransactionClient] Error getting transaction ${txHash} for ${this.network}:`, error);
            throw error; // Re-throw the error, to be handled by BabylonClient
        }
    }

    /**
     * Searches for transactions with a specific query
     * @param query Search query
     * @param page Page number
     * @param limit Results per page
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

            // Since AND operator doesn't work properly in Cosmos SDK v0.50.x, we only use the message.action parameter
            // and perform height filtering on the JavaScript side
            const searchParams = new URLSearchParams();

            // Use only message.action filter
            searchParams.append('query', "message.action='/babylon.epoching.v1.MsgWrappedDelegate'");
            searchParams.append('pagination.limit', '1000'); // Increase limit for more results
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
                            amount: parseFloat(delegateMsg.amount.amount) / 1000000, // Convert from uBBN to BBN
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

            // Since AND operator doesn't work properly in Cosmos SDK v0.50.x, we only use the message.action parameter
            // and perform height filtering on the JavaScript side
            const searchParams = new URLSearchParams();

            // Use only message.action filter
            searchParams.append('query', "message.action='/babylon.epoching.v1.MsgWrappedUndelegate'");
            searchParams.append('pagination.limit', '1000'); // Increase limit for more results
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
                            amount: parseFloat(undelegateMsg.amount.amount) / 1000000, // Convert from uBBN to BBN
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

            // Create a more general query for the transaction type - we can query only transactions related to "staking" or "epoching"
            // For example: message.module='staking' or message.module='epoching'
            // Then we will filter on the client side
            const searchParams = new URLSearchParams();

            // Use a more general query or an OR query-like approach
            // For this example, we query all transactions in the babylon.epoching module
            searchParams.append('query', "message.module='epoching'");
            searchParams.append('pagination.limit', '1000'); // Increase limit for more results
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
                            amount: parseFloat(delegateMsg.amount.amount) / 1000000, // Convert from uBBN to BBN
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
                            amount: parseFloat(undelegateMsg.amount.amount) / 1000000, // Convert from uBBN to BBN
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