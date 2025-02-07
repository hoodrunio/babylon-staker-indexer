import { Network } from '../../types/finality';
import { NewBTCDelegationService } from './NewBTCDelegationService';

export class BTCDelegationEventHandler {
    private static instance: BTCDelegationEventHandler | null = null;
    private delegationService: NewBTCDelegationService;

    private constructor() {
        this.delegationService = NewBTCDelegationService.getInstance();
    }

    public static getInstance(): BTCDelegationEventHandler {
        if (!BTCDelegationEventHandler.instance) {
            BTCDelegationEventHandler.instance = new BTCDelegationEventHandler();
        }
        return BTCDelegationEventHandler.instance;
    }

    public async handleEvent(txData: any, network: Network) {
        try {
            if (!txData?.events || !Array.isArray(txData.events)) {
                console.log('No valid events data in txData:', txData);
                return;
            }

            // Log incoming event data to file
            const fs = require('fs');
            const path = require('path');
            
            const logDir = path.join(__dirname, '../../../logs');
            if (!fs.existsSync(logDir)){
                fs.mkdirSync(logDir, { recursive: true });
            }

            const logFile = path.join(logDir, 'delegation_events.log');
            const timestamp = new Date().toISOString();
            
            // Skip logging for MsgCreateBTCDelegation and MsgAddCovenantSigs events
            if (!txData.events?.some((e: any) => {
                if (e.type === 'message') {
                    const action = e.attributes.find((a: any) => a.key === 'action')?.value;
                    return action === '/babylon.btcstaking.v1.MsgCreateBTCDelegation'
                }
                return false;
            })) 
            {
                console.log('Received new events.');
                const logData = {
                    timestamp,
                    network,
                    txData
                };
    
                fs.appendFileSync(
                    logFile, 
                    JSON.stringify(logData, null, 2) + '\n---\n',
                    'utf8'
                );
            }

            // Her bir event'i ayrı ayrı işle
            for (const event of txData.events) {
                let eventType = null;

                // Message action kontrolü
                if (event.type === 'message') {
                    const actionAttr = event.attributes.find((a: any) => a.key === 'action');
                    if (actionAttr?.value === '/babylon.btcstaking.v1.MsgCreateBTCDelegation') {
                        eventType = 'MsgCreateBTCDelegation';
                    }
                }
                // Diğer event tipleri kontrolü
                else {
                    switch (event.type) {
                        case 'babylon.btcstaking.v1.EventBTCDelegationStateUpdate':
                            eventType = 'EventBTCDelegationStateUpdate';
                            break;
                        case 'babylon.btcstaking.v1.EventCovenantQuorumReached':
                            eventType = 'EventCovenantQuorumReached';
                            break;
                        case 'babylon.btcstaking.v1.EventBTCDelegationInclusionProofReceived':
                            eventType = 'EventBTCDelegationInclusionProofReceived';
                            break;
                        case 'babylon.btcstaking.v1.EventBTCDelgationUnbondedEarly':
                            eventType = 'EventBTCDelgationUnbondedEarly';
                            break;
                        case 'babylon.btcstaking.v1.EventBTCDelegationExpired':
                            eventType = 'EventBTCDelegationExpired';
                            break;
                        case 'babylon.btcstaking.v1.EventBTCDelegationCreated':
                            eventType = 'MsgCreateBTCDelegation';
                            break;
                        case 'babylon.btcstaking.v1.EventCovenantSignatureReceived':
                            eventType = 'EventCovenantSignatureReceived';
                            break;
                    }
                }

                if (eventType) {
                    console.log(`Processing event: ${eventType}`);
                    switch (eventType) {
                        case 'MsgCreateBTCDelegation':
                            await this.handleDelegationEvent(txData, network);
                            break;
                        case 'EventBTCDelegationStateUpdate':
                            await this.handleDelegationStateUpdate(txData, network);
                            break;
                        case 'EventCovenantQuorumReached':
                            await this.handleCovenantQuorum(txData, network);
                            break;
                        case 'EventBTCDelegationInclusionProofReceived':
                            await this.handleInclusionProof(txData, network);
                            break;
                        case 'EventBTCDelgationUnbondedEarly':
                            await this.handleEarlyUnbonding(txData, network);
                            break;
                        case 'EventBTCDelegationExpired':
                            await this.handleDelegationExpired(txData, network);
                            break;
                        case 'EventCovenantSignatureReceived':
                            await this.handleCovenantSignature(txData, network);
                            break;
                    }
                }
            }
        } catch (error) {
            console.error('Error handling event:', error);
        }
    }

    private parseAttributeValue(attr: any): string | null {
        if (!attr?.value) return null;
        try {
            return attr.value.replace(/^"|"$/g, '');
        } catch (error) {
            console.error('Error parsing attribute value:', error);
            return null;
        }
    }

    private getAttributeValue(event: any, key: string): string | null {
        const attr = event.attributes.find((a: any) => a.key === key);
        return this.parseAttributeValue(attr);
    }

    private logEventData(eventName: string, event: any, parsedData: any) {
        /* console.log(`Raw ${eventName} event data:`, {
            event: JSON.stringify(event, null, 2)
        }); */

        console.log(`Parsed ${eventName} event data:`, parsedData);
    }

    private async handleDelegationEvent(txData: any, network: Network) {
        try {
            console.log('Handling delegation event with data');
            
            let eventDataWithHashAndSender;
            
            // Websocket event yapısı kontrolü
            if (txData.value?.TxResult) {
                // Websocket event'i
                const txResult = txData.value.TxResult;
                eventDataWithHashAndSender = {
                    ...txData,
                    events: txResult.result.events,
                    height: parseInt(txResult.height),
                    hash: txResult.tx_hash || txResult.tx, // tx_hash veya tx'den birini kullan
                    sender: txResult.result.events.find((e: any) => e.type === 'message')
                        ?.attributes.find((a: any) => a.key === 'sender')?.value
                };
            } else if (txData.events) {
                // MissedBlocksProcessor'dan gelen event
                eventDataWithHashAndSender = {
                    ...txData,
                    hash: txData.hash,
                    sender: txData.sender
                };
            } else {
                console.error('Unknown event data structure:', txData);
                return;
            }

            console.log('Processed event data:', {
                height: eventDataWithHashAndSender.height,
                hash: eventDataWithHashAndSender.hash,
                sender: eventDataWithHashAndSender.sender
            });

            await this.delegationService.handleNewDelegationFromWebsocket(eventDataWithHashAndSender, network);
        } catch (error) {
            console.error(`Error handling delegation event for ${network}:`, error);
        }
    }

    private async handleDelegationStateUpdate(txData: any, network: Network) {
        try {
            const event = txData.events.find((e: any) => 
                e.type === 'babylon.btcstaking.v1.EventBTCDelegationStateUpdate'
            );
            
            if (!event) {
                console.log('No state update event found in txData');
                return;
            }

            const stakingTxHash = this.getAttributeValue(event, 'staking_tx_hash');
            const newState = this.getAttributeValue(event, 'new_state');

            const parsedData = {
                stakingTxHash,
                newState,
                network
            };

            this.logEventData('state update', event, parsedData);

            if (!stakingTxHash || !newState) {
                console.error('Missing required attributes in state update event:', {
                    hasStakingTxHash: !!stakingTxHash,
                    hasNewState: !!newState,
                    rawEvent: event
                });
                return;
            }

            // Get existing delegation to preserve height values
            const delegation = await this.delegationService.getDelegationByTxId(stakingTxHash, network);
            if (!delegation) {
                console.error('No delegation found for staking tx id hex:', stakingTxHash);
                return;
            }

            const result = await this.delegationService.updateDelegationState(
                stakingTxHash, 
                newState, 
                network,
                delegation.end_height,
                delegation.start_height
            );
            
            if (!result) {
                console.error('Failed to update delegation state:', parsedData);
            } else {
                console.log('Successfully updated delegation state:', {
                    ...parsedData,
                    oldState: result.state,
                    oldStartHeight: result.startHeight,
                    oldEndHeight: result.endHeight
                });
            }
        } catch (error) {
            console.error('Error handling delegation state update:', error);
        }
    }

    private async handleCovenantSignature(txData: any, network: Network) {
        try {
            const event = txData.events.find((e: any) => 
                e.type === 'babylon.btcstaking.v1.EventCovenantSignatureReceived'
            );
            
            if (!event) {
                console.log('No covenant signature event found in txData');
                return;
            }

            const stakingTxHash = this.getAttributeValue(event, 'staking_tx_hash');
            const covenantBtcPkHex = this.getAttributeValue(event, 'covenant_btc_pk_hex');
            
            /* console.log('Received covenant signature:', {
                stakingTxHash,
                covenantBtcPkHex,
                network,
                allEvents: txData.events.map((e: any) => e.type)
            }); */

            // Aynı transaction içinde quorum event'i var mı kontrol et
            const hasQuorumEvent = txData.events.some((e: any) => 
                e.type === 'babylon.btcstaking.v1.EventCovenantQuorumReached'
            );

            if (hasQuorumEvent) {
                console.log('Found quorum event in the same transaction:', {
                    stakingTxHash,
                    network
                });
            }
        } catch (error) {
            console.error('Error handling covenant signature:', error);
        }
    }

    private async handleCovenantQuorum(txData: any, network: Network) {
        try {
            // Önce tüm event'leri logla
            /* console.log('Processing transaction events:', {
                allEvents: txData.events.map((e: any) => e.type),
                network
            }); */

            const event = txData.events.find((e: any) => 
                e.type === 'babylon.btcstaking.v1.EventCovenantQuorumReached'
            );
            
            if (!event) {
                console.log('No covenant quorum event found in txData');
                return;
            }

            const stakingTxHash = this.getAttributeValue(event, 'staking_tx_hash');
            const newState = this.getAttributeValue(event, 'new_state');

            const parsedData = {
                stakingTxHash,
                newState,
                network,
                rawEventType: event.type
            };

            this.logEventData('covenant quorum', event, parsedData);

            if (!stakingTxHash || !newState) {
                console.error('Missing required attributes in covenant quorum event:', {
                    hasStakingTxHash: !!stakingTxHash,
                    hasNewState: !!newState,
                    rawEvent: event
                });
                return;
            }

            // Önce delegasyonun mevcut durumunu kontrol et
            const delegation = await this.delegationService.getDelegationByTxId(stakingTxHash, network);
            
            if (!delegation) {
                console.error('Delegation not found for covenant quorum:', {
                    stakingTxHash,
                    network
                });
                return;
            }

            // Sadece PENDING durumundaysa güncelle
            if (delegation.status === 'PENDING') {
                const result = await this.delegationService.updateDelegationState(
                    stakingTxHash, 
                    newState, 
                    network
                );
                
                if (!result) {
                    console.error('Failed to update delegation state:', parsedData);
                } else {
                    console.log('Successfully updated delegation state from PENDING:', {
                        ...parsedData,
                        oldState: delegation.status
                    });
                }
            } else {
                console.log('Skipping state update, delegation is not in PENDING state:', {
                    stakingTxHash,
                    currentState: delegation.status,
                    newState
                });
            }
        } catch (error) {
            console.error('Error handling covenant quorum:', {
                error,
                txData: JSON.stringify(txData, null, 2)
            });
        }
    }

    private async handleInclusionProof(txData: any, network: Network) {
        try {
            const event = txData.events.find((e: any) => 
                e.type === 'babylon.btcstaking.v1.EventBTCDelegationInclusionProofReceived'
            );
            
            if (!event) {
                console.log('No inclusion proof event found in txData');
                return;
            }

            const stakingTxIdHex = this.getAttributeValue(event, 'staking_tx_hash');
            const newState = this.getAttributeValue(event, 'new_state');
            const startHeight = this.getAttributeValue(event, 'start_height');
            const endHeight = this.getAttributeValue(event, 'end_height');

            const parsedData = {
                stakingTxIdHex,
                newState,
                startHeight: startHeight ? parseInt(startHeight) : undefined,
                endHeight: endHeight ? parseInt(endHeight) : undefined,
                network
            };

            this.logEventData('inclusion proof', event, parsedData);

            if (!stakingTxIdHex || !newState || !startHeight || !endHeight) {
                console.error('Missing required attributes in inclusion proof event:', {
                    hasStakingTxIdHex: !!stakingTxIdHex,
                    hasNewState: !!newState,
                    hasStartHeight: !!startHeight,
                    hasEndHeight: !!endHeight,
                    rawEvent: event
                });
                return;
            }

            // Önce delegasyonun var olduğunu kontrol et
            const delegation = await this.delegationService.getDelegationByTxId(stakingTxIdHex, network);
            if (!delegation) {
                console.error('No delegation found for staking tx id hex:', stakingTxIdHex);
                return;
            }

            console.log('Found delegation for inclusion proof:', {
                stakingTxIdHex,
                currentState: delegation.status,
                newState,
                currentStartHeight: delegation.start_height,
                newStartHeight: parsedData.startHeight,
                currentEndHeight: delegation.end_height,
                newEndHeight: parsedData.endHeight
            });

            const result = await this.delegationService.updateDelegationState(
                stakingTxIdHex,
                newState, 
                network,
                parsedData.endHeight,
                parsedData.startHeight
            );
            
            if (!result) {
                console.error('Failed to update delegation state:', parsedData);
            } else {
                console.log('Successfully updated delegation state:', {
                    ...parsedData,
                    oldState: result.state,
                    oldStartHeight: result.startHeight,
                    oldEndHeight: result.endHeight
                });
            }
        } catch (error) {
            console.error('Error handling inclusion proof:', {
                error,
                txData,
                network
            });
        }
    }

    private async handleEarlyUnbonding(txData: any, network: Network) {
        try {
            const event = txData.events.find((e: any) => 
                e.type === 'babylon.btcstaking.v1.EventBTCDelgationUnbondedEarly'
            );
            
            if (!event) {
                console.log('No early unbonding event found in txData');
                return;
            }

            const stakingTxHash = this.getAttributeValue(event, 'staking_tx_hash');
            const newState = this.getAttributeValue(event, 'new_state');

            const parsedData = {
                stakingTxHash,
                newState,
                network
            };

            this.logEventData('early unbonding', event, parsedData);

            if (!stakingTxHash || !newState) {
                console.error('Missing required attributes in early unbonding event:', {
                    hasStakingTxHash: !!stakingTxHash,
                    hasNewState: !!newState,
                    rawEvent: event
                });
                return;
            }

            // Get existing delegation to preserve height values
            const delegation = await this.delegationService.getDelegationByTxId(stakingTxHash, network);
            if (!delegation) {
                console.error('No delegation found for staking tx id hex:', stakingTxHash);
                return;
            }

            const result = await this.delegationService.updateDelegationState(
                stakingTxHash, 
                newState, 
                network
            );
            
            if (!result) {
                console.error('Failed to update delegation state:', parsedData);
            } else {
                console.log('Successfully updated delegation state:', {
                    ...parsedData,
                    oldState: result.state
                });
            }
        } catch (error) {
            console.error('Error handling early unbonding:', error);
        }
    }

    private async handleDelegationExpired(txData: any, network: Network) {
        try {
            const event = txData.events.find((e: any) => 
                e.type === 'babylon.btcstaking.v1.EventBTCDelegationExpired'
            );
            
            if (!event) {
                console.log('No delegation expired event found in txData');
                return;
            }

            const stakingTxHash = this.getAttributeValue(event, 'staking_tx_hash');
            const newState = this.getAttributeValue(event, 'new_state');

            const parsedData = {
                stakingTxHash,
                newState,
                network
            };

            this.logEventData('delegation expired', event, parsedData);

            if (!stakingTxHash || !newState) {
                console.error('Missing required attributes in delegation expired event:', {
                    hasStakingTxHash: !!stakingTxHash,
                    hasNewState: !!newState,
                    rawEvent: event
                });
                return;
            }

            // Get existing delegation to preserve height values
            const delegation = await this.delegationService.getDelegationByTxId(stakingTxHash, network);
            if (!delegation) {
                console.error('No delegation found for staking tx id hex:', stakingTxHash);
                return;
            }

            const result = await this.delegationService.updateDelegationState(
                stakingTxHash, 
                newState, 
                network
            );
            
            if (!result) {
                console.error('Failed to update delegation state:', parsedData);
            } else {
                console.log('Successfully updated delegation state:', {
                    ...parsedData,
                    oldState: result.state
                });
            }
        } catch (error) {
            console.error('Error handling delegation expired:', error);
        }
    }
} 