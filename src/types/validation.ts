export interface ValidationConfig {
    minStakingTime: number;
    maxStakingTime: number;
    minStakeAmount: number;
    maxStakeAmount: number;
    allowedVersions: number[];
    stakingCap?: number;
}

export interface ValidationError {
    code: string;
    message: string;
    severity: 'ERROR' | 'WARNING';
    data?: any;
}

export interface ParsedOpReturn {
    version: number;
    staker_public_key: string;
    finality_provider: string;
    staking_time: number;
    validationResult: {
        isValid: boolean;
        errors: ValidationError[];
    };
}
