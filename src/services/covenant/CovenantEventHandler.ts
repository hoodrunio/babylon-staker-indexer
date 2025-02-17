import { Network } from '../../types/finality';
import { CovenantSignatureService } from './CovenantSignatureService';
import { getTxHash } from '../../utils/generate-tx-hash';
import { logger } from '../../utils/logger';
import covenantMembers from '../../config/covenant-members.json';

interface TxData {
    height: number;
    hash: string;
    events: any[];
}

export class CovenantEventHandler {
    private static instance: CovenantEventHandler | null = null;
    private covenantSignatureService: CovenantSignatureService;

    private constructor() {
        this.covenantSignatureService = new CovenantSignatureService();
    }

    public static getInstance(): CovenantEventHandler {
        if (!CovenantEventHandler.instance) {
            CovenantEventHandler.instance = new CovenantEventHandler();
        }
        return CovenantEventHandler.instance;
    }

    public async handleEvent(txData: TxData, network: Network): Promise<void> {
        try {
            const { height, events } = txData;

            // Capture EventBTCDelegationCreated event
            const delegationCreatedEvent = events.find(event => 
                event.type === 'babylon.btcstaking.v1.EventBTCDelegationCreated'
            );

            if (delegationCreatedEvent) {
                const stakingTxHex = this.findAttributeValue(delegationCreatedEvent, 'staking_tx_hex');
                const stakingTxIdHex = this.extractTxId(stakingTxHex);
                const covenantMembers = this.getCovenantMembers(network);

                if (stakingTxIdHex && covenantMembers.length > 0) {
                    await this.covenantSignatureService.createPendingSignatures(
                        stakingTxIdHex,
                        network,
                        covenantMembers,
                        height
                    );
                }
            }

            // Capture EventCovenantSignatureReceived event
            const signatureReceivedEvent = events.find(event =>
                event.type === 'babylon.btcstaking.v1.EventCovenantSignatureReceived'
            );

            if (signatureReceivedEvent) {
                const stakingTxHash = this.findAttributeValue(signatureReceivedEvent, 'staking_tx_hash');
                const covenantBtcPkHex = this.findAttributeValue(signatureReceivedEvent, 'covenant_btc_pk_hex');
                const signatureHex = this.findAttributeValue(signatureReceivedEvent, 'covenant_unbonding_signature_hex');

                if (stakingTxHash && covenantBtcPkHex && signatureHex) {
                    await this.covenantSignatureService.recordSignature(
                        stakingTxHash,
                        covenantBtcPkHex,
                        signatureHex,
                        'STAKING', // or 'UNBONDING', to be determined according to the context
                        network,
                        height
                    );
                }
            }

            // Capture EventBTCDelegationStateUpdate event
            const stateUpdateEvent = events.find(event =>
                event.type === 'babylon.btcstaking.v1.EventBTCDelegationStateUpdate'
            );

            if (stateUpdateEvent) {
                const stakingTxHash = this.findAttributeValue(stateUpdateEvent, 'staking_tx_hash');
                const newState = this.findAttributeValue(stateUpdateEvent, 'new_state');

                if (stakingTxHash && newState) {
                    await this.covenantSignatureService.handleStateChange(
                        stakingTxHash,
                        newState,
                        network
                    );
                }
            }

        } catch (error) {
            logger.error(`[Covenant] Error handling event: ${error}`);
            throw error;
        }
    }

    private findAttributeValue(event: any, key: string): string | null {
        const attribute = event.attributes?.find((attr: any) => attr.key === key);
        return attribute ? attribute.value.replace(/^"|"$/g, '') : null; // Remove quotes if present
    }

    private extractTxId(txHex: string | null): string | null {
        if (!txHex) return null;
        return getTxHash(txHex, false);
    }

    private getCovenantMembers(network: Network): string[] {
        try {
            // Select public key list according to network
            const keyField = network === Network.MAINNET ? 'mainnetPublicKeys' : 'testnetPublicKeys';
            
            // Collect public keys of all members
            const allKeys = covenantMembers.reduce((keys: string[], member) => {
                return keys.concat(member[keyField] || []);
            }, []);

            if (allKeys.length === 0) {
                logger.warn(`[Covenant] No covenant members found for ${network}`);
            }

            return allKeys;
        } catch (error) {
            logger.error(`[Covenant] Error getting covenant members: ${error}`);
            return [];
        }
    }
}