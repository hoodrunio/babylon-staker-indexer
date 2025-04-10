import { logger } from './logger';

interface MessageContent {
    type: string;
    content: any;
}

export class ProposalMessageParser {
    private static messageHandlers: { [key: string]: (msg: any) => any } = {
        '/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade': (msg: any) => ({
            plan: {
                name: msg.plan.name,
                height: msg.plan.height,
                info: msg.plan.info,
                time: msg.plan.time
            }
        }),

        '/babylon.btcstaking.v1.MsgUpdateParams': (msg: any) => ({
            params: {
                covenant_pks: msg.params.covenant_pks,
                covenant_quorum: msg.params.covenant_quorum,
                min_staking_value_sat: msg.params.min_staking_value_sat,
                max_staking_value_sat: msg.params.max_staking_value_sat,
                min_staking_time_blocks: msg.params.min_staking_time_blocks,
                max_staking_time_blocks: msg.params.max_staking_time_blocks,
                min_slashing_tx_fee_sat: msg.params.min_slashing_tx_fee_sat,
                slashing_rate: msg.params.slashing_rate,
                unbonding_time_blocks: msg.params.unbonding_time_blocks,
                unbonding_fee_sat: msg.params.unbonding_fee_sat,
                min_commission_rate: msg.params.min_commission_rate,
                btc_activation_height: msg.params.btc_activation_height
            }
        }),

        '/cosmos.distribution.v1beta1.MsgUpdateParams': (msg: any) => ({
            params: {
                community_tax: msg.params.community_tax,
                base_proposer_reward: msg.params.base_proposer_reward,
                bonus_proposer_reward: msg.params.bonus_proposer_reward,
                withdraw_addr_enabled: msg.params.withdraw_addr_enabled
            }
        }),

        '/ibc.core.client.v1.MsgRecoverClient': (msg: any) => ({
            subject_client_id: msg.subject_client_id,
            substitute_client_id: msg.substitute_client_id,
            signer: msg.signer
        }),

        '/babylon.finality.v1.MsgResumeFinalityProposal': (msg: any) => ({
            authority: msg.authority,
            fp_pks_hex: msg.fp_pks_hex,
            halting_height: msg.halting_height
        }),
        
        '/cosmwasm.wasm.v1.MsgAddCodeUploadParamsAddresses': (msg: any) => ({
            authority: msg.authority,
            addresses: msg.addresses
        })
    };

    public static parseMessage(msg: any): MessageContent {
        const messageType = msg['@type'];
        const handler = this.messageHandlers[messageType];

        if (handler) {
            return {
                type: messageType,
                content: handler(msg)
            };
        }

        logger.warn(`[ProposalMessageParser] Unknown message type: ${messageType}`);
        return {
            type: messageType,
            content: msg
        };
    }

    public static registerMessageHandler(type: string, handler: (msg: any) => any): void {
        this.messageHandlers[type] = handler;
    }
} 