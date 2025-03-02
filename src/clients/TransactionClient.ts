import { BaseClient } from './BaseClient';
import { logger } from '../utils/logger';

/**
 * İşlem verilerini almak için kullanılan istemci
 */
export class TransactionClient extends BaseClient {
    /**
     * @param network Ağ tipi
     * @param nodeUrl Node URL
     * @param rpcUrl RPC URL
     * @param wsUrl WebSocket URL (opsiyonel)
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
     * Belirli bir hash ile işlem bilgilerini alır
     * @param txHash İşlem hash'i
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
            logger.error(`[TransactionClient] Error getting transaction ${txHash} for ${this.network}:`, error);
            return null;
        }
    }

    /**
     * Belirli bir sorgu ile işlemleri arar
     * @param query Arama sorgusu
     * @param page Sayfa numarası
     * @param limit Sayfa başına sonuç sayısı
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
     * Delegate işlemlerini belirli bir blok aralığında alır
     * @param startHeight Başlangıç blok yüksekliği
     * @param endHeight Bitiş blok yüksekliği
     */
    public async getDelegateTransactions(startHeight: number, endHeight: number): Promise<any[]> {
        try {
            logger.debug(`[TransactionClient] Getting delegate transactions from block ${startHeight} to ${endHeight} for ${this.network}`);
            
            // Cosmos SDK v0.50.x'de AND operatörü düzgün çalışmadığı için sadece message.action parametresini kullanıyoruz
            // ve height filtrelemesini JavaScript tarafında yapıyoruz
            const searchParams = new URLSearchParams();
            
            // Sadece message.action filtresini kullan
            searchParams.append('query', "message.action='/babylon.epoching.v1.MsgWrappedDelegate'");
            searchParams.append('pagination.limit', '1000'); // Daha fazla sonuç için limiti artırıyoruz
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
            
            // JavaScript tarafında height filtrelemesi yapıyoruz
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
     * Unbonding işlemlerini belirli bir blok aralığında alır
     * @param startHeight Başlangıç blok yüksekliği
     * @param endHeight Bitiş blok yüksekliği
     */
    public async getUnbondingTransactions(startHeight: number, endHeight: number): Promise<any[]> {
        try {
            logger.debug(`[TransactionClient] Getting unbonding transactions from block ${startHeight} to ${endHeight} for ${this.network}`);
            
            // Cosmos SDK v0.50.x'de AND operatörü düzgün çalışmadığı için sadece message.action parametresini kullanıyoruz
            // ve height filtrelemesini JavaScript tarafında yapıyoruz
            const searchParams = new URLSearchParams();
            
            // Sadece message.action filtresini kullan
            searchParams.append('query', "message.action='/babylon.epoching.v1.MsgWrappedUndelegate'");
            searchParams.append('pagination.limit', '1000'); // Daha fazla sonuç için limiti artırıyoruz
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
            
            // JavaScript tarafında height filtrelemesi yapıyoruz
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
     * Hem delegate hem de unbonding işlemlerini tek bir sorgu ile alır
     * @param startHeight Başlangıç blok yüksekliği
     * @param endHeight Bitiş blok yüksekliği
     */
    public async getAllStakingTransactions(startHeight: number, endHeight: number): Promise<{
        delegateTransactions: any[];
        unbondingTransactions: any[];
    }> {
        try {
            logger.debug(`[TransactionClient] Getting all staking transactions from block ${startHeight} to ${endHeight} for ${this.network}`);
            
            // İşlem tipi için daha genel bir sorgu oluştur - sadece "staking" veya "epoching" ile ilgili işlemleri sorgulayabiliriz
            // Örneğin: message.module='staking' veya message.module='epoching'
            // Sonra client tarafında filtreleme yapacağız
            const searchParams = new URLSearchParams();
            
            // Daha genel bir sorgu kullan ya da OR sorgusu benzeri bir yaklaşım
            // Bu örnek için babylon.epoching modülündeki tüm işlemleri sorguluyoruz
            searchParams.append('query', "message.module='epoching'");
            searchParams.append('pagination.limit', '1000'); // Daha fazla sonuç için limiti artırıyoruz
            searchParams.append('pagination.count_total', 'true');
            
            const url = '/cosmos/tx/v1beta1/txs';
            const fullUrl = `${url}?${searchParams.toString()}`;

            logger.debug(`[TransactionClient] Constructed URL for all staking transactions: ${fullUrl}`);
            
            const response = await this.client.get(fullUrl);
            
            if (!response || !response.data) {
                throw new Error('Invalid response from Babylon node');
            }
            
            // Tüm işlemleri al
            const transactions = response.data.txs || [];
            
            // JavaScript tarafında height filtrelemesi yapıyoruz
            const filteredTransactions = transactions.filter((tx: any) => {
                const height = parseInt(tx.height);
                return height >= startHeight && height <= endHeight;
            });
            
            // Delegate ve unbonding işlemlerini ayır
            const delegateTransactions = filteredTransactions
                .filter((tx: any) => {
                    const hasDelegate = tx.body.messages.some((msg: any) => 
                        msg['@type'] === '/babylon.epoching.v1.MsgWrappedDelegate'
                    );
                    return hasDelegate;
                })
                .map((tx: any) => {
                    // Delegate mesajını bul
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
                    // Undelegate mesajını bul
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
                .filter(Boolean); // Null değerleri temizle
                
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