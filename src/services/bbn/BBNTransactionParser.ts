import { BBNTransactionType, BBNTransactionData } from '../../types/bbn';
import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { BBNTransactionStatus } from '../../types/bbn';

export class BBNTransactionParser {
    private static instance: BBNTransactionParser | null = null;

    private constructor() {}

    public static getInstance(): BBNTransactionParser {
        if (!BBNTransactionParser.instance) {
            BBNTransactionParser.instance = new BBNTransactionParser();
        }
        return BBNTransactionParser.instance;
    }

    public parseTransaction(tx: any, msgType: string, network: Network): BBNTransactionData | null {
        try {
            // Temel transaction tipini belirle
            const txType = this.determineTransactionType(msgType);
            
            // Transaction hash'ini normalize et
            // Farklı API yanıtlarını destekle
            if (tx.result && tx.result.data && tx.result.data.value && tx.result.data.value.TxResult) {
                // Websocket yanıtı durumu
                const txResult = tx.result.data.value.TxResult;
                const events = tx.result.events || {};
                
                tx.hash = events['tx.hash'] ? events['tx.hash'][0] : '';
                tx.height = txResult.height;
                tx.timestamp = new Date().toISOString(); // Websocket yanıtında timestamp olmayabilir
                
                // Transfer işlemi için sender ve receiver bilgilerini events'den al
                if (events['transfer.sender'] && events['transfer.sender'][0]) {
                    tx.sender = events['transfer.sender'][0];
                }
                
                if (events['transfer.recipient'] && events['transfer.recipient'][0]) {
                    tx.receiver = events['transfer.recipient'][0];
                }
                
                if (events['transfer.amount'] && events['transfer.amount'][0]) {
                    tx.amount = events['transfer.amount'][0];
                }
                
                // Mesaj tipini events'den belirle
                if (!msgType && events['message.action'] && events['message.action'][0]) {
                    msgType = events['message.action'][0];
                }
            } else if (tx.tx_response) {
                // Tam API yanıtı durumu
                tx.hash = tx.tx_response.txhash;
                tx.height = tx.tx_response.height;
                tx.timestamp = tx.tx_response.timestamp;
                tx.tx = tx.tx_response.tx || tx.tx;
            } else {
                // Doğrudan hash değerini al
                tx.hash = tx.hash || tx.txhash;
            }
            
            // Transaction tipine göre parse işlemini yap
            switch (txType) {
                case BBNTransactionType.TRANSFER:
                    return this.parseTransferTransaction(tx, network);
                case BBNTransactionType.STAKE:
                    return this.parseStakeTransaction(tx, network);
                case BBNTransactionType.UNSTAKE:
                    return this.parseUnstakeTransaction(tx, network);
                case BBNTransactionType.REWARD:
                    return this.parseRewardTransaction(tx, network);
                default:
                    return this.parseDefaultTransaction(tx, network);
            }
        } catch (error) {
            let txHash = 'unknown';
            if (tx.hash || tx.txhash) {
                txHash = tx.hash || tx.txhash;
            } else if (tx.tx_response && tx.tx_response.txhash) {
                txHash = tx.tx_response.txhash;
            } else if (tx.result && tx.result.events && tx.result.events['tx.hash']) {
                txHash = tx.result.events['tx.hash'][0];
            }
            
            logger.error(`Error parsing transaction ${txHash}:`, error);
            return null;
        }
    }

    private determineTransactionType(msgType: string): BBNTransactionType {
        if (msgType.includes('MsgSend') || msgType.includes('transfer')) {
            return BBNTransactionType.TRANSFER;
        } else if (msgType.includes('MsgDelegate') || msgType.includes('delegate')) {
            return BBNTransactionType.STAKE;
        } else if (msgType.includes('MsgUndelegate') || msgType.includes('undelegate')) {
            return BBNTransactionType.UNSTAKE;
        } else if (msgType.includes('MsgWithdrawDelegatorReward') || msgType.includes('withdraw_delegator_reward')) {
            return BBNTransactionType.REWARD;
        } else {
            return BBNTransactionType.OTHER;
        }
    }

    private parseTransferTransaction(tx: any, network: Network): BBNTransactionData {
        if (!tx.hash) {
            throw new Error('Transaction hash is required');
        }
        
        let sender = 'unknown';
        let receiver = 'unknown';
        let amount = 0;
        let denom = 'ubbn';
        let blockHeight = 0;
        let timestamp = Math.floor(Date.now() / 1000);
        let status = BBNTransactionStatus.SUCCESS;
        let fee = 0;
        let memo = '';
        
        // Websocket yanıtı durumu
        if (tx.result && tx.result.data && tx.result.data.value && tx.result.data.value.TxResult) {
            const txResult = tx.result.data.value.TxResult;
            const events = tx.result.events || {};
            
            blockHeight = parseInt(txResult.height) || 0;
            
            // Transfer bilgilerini events'den al
            if (events['transfer.sender'] && events['transfer.sender'][0]) {
                sender = events['transfer.sender'][0];
            }
            
            if (events['transfer.recipient'] && events['transfer.recipient'][0]) {
                receiver = events['transfer.recipient'][0];
            }
            
            if (events['transfer.amount'] && events['transfer.amount'][0]) {
                const amountStr = events['transfer.amount'][0];
                // "12523ubbn" gibi bir string'i parse et
                const match = amountStr.match(/^(\d+)(\w+)$/);
                if (match) {
                    amount = parseInt(match[1]) / 1000000; // ubbn to bbn
                    denom = match[2];
                }
            }
            
            // Fee bilgisini al
            if (events['tx.fee'] && events['tx.fee'][0]) {
                const feeStr = events['tx.fee'][0];
                const match = feeStr.match(/^(\d+)(\w+)$/);
                if (match) {
                    fee = parseInt(match[1]);
                }
            }
            
            // Status bilgisini al
            status = txResult.result && txResult.result.code === 0 ? BBNTransactionStatus.SUCCESS : BBNTransactionStatus.FAILED;
            
            // Timestamp bilgisini al (eğer varsa)
            if (events['tx.timestamp'] && events['tx.timestamp'][0]) {
                timestamp = this.parseTimestamp(events['tx.timestamp'][0]);
            } else {
                timestamp = Math.floor(Date.now() / 1000);
            }
        } else {
            // Normal API yanıtı durumu
            const message = tx.tx?.body?.messages?.[0] || {};
            sender = message.from_address || tx.sender || 'unknown';
            receiver = message.to_address || tx.receiver || 'unknown';
            amount = this.parseAmount(message.amount || tx.amount);
            denom = this.parseDenom(message.amount || tx.amount);
            blockHeight = tx.height || 0;
            timestamp = this.parseTimestamp(tx.timestamp);
            status = tx.code === 0 ? BBNTransactionStatus.SUCCESS : BBNTransactionStatus.FAILED;
            fee = this.parseFee(tx);
            memo = tx.tx?.body?.memo || '';
        }
        
        return {
            txHash: tx.hash,
            sender,
            receiver,
            amount,
            denom,
            type: BBNTransactionType.TRANSFER,
            blockHeight,
            timestamp,
            status,
            fee,
            memo,
            networkType: network
        };
    }

    private parseStakeTransaction(tx: any, network: Network): BBNTransactionData {
        if (!tx.hash) {
            throw new Error('Transaction hash is required');
        }
        
        let sender = 'unknown';
        let receiver = 'unknown';
        let amount = 0;
        let denom = 'ubbn';
        let blockHeight = 0;
        let timestamp = Math.floor(Date.now() / 1000);
        let status = BBNTransactionStatus.SUCCESS;
        let fee = 0;
        let memo = '';
        
        // Websocket yanıtı durumu
        if (tx.result && tx.result.data && tx.result.data.value && tx.result.data.value.TxResult) {
            const txResult = tx.result.data.value.TxResult;
            const events = tx.result.events || {};
            
            blockHeight = parseInt(txResult.height) || 0;
            
            // Stake bilgilerini events'den al
            if (events['message.sender'] && events['message.sender'][0]) {
                sender = events['message.sender'][0];
            }
            
            // Validator adresini bulmaya çalış
            if (events['delegate.validator'] && events['delegate.validator'][0]) {
                receiver = events['delegate.validator'][0];
            }
            
            // Miktar bilgisini al
            if (events['delegate.amount'] && events['delegate.amount'][0]) {
                const amountStr = events['delegate.amount'][0];
                const match = amountStr.match(/^(\d+)(\w+)$/);
                if (match) {
                    amount = parseInt(match[1]) / 1000000; // ubbn to bbn
                    denom = match[2];
                }
            }
            
            // Fee bilgisini al
            if (events['tx.fee'] && events['tx.fee'][0]) {
                const feeStr = events['tx.fee'][0];
                const match = feeStr.match(/^(\d+)(\w+)$/);
                if (match) {
                    fee = parseInt(match[1]);
                }
            }
            
            // Status bilgisini al
            status = txResult.result && txResult.result.code === 0 ? BBNTransactionStatus.SUCCESS : BBNTransactionStatus.FAILED;
            
            // Timestamp bilgisini al (eğer varsa)
            if (events['tx.timestamp'] && events['tx.timestamp'][0]) {
                timestamp = this.parseTimestamp(events['tx.timestamp'][0]);
            } else {
                timestamp = Math.floor(Date.now() / 1000);
            }
        } else {
            // Normal API yanıtı durumu
            const message = tx.tx?.body?.messages?.[0] || {};
            sender = message.delegator_address || tx.sender || 'unknown';
            receiver = message.validator_address || tx.receiver || 'unknown';
            amount = this.parseAmount(message.amount || tx.amount);
            denom = this.parseDenom(message.amount || tx.amount);
            blockHeight = tx.height || 0;
            timestamp = this.parseTimestamp(tx.timestamp);
            status = tx.code === 0 ? BBNTransactionStatus.SUCCESS : BBNTransactionStatus.FAILED;
            fee = this.parseFee(tx);
            memo = tx.tx?.body?.memo || '';
        }
        
        return {
            txHash: tx.hash,
            sender,
            receiver,
            amount,
            denom,
            type: BBNTransactionType.STAKE,
            blockHeight,
            timestamp,
            status,
            fee,
            memo,
            networkType: network
        };
    }

    private parseUnstakeTransaction(tx: any, network: Network): BBNTransactionData {
        if (!tx.hash) {
            throw new Error('Transaction hash is required');
        }
        
        let sender = 'unknown';
        let receiver = 'unknown';
        let amount = 0;
        let denom = 'ubbn';
        let blockHeight = 0;
        let timestamp = Math.floor(Date.now() / 1000);
        let status = BBNTransactionStatus.SUCCESS;
        let fee = 0;
        let memo = '';
        
        // Websocket yanıtı durumu
        if (tx.result && tx.result.data && tx.result.data.value && tx.result.data.value.TxResult) {
            const txResult = tx.result.data.value.TxResult;
            const events = tx.result.events || {};
            
            blockHeight = parseInt(txResult.height) || 0;
            
            // Unstake bilgilerini events'den al
            if (events['message.sender'] && events['message.sender'][0]) {
                sender = events['message.sender'][0];
            }
            
            // Validator adresini bulmaya çalış
            if (events['unbond.validator'] && events['unbond.validator'][0]) {
                receiver = events['unbond.validator'][0];
            }
            
            // Miktar bilgisini al
            if (events['unbond.amount'] && events['unbond.amount'][0]) {
                const amountStr = events['unbond.amount'][0];
                const match = amountStr.match(/^(\d+)(\w+)$/);
                if (match) {
                    amount = parseInt(match[1]) / 1000000; // ubbn to bbn
                    denom = match[2];
                }
            }
            
            // Fee bilgisini al
            if (events['tx.fee'] && events['tx.fee'][0]) {
                const feeStr = events['tx.fee'][0];
                const match = feeStr.match(/^(\d+)(\w+)$/);
                if (match) {
                    fee = parseInt(match[1]);
                }
            }
            
            // Status bilgisini al
            status = txResult.result && txResult.result.code === 0 ? BBNTransactionStatus.SUCCESS : BBNTransactionStatus.FAILED;
            
            // Timestamp bilgisini al (eğer varsa)
            if (events['tx.timestamp'] && events['tx.timestamp'][0]) {
                timestamp = this.parseTimestamp(events['tx.timestamp'][0]);
            } else {
                timestamp = Math.floor(Date.now() / 1000);
            }
        } else {
            // Normal API yanıtı durumu
            const message = tx.tx?.body?.messages?.[0] || {};
            sender = message.delegator_address || tx.sender || 'unknown';
            receiver = message.validator_address || tx.receiver || 'unknown';
            amount = this.parseAmount(message.amount || tx.amount);
            denom = this.parseDenom(message.amount || tx.amount);
            blockHeight = tx.height || 0;
            timestamp = this.parseTimestamp(tx.timestamp);
            status = tx.code === 0 ? BBNTransactionStatus.SUCCESS : BBNTransactionStatus.FAILED;
            fee = this.parseFee(tx);
            memo = tx.tx?.body?.memo || '';
        }
        
        return {
            txHash: tx.hash,
            sender,
            receiver,
            amount,
            denom,
            type: BBNTransactionType.UNSTAKE,
            blockHeight,
            timestamp,
            status,
            fee,
            memo,
            networkType: network
        };
    }

    private parseRewardTransaction(tx: any, network: Network): BBNTransactionData {
        if (!tx.hash) {
            throw new Error('Transaction hash is required');
        }
        
        let sender = 'unknown';
        let receiver = 'unknown';
        let amount = 0;
        let denom = 'ubbn';
        let blockHeight = 0;
        let timestamp = Math.floor(Date.now() / 1000);
        let status = BBNTransactionStatus.SUCCESS;
        let fee = 0;
        let memo = '';
        
        // Websocket yanıtı durumu
        if (tx.result && tx.result.data && tx.result.data.value && tx.result.data.value.TxResult) {
            const txResult = tx.result.data.value.TxResult;
            const events = tx.result.events || {};
            
            blockHeight = parseInt(txResult.height) || 0;
            
            // Reward bilgilerini events'den al
            if (events['message.sender'] && events['message.sender'][0]) {
                sender = events['message.sender'][0];
            }
            
            // Validator adresini bulmaya çalış
            if (events['withdraw_rewards.validator'] && events['withdraw_rewards.validator'][0]) {
                receiver = events['withdraw_rewards.validator'][0];
            }
            
            // Miktar bilgisini al - reward miktarı genellikle events'de bulunur
            if (events['withdraw_rewards.amount'] && events['withdraw_rewards.amount'][0]) {
                const amountStr = events['withdraw_rewards.amount'][0];
                const match = amountStr.match(/^(\d+)(\w+)$/);
                if (match) {
                    amount = parseInt(match[1]) / 1000000; // ubbn to bbn
                    denom = match[2];
                }
            }
            
            // Fee bilgisini al
            if (events['tx.fee'] && events['tx.fee'][0]) {
                const feeStr = events['tx.fee'][0];
                const match = feeStr.match(/^(\d+)(\w+)$/);
                if (match) {
                    fee = parseInt(match[1]);
                }
            }
            
            // Status bilgisini al
            status = txResult.result && txResult.result.code === 0 ? BBNTransactionStatus.SUCCESS : BBNTransactionStatus.FAILED;
            
            // Timestamp bilgisini al (eğer varsa)
            if (events['tx.timestamp'] && events['tx.timestamp'][0]) {
                timestamp = this.parseTimestamp(events['tx.timestamp'][0]);
            } else {
                timestamp = Math.floor(Date.now() / 1000);
            }
        } else {
            // Normal API yanıtı durumu
            const message = tx.tx?.body?.messages?.[0] || {};
            sender = message.delegator_address || tx.sender || 'unknown';
            receiver = message.validator_address || tx.receiver || 'unknown';
            amount = 0; // Reward miktarı events'den alınmalı
            denom = 'ubbn';
            blockHeight = tx.height || 0;
            timestamp = this.parseTimestamp(tx.timestamp);
            status = tx.code === 0 ? BBNTransactionStatus.SUCCESS : BBNTransactionStatus.FAILED;
            fee = this.parseFee(tx);
            memo = tx.tx?.body?.memo || '';
        }
        
        return {
            txHash: tx.hash,
            sender,
            receiver,
            amount,
            denom,
            type: BBNTransactionType.REWARD,
            blockHeight,
            timestamp,
            status,
            fee,
            memo,
            networkType: network
        };
    }

    private parseDefaultTransaction(tx: any, network: Network): BBNTransactionData {
        if (!tx.hash) {
            throw new Error('Transaction hash is required');
        }
        
        let sender = 'unknown';
        let receiver = 'unknown';
        let amount = 0;
        let denom = 'ubbn';
        let blockHeight = 0;
        let timestamp = Math.floor(Date.now() / 1000);
        let status = BBNTransactionStatus.SUCCESS;
        let fee = 0;
        let memo = '';
        
        // Websocket yanıtı durumu
        if (tx.result && tx.result.data && tx.result.data.value && tx.result.data.value.TxResult) {
            const txResult = tx.result.data.value.TxResult;
            const events = tx.result.events || {};
            
            blockHeight = parseInt(txResult.height) || 0;
            
            // Genel bilgileri events'den al
            if (events['message.sender'] && events['message.sender'][0]) {
                sender = events['message.sender'][0];
            }
            
            // Receiver bilgisini bulmaya çalış
            if (events['message.recipient'] && events['message.recipient'][0]) {
                receiver = events['message.recipient'][0];
            }
            
            // Fee bilgisini al
            if (events['tx.fee'] && events['tx.fee'][0]) {
                const feeStr = events['tx.fee'][0];
                const match = feeStr.match(/^(\d+)(\w+)$/);
                if (match) {
                    fee = parseInt(match[1]);
                }
            }
            
            // Status bilgisini al
            status = txResult.result && txResult.result.code === 0 ? BBNTransactionStatus.SUCCESS : BBNTransactionStatus.FAILED;
            
            // Timestamp bilgisini al (eğer varsa)
            if (events['tx.timestamp'] && events['tx.timestamp'][0]) {
                timestamp = this.parseTimestamp(events['tx.timestamp'][0]);
            } else {
                timestamp = Math.floor(Date.now() / 1000);
            }
        } else {
            // Normal API yanıtı durumu
            const message = tx.tx?.body?.messages?.[0] || {};
            sender = message.sender || tx.sender || 'unknown';
            receiver = message.receiver || tx.receiver || 'unknown';
            amount = 0;
            denom = 'ubbn';
            blockHeight = tx.height || 0;
            timestamp = this.parseTimestamp(tx.timestamp);
            status = tx.code === 0 ? BBNTransactionStatus.SUCCESS : BBNTransactionStatus.FAILED;
            fee = this.parseFee(tx);
            memo = tx.tx?.body?.memo || '';
        }
        
        return {
            txHash: tx.hash,
            sender,
            receiver,
            amount,
            denom,
            type: BBNTransactionType.OTHER,
            blockHeight,
            timestamp,
            status,
            fee,
            memo,
            networkType: network
        };
    }

    private parseAmount(amount: any): number {
        try {
            if (!amount) return 0;
            
            if (typeof amount === 'string') {
                return parseFloat(amount) / 1000000; // ubbn to bbn
            }
            
            if (typeof amount === 'object' && amount.amount) {
                return parseFloat(amount.amount) / 1000000;
            }
            
            return 0;
        } catch (error) {
            logger.error('Error parsing amount:', error);
            return 0;
        }
    }

    private parseDenom(amount: any): string {
        try {
            if (!amount) return 'ubbn';
            
            if (typeof amount === 'object' && amount.denom) {
                return amount.denom.toLowerCase();
            }
            
            return 'ubbn';
        } catch (error) {
            logger.error('Error parsing denom:', error);
            return 'ubbn';
        }
    }

    private parseTimestamp(timestamp: any): number {
        try {
            if (!timestamp) {
                return Math.floor(Date.now() / 1000);
            }

            if (typeof timestamp === 'string') {
                const date = new Date(timestamp);
                if (isNaN(date.getTime())) {
                    return Math.floor(Date.now() / 1000);
                }
                return Math.floor(date.getTime() / 1000);
            }

            if (typeof timestamp === 'number') {
                return timestamp;
            }

            return Math.floor(Date.now() / 1000);
        } catch (error) {
            logger.error('Error parsing timestamp:', error);
            return Math.floor(Date.now() / 1000);
        }
    }

    private parseFee(tx: any): number {
        try {
            const fee = tx.auth_info?.fee?.amount?.[0]?.amount;
            return fee ? parseFloat(fee) : 0;
        } catch (error) {
            logger.error('Error parsing fee:', error);
            return 0;
        }
    }
} 