export interface RewardCoin {
    denom: string;
    amount: string;
}

export interface RewardGauge {
    coins: RewardCoin[];
    withdrawn_coins: RewardCoin[];
}

export interface RewardGaugesResponse {
    reward_gauges: {
        [stakeholderType: string]: RewardGauge;
    };
}

export interface FormattedRewardCoin {
    denom: string;
    amount: string;
    display_amount: string;
}

export interface FormattedRewards {
    [stakeholderType: string]: {
        earned: FormattedRewardCoin[];
        withdrawn: FormattedRewardCoin[];
        available: FormattedRewardCoin[];
    };
}

export interface FinalityProviderRewardsSummary {
    btc_pk: string;
    babylon_address: string;
    rewards: FormattedRewards;
}
