import { Network } from '../../types/finality';
import { BabylonClient } from '../../clients/BabylonClient';
import { BBNStakeIndexer } from './BBNStakeIndexer';
import { logger } from '../../utils/logger';
import { IBBNStakingProcessor } from './interfaces/IBBNStakingProcessor';

/**
 * BBN Staking İşlemlerini Tespit Edip İşleyen Sınıf
 */
export class BBNStakingProcessor implements IBBNStakingProcessor {
    private static instance: BBNStakingProcessor | null = null;
    private readonly network: Network;
    private babylonClient: BabylonClient;
    
    private constructor(network: Network = Network.MAINNET) {
        this.network = network;
        this.babylonClient = BabylonClient.getInstance(network);
    }
    
    public static getInstance(network: Network = Network.MAINNET): BBNStakingProcessor {
        if (!BBNStakingProcessor.instance) {
            BBNStakingProcessor.instance = new BBNStakingProcessor(network);
        }
        return BBNStakingProcessor.instance;
    }
    
    /**
     * İşlemin staking işlemi olup olmadığını kontrol eder ve işler
     */
    public async processTransactionIfStaking(parsedTx: any, rawTx: any, decodedTx: any): Promise<void> {
        try {
            // Stake işlemi mi kontrol et
            const isStakingTx = this.isStakingTransaction(parsedTx, decodedTx);
            if (!isStakingTx) {
                return;
            }
            
            logger.debug(`[BBNStakingProcessor] Detected staking transaction: ${parsedTx.hash}`);
            
            // Stake tipini belirle (delegate veya unbonding)
            const isDelegation = this.isDelegateTransaction(parsedTx, decodedTx);
            const isUnbonding = this.isUnbondingTransaction(parsedTx, decodedTx);
            
            if (!isDelegation && !isUnbonding) {
                logger.debug(`[BBNStakingProcessor] Staking transaction ${parsedTx.hash} is neither delegation nor unbonding, skipping`);
                return;
            }
            
            // İşlemi standardize et (BBNStakeIndexer formatına dönüştür)
            const stakeIndexer = BBNStakeIndexer.getInstance(this.network);
            
            if (isDelegation) {
                // Delegate işlemini hazırla ve BBNStakeIndexer'a gönder
                const delegateTx = this.prepareDelegateTransaction(parsedTx, rawTx, decodedTx);
                if (delegateTx) {
                    await stakeIndexer.processDelegateTransaction(delegateTx);
                }
            } else if (isUnbonding) {
                // Unbonding işlemini hazırla ve BBNStakeIndexer'a gönder
                const unbondingTx = this.prepareUnbondingTransaction(parsedTx, rawTx, decodedTx);
                if (unbondingTx) {
                    await stakeIndexer.processUnbondingTransaction(unbondingTx);
                }
            }
            
        } catch (error) {
            logger.error(`[BBNStakingProcessor] Error processing staking transaction ${parsedTx.hash}:`, error);
        }
    }
    
    /**
     * İşlemin stake işlemi olup olmadığını kontrol eder
     */
    private isStakingTransaction(parsedTx: any, decodedTx: any): boolean {
        try {
            // İşlem türünü kontrol et
            // 1. parsedTx.type içinde "delegate" veya "undelegate" kelimesi var mı?
            if (parsedTx.type && (
                parsedTx.type.toLowerCase().includes('delegate') || 
                parsedTx.type.toLowerCase().includes('unbond')
            )) {
                return true;
            }
            
            // 2. decodedTx içinde delegate veya undelegate mesajı var mı?
            if (decodedTx && decodedTx.messages) {
                for (const msg of decodedTx.messages) {
                    if (msg.typeUrl && (
                        msg.typeUrl.includes('MsgDelegate') || 
                        msg.typeUrl.includes('MsgUndelegate') ||
                        msg.typeUrl.includes('WrappedDelegate') ||
                        msg.typeUrl.includes('WrappedUndelegate')
                    )) {
                        return true;
                    }
                }
            }
            
            // 3. decodedTx.tx içinde varsa kontrol et
            if (decodedTx && decodedTx.tx && decodedTx.tx.body && decodedTx.tx.body.messages) {
                for (const msg of decodedTx.tx.body.messages) {
                    if (msg['@type'] && (
                        msg['@type'].includes('MsgDelegate') || 
                        msg['@type'].includes('MsgUndelegate') ||
                        msg['@type'].includes('WrappedDelegate') ||
                        msg['@type'].includes('WrappedUndelegate')
                    )) {
                        return true;
                    }
                }
            }
            
            return false;
        } catch (error) {
            logger.error(`[BBNStakingProcessor] Error checking if transaction is staking:`, error);
            return false;
        }
    }
    
    /**
     * İşlemin delegate işlemi olup olmadığını kontrol eder
     */
    private isDelegateTransaction(parsedTx: any, decodedTx: any): boolean {
        try {
            // İşlem türünü kontrol et
            // 1. parsedTx.type içinde "delegate" kelimesi var mı?
            if (parsedTx.type && parsedTx.type.toLowerCase().includes('delegate') && 
                !parsedTx.type.toLowerCase().includes('undelegate')) {
                return true;
            }
            
            // 2. decodedTx.messages içinde delegate mesajı var mı?
            if (decodedTx && decodedTx.messages) {
                for (const msg of decodedTx.messages) {
                    if (msg.typeUrl && (
                        msg.typeUrl.includes('MsgDelegate') || 
                        msg.typeUrl.includes('WrappedDelegate')
                    )) {
                        return true;
                    }
                }
            }
            
            // 3. decodedTx.tx içinde varsa kontrol et
            if (decodedTx && decodedTx.tx && decodedTx.tx.body && decodedTx.tx.body.messages) {
                for (const msg of decodedTx.tx.body.messages) {
                    if (msg['@type'] && (
                        msg['@type'].includes('MsgDelegate') || 
                        msg['@type'].includes('WrappedDelegate')
                    )) {
                        return true;
                    }
                }
            }
            
            return false;
        } catch (error) {
            logger.error(`[BBNStakingProcessor] Error checking if transaction is delegation:`, error);
            return false;
        }
    }
    
    /**
     * İşlemin unbonding işlemi olup olmadığını kontrol eder
     */
    private isUnbondingTransaction(parsedTx: any, decodedTx: any): boolean {
        try {
            // İşlem türünü kontrol et
            // 1. parsedTx.type içinde "undelegate" veya "unbond" kelimesi var mı?
            if (parsedTx.type && (
                parsedTx.type.toLowerCase().includes('undelegate') || 
                parsedTx.type.toLowerCase().includes('unbond')
            )) {
                return true;
            }
            
            // 2. decodedTx.messages içinde undelegate mesajı var mı?
            if (decodedTx && decodedTx.messages) {
                for (const msg of decodedTx.messages) {
                    if (msg.typeUrl && (
                        msg.typeUrl.includes('MsgUndelegate') || 
                        msg.typeUrl.includes('WrappedUndelegate')
                    )) {
                        return true;
                    }
                }
            }
            
            // 3. decodedTx.tx içinde varsa kontrol et
            if (decodedTx && decodedTx.tx && decodedTx.tx.body && decodedTx.tx.body.messages) {
                for (const msg of decodedTx.tx.body.messages) {
                    if (msg['@type'] && (
                        msg['@type'].includes('MsgUndelegate') || 
                        msg['@type'].includes('WrappedUndelegate')
                    )) {
                        return true;
                    }
                }
            }
            
            return false;
        } catch (error) {
            logger.error(`[BBNStakingProcessor] Error checking if transaction is unbonding:`, error);
            return false;
        }
    }
    
    /**
     * Delegate işlemini BBNStakeIndexer formatına dönüştürür
     */
    private prepareDelegateTransaction(parsedTx: any, rawTx: any, decodedTx: any): any {
        try {
            // 1. decodedTx.messages'dan delegate mesajını bul
            let delegateMsg;
            if (decodedTx && decodedTx.messages) {
                delegateMsg = decodedTx.messages.find((msg: any) => 
                    msg.typeUrl && (
                        msg.typeUrl.includes('MsgDelegate') || 
                        msg.typeUrl.includes('WrappedDelegate')
                    )
                );
                
                // Eğer mesajı bulduysa, content'i al
                if (delegateMsg) {
                    delegateMsg = delegateMsg.content;
                }
            }
            
            // 2. decodedTx.tx.body.messages'dan bul
            if (!delegateMsg && decodedTx && decodedTx.tx && decodedTx.tx.body && decodedTx.tx.body.messages) {
                delegateMsg = decodedTx.tx.body.messages.find((msg: any) => 
                    msg['@type'] && (
                        msg['@type'].includes('MsgDelegate') || 
                        msg['@type'].includes('WrappedDelegate')
                    )
                );
            }
            
            if (!delegateMsg) {
                logger.warn(`[BBNStakingProcessor] Delegate message not found in transaction ${parsedTx.hash}`);
                return null;
            }
            
            // 3. BBNStakeIndexer formatına dönüştür
            return {
                hash: parsedTx.hash,
                height: parsedTx.blockHeight,
                timestamp: parsedTx.timestamp,
                sender: delegateMsg.delegator_address || delegateMsg.delegatorAddress,
                message: {
                    validatorAddress: delegateMsg.validator_address || delegateMsg.validatorAddress,
                    amount: parseFloat(delegateMsg.amount ? 
                        (delegateMsg.amount.amount || delegateMsg.amount) : 0) / 1000000, // Convert from uBBN to BBN
                    denom: delegateMsg.amount ? 
                        (delegateMsg.amount.denom || 'ubbn') : 'ubbn'
                }
            };
        } catch (error) {
            logger.error(`[BBNStakingProcessor] Error preparing delegate transaction:`, error);
            return null;
        }
    }
    
    /**
     * Unbonding işlemini BBNStakeIndexer formatına dönüştürür
     */
    private prepareUnbondingTransaction(parsedTx: any, rawTx: any, decodedTx: any): any {
        try {
            // 1. decodedTx.messages'dan undelegate mesajını bul
            let undelegateMsg;
            if (decodedTx && decodedTx.messages) {
                undelegateMsg = decodedTx.messages.find((msg: any) => 
                    msg.typeUrl && (
                        msg.typeUrl.includes('MsgUndelegate') || 
                        msg.typeUrl.includes('WrappedUndelegate')
                    )
                );
                
                // Eğer mesajı bulduysa, content'i al
                if (undelegateMsg) {
                    undelegateMsg = undelegateMsg.content;
                }
            }
            
            // 2. decodedTx.tx.body.messages'dan bul
            if (!undelegateMsg && decodedTx && decodedTx.tx && decodedTx.tx.body && decodedTx.tx.body.messages) {
                undelegateMsg = decodedTx.tx.body.messages.find((msg: any) => 
                    msg['@type'] && (
                        msg['@type'].includes('MsgUndelegate') || 
                        msg['@type'].includes('WrappedUndelegate')
                    )
                );
            }
            
            if (!undelegateMsg) {
                logger.warn(`[BBNStakingProcessor] Undelegate message not found in transaction ${parsedTx.hash}`);
                return null;
            }
            
            // 3. BBNStakeIndexer formatına dönüştür
            return {
                hash: parsedTx.hash,
                height: parsedTx.blockHeight,
                timestamp: parsedTx.timestamp,
                sender: undelegateMsg.delegator_address || undelegateMsg.delegatorAddress,
                message: {
                    validatorAddress: undelegateMsg.validator_address || undelegateMsg.validatorAddress,
                    amount: parseFloat(undelegateMsg.amount ? 
                        (undelegateMsg.amount.amount || undelegateMsg.amount) : 0) / 1000000, // Convert from uBBN to BBN
                    denom: undelegateMsg.amount ? 
                        (undelegateMsg.amount.denom || 'ubbn') : 'ubbn'
                }
            };
        } catch (error) {
            logger.error(`[BBNStakingProcessor] Error preparing unbonding transaction:`, error);
            return null;
        }
    }
} 