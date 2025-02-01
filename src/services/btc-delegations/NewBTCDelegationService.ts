import { Network } from '../../types/finality';
import { NewBTCDelegation } from '../../database/models/NewBTCDelegation';
import { DelegationResponse } from '../../types/finality/btcstaking';
import { formatSatoshis } from '../../utils/util';
import { getTxHash } from '../../utils/generate-tx-hash';
import { extractAmountFromBTCTransaction, extractAddressesFromTransaction } from '../../utils/btc-transaction';

export class NewBTCDelegationService {
    private static instance: NewBTCDelegationService | null = null;

    private constructor() {}

    public static getInstance(): NewBTCDelegationService {
        if (!NewBTCDelegationService.instance) {
            NewBTCDelegationService.instance = new NewBTCDelegationService();
        }
        return NewBTCDelegationService.instance;
    }

    public async createDelegation(data: {
        stakingTxHex: string;
        stakerAddress: string;
        stakerBtcAddress: string;
        stakerBtcPkHex: string;
        finalityProviderBtcPksHex: string[];
        stakingTime: number;
        unbondingTime: number;
        totalSat: number;
        startHeight: number;
        networkType: 'mainnet' | 'testnet';
        txHash: string;
        blockHeight: number;
        unbondingTxHex?: string;
        unbondingTxIdHex?: string;
    }) {
        const stakingTxIdHex = getTxHash(data.stakingTxHex, false);
        
        const delegation = new NewBTCDelegation({
            ...data,
            stakingTxIdHex,
            state: 'PENDING'
        });
        return delegation.save();
    }

    public async updateDelegationState(
        stakingTxIdHex: string, 
        state: string, 
        network: Network,
        endHeight?: number,
        startHeight?: number
    ) {
        try {
            console.log('Updating delegation state:', {
                stakingTxIdHex,
                state,
                network,
                networkType: network.toLowerCase(),
                endHeight,
                startHeight
            });

            const updateData: any = { state };
            if (endHeight !== undefined) updateData.endHeight = endHeight;
            if (startHeight !== undefined) updateData.startHeight = startHeight;

            const result = await NewBTCDelegation.findOneAndUpdate(
                { 
                    stakingTxIdHex,
                    networkType: network.toLowerCase()
                },
                updateData,
                { new: true }
            );

            if (!result) {
                console.error('No delegation found to update:', {
                    stakingTxIdHex,
                    network: network.toLowerCase()
                });
                return null;
            }

            console.log('Delegation state updated successfully:', {
                stakingTxIdHex,
                oldState: result.state,
                newState: state,
                oldStartHeight: result.startHeight,
                newStartHeight: startHeight,
                oldEndHeight: result.endHeight,
                newEndHeight: endHeight
            });

            return result;
        } catch (error) {
            console.error('Error updating delegation state:', error);
            throw error;
        }
    }

    public async updateUnbondingInfo(stakingTxHex: string, network: Network, unbondingTxHex: string) {
        const unbondingTxIdHex = getTxHash(unbondingTxHex, false);
        
        return NewBTCDelegation.findOneAndUpdate(
            { stakingTxHex, networkType: network.toLowerCase() },
            { 
                unbondingTxHex,
                unbondingTxIdHex,
                state: 'UNBONDED'
            },
            { new: true }
        );
    }

    public async updateSpendStakeInfo(stakingTxHex: string, network: Network, spendStakeTxHex: string) {
        const spendStakeTxIdHex = getTxHash(spendStakeTxHex, false);
        
        return NewBTCDelegation.findOneAndUpdate(
            { stakingTxHex, networkType: network.toLowerCase() },
            { 
                spendStakeTxHex,
                spendStakeTxIdHex
            },
            { new: true }
        );
    }

    public async getDelegationsByState(state: string, network: Network, page: number = 1, limit: number = 10) {
        const skip = (page - 1) * limit;
        
        const [delegations, total] = await Promise.all([
            NewBTCDelegation.find({ 
                state, 
                networkType: network.toLowerCase() 
            })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            NewBTCDelegation.countDocuments({ 
                state, 
                networkType: network.toLowerCase() 
            })
        ]);

        const formattedDelegations = delegations.map(this.formatDelegationResponse);

        return {
            delegations: formattedDelegations,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    public async getDelegationByTxHash(stakingTxHex: string, network: Network) {
        const delegation = await NewBTCDelegation.findOne({ 
            stakingTxHex, 
            networkType: network.toLowerCase() 
        });

        if (!delegation) return null;

        return this.formatDelegationResponse(delegation);
    }

    public async getDelegationByTxId(stakingTxIdHex: string, network: Network) {
        const delegation = await NewBTCDelegation.findOne({ 
            stakingTxIdHex, 
            networkType: network.toLowerCase() 
        });

        if (!delegation) return null;

        return this.formatDelegationResponse(delegation);
    }

    private formatDelegationResponse(delegation: any): DelegationResponse {
        return {
            staker_address: delegation.stakerAddress,
            status: delegation.state,
            btc_pk_hex: delegation.stakerBtcPkHex,
            amount: formatSatoshis(delegation.totalSat),
            amount_sat: delegation.totalSat,
            start_height: delegation.startHeight,
            end_height: delegation.endHeight || 0,
            duration: delegation.stakingTime,
            transaction_id_hex: delegation.stakingTxIdHex,
            transaction_id: delegation.stakingTxHex,
            active: delegation.state === 'ACTIVE',
            unbonding_time: delegation.unbondingTime,
            unbonding: delegation.unbondingTxHex ? {
                transaction_id: delegation.unbondingTxHex,
                transaction_id_hex: delegation.unbondingTxIdHex,
                spend_transaction_id: delegation.spendStakeTxHex,
                spend_transaction_id_hex: delegation.spendStakeTxIdHex
            } : undefined
        };
    }

    public async handleNewDelegationFromWebsocket(eventData: any, network: Network) {
        const attributes = this.parseEventAttributes(eventData);
        
        if (!attributes) {
            console.error('Failed to parse websocket event attributes');
            return null;
        }

        // Extract amount from staking transaction
        const totalSat = extractAmountFromBTCTransaction(attributes.staking_tx_hex);
        if (!totalSat) {
            console.warn('Failed to extract amount from staking transaction:', {
                stakingTxHex: attributes.staking_tx_hex
            });
        }

        // Extract addresses from staking transaction
        const stakingTxHex = attributes.staking_tx_hex;
        console.log('Transaction before parsing:', stakingTxHex);
        console.log('Transaction type:', typeof stakingTxHex);

        // Parse if it's a JSON string
        const parsedTxHex = typeof stakingTxHex === 'string' && stakingTxHex.startsWith('"') 
            ? JSON.parse(stakingTxHex) 
            : stakingTxHex;

        const addresses = await extractAddressesFromTransaction(parsedTxHex);
        if (!addresses.sender) {
            console.warn('Failed to extract sender address from staking transaction:', {
                stakingTxHex: attributes.staking_tx_hex
            });
        }

        const delegationData = {
            stakingTxHex: attributes.staking_tx_hex,
            stakerAddress: attributes.staker_address, // Event'ten gelen pubkey formatındaki adres
            stakerBtcAddress: addresses.sender || '', // Transaction'dan çıkarılan BTC adresi, bulunamazsa boş string
            stakerBtcPkHex: attributes.staker_btc_pk_hex,
            finalityProviderBtcPksHex: attributes.finality_provider_btc_pks_hex,
            stakingTime: parseInt(attributes.staking_time),
            unbondingTime: parseInt(attributes.unbonding_time),
            totalSat: totalSat || 0,
            startHeight: parseInt(attributes.start_height || '0'),
            txHash: eventData.hash,
            blockHeight: eventData.height,
            networkType: network.toLowerCase() as 'mainnet' | 'testnet',
            unbondingTxHex: attributes.unbonding_tx || undefined,
            unbondingTxIdHex: attributes.unbonding_tx ? getTxHash(attributes.unbonding_tx, false) : undefined
        };

        try {
            const existingDelegation = await this.getDelegationByTxHash(delegationData.stakingTxHex, network);
            if (existingDelegation) {
                console.log(`Delegation already exists for tx: ${delegationData.stakingTxHex}`);
                return existingDelegation;
            }

            const newDelegation = await this.createDelegation(delegationData);
            console.log(`Created new delegation from websocket event: ${newDelegation.txHash}, amount: ${formatSatoshis(totalSat)} BTC`);
            return this.formatDelegationResponse(newDelegation);
        } catch (error) {
            console.error('Error handling new delegation from websocket:', error);
            throw error;
        }
    }

    private parseEventAttributes(eventData: any): any {
        try {
            console.log('Received event data:', JSON.stringify(eventData).substring(0, 100));
            
            // Event verisi events içinde geliyor
            const events = eventData.events;
            if (!events) {
                console.warn('No events found in event data');
                return null;
            }

            // console.log('Event keys:', Object.keys(events));

            // BTCDelegationCreated event'ini bul
            const btcDelegationEvent = events.find((event: any) => 
                event.type === 'babylon.btcstaking.v1.EventBTCDelegationCreated'
            );

            if (!btcDelegationEvent) {
                console.warn('No BTCDelegationCreated event found');
                return null;
            }

            // Event attribute'larını map'e dönüştür
            const attributes = btcDelegationEvent.attributes.reduce((acc: any, attr: any) => {
                acc[attr.key] = attr.value;
                return acc;
            }, {});

            // Sender bilgisini message event'inden al
            const messageEvent = events.find((event: any) => 
                event.type === 'message' && 
                event.attributes.some((attr: any) => attr.key === 'sender')
            );
            const senderAttr = messageEvent?.attributes.find((attr: any) => attr.key === 'sender');

            if (!attributes.staking_tx_hex || !attributes.staker_btc_pk_hex || !attributes.finality_provider_btc_pks_hex) {
                console.warn('Missing required event attributes:', {
                    hasStakingTxHex: !!attributes.staking_tx_hex,
                    hasStakerBtcPkHex: !!attributes.staker_btc_pk_hex,
                    hasFinalityProviderBtcPksHex: !!attributes.finality_provider_btc_pks_hex
                });
                return null;
            }

            console.log('Raw staking_tx_hex:', attributes.staking_tx_hex);
            console.log('Parsed staking_tx_hex:', JSON.parse(attributes.staking_tx_hex));

            const result = {
                staking_tx_hex: JSON.parse(attributes.staking_tx_hex),
                staker_btc_pk_hex: JSON.parse(attributes.staker_btc_pk_hex),
                finality_provider_btc_pks_hex: JSON.parse(attributes.finality_provider_btc_pks_hex),
                staking_time: attributes.staking_time ? JSON.parse(attributes.staking_time) : undefined,
                unbonding_time: attributes.unbonding_time ? JSON.parse(attributes.unbonding_time) : undefined,
                staker_address: senderAttr?.value,
                start_height: eventData.height,
                total_sat: attributes.total_sat ? JSON.parse(attributes.total_sat) : undefined,
                unbonding_tx: attributes.unbonding_tx ? JSON.parse(attributes.unbonding_tx) : undefined
            };

            // console.log('Parsed result:', result);
            return result;
        } catch (error: any) {
            console.error('Error parsing websocket event attributes:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack
            });
            return null;
        }
    }
} 
