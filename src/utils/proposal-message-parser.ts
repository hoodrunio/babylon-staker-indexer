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