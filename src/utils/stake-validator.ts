import { parseOpReturn } from './op-return-parser';
import { VersionParams } from './params-validator';

export interface StakeValidationResult {
    isValid: boolean;
    hasBabylonPrefix: boolean;
    errors: string[];
    isOverflow: boolean;
    adjustedAmount: number;
    overflowAmount?: number;
    parsedOpReturn?: any;
    invalidReasons: {
        wrongOutputCount: boolean;
        noOpReturn: boolean;
        invalidOpReturn: boolean;
        invalidAmount: boolean;
        invalidStakingTime: boolean;
        invalidTaprootKey: boolean;
    };
}

// Constants for OP_RETURN validation
const OP_RETURN_PREFIX = '6a47';
const BABYLON_TAG = '62626e31';
const EXPECTED_LENGTH = 146; // 73 bytes in hex

function validateOpReturnFormat(hexData: string, params: VersionParams): string[] {
    const errors: string[] = [];

    // 1. Basic format validation
    if (!hexData.startsWith(OP_RETURN_PREFIX)) {
        errors.push('INVALID_OP_RETURN_PREFIX');
        return errors;
    }

    // 2. Length validation (73 bytes = 146 hex chars)
    if (hexData.length !== EXPECTED_LENGTH) {
        errors.push(`INVALID_OP_RETURN_LENGTH: ${hexData.length/2} bytes`);
        return errors;
    }

    try {
        // 3. Parse components
        const tag = hexData.slice(4, 12);
        // const version = hexData.slice(12, 14);
        // const stakerPk = hexData.slice(14, 78);
        // const fpPk = hexData.slice(78, 142);
        const stakingTime = hexData.slice(142, 146);

        // 4. Tag validation
        if (!tag.toLowerCase().startsWith(BABYLON_TAG)) {
            errors.push(`INVALID_TAG: ${tag}`);
        }

        // 5. Staking time validation
        const stakingTimeValue = parseInt(stakingTime, 16);
        if (stakingTimeValue < params.min_staking_time || 
            stakingTimeValue > params.max_staking_time) {
            errors.push(`INVALID_STAKING_TIME: ${stakingTimeValue}`);
        }

    } catch (e) {
        errors.push(`OP_RETURN_PARSE_ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }

    return errors;
}

function isTaprootOutput(output: any): boolean {
    // Handle both RPC format and our custom format
    const script = output.scriptPubKey?.hex;
    const type = output.scriptPubKey?.type;
    return (script && script.startsWith('5120') && script.length === 68) || // Raw script format
           (type === 'witness_v1_taproot'); // RPC format
}

function findBabylonTaprootOutput(tx: any): { output: any, index: number } | null {
    // Get input addresses from vin
    const inputAddresses = tx.vin?.map((input: any) => {
        // For RPC format, we need to look at the witness_v1_taproot address
        const scriptPubKey = input.prevout?.scriptPubKey || {};
        return scriptPubKey.address || null;
    }).filter(Boolean) || [];

    // Find Taproot output that goes to a new address
    for (let i = 0; i < (tx.vout?.length || 0); i++) {
        const output = tx.vout[i];
        if (isTaprootOutput(output) && 
            output.scriptPubKey?.type === 'witness_v1_taproot' && 
            !inputAddresses.includes(output.scriptPubKey?.address)) {
            return { output, index: i };
        }
    }
    return null;
}

export async function validateStakeTransaction(
    tx: any,
    params: VersionParams,
    _height: number,
    _currentActiveStake: number
): Promise<StakeValidationResult> {
    const result: StakeValidationResult = {
        isValid: false,
        hasBabylonPrefix: false,
        errors: [],
        parsedOpReturn: null,
        adjustedAmount: 0,
        isOverflow: false,
        overflowAmount: 0,
        invalidReasons: {
            wrongOutputCount: false,
            noOpReturn: false,
            invalidOpReturn: false,
            invalidAmount: false,
            invalidStakingTime: false,
            invalidTaprootKey: false
        }
    };

    // Find and validate OP_RETURN output
    const opReturnOutput = tx.vout.find((output: any) => 
        output.scriptPubKey.hex?.startsWith('6a47') // OP_RETURN with 71 bytes of data
    );

    if (!opReturnOutput) {
        result.errors.push('NO_OP_RETURN');
        result.invalidReasons.noOpReturn = true;
        return result;
    }

    // Parse and validate OP_RETURN data
    const opReturnData = opReturnOutput.scriptPubKey.hex;
    const errors = validateOpReturnFormat(opReturnData, params);
    
    if (errors.length > 0) {
        result.errors.push(...errors);
        result.invalidReasons.invalidOpReturn = true;
        return result;
    }

    // Parse OP_RETURN data
    result.parsedOpReturn = parseOpReturn(opReturnData);
    result.hasBabylonPrefix = true;

    // Find the staking output using the OP_RETURN data
    const stakingOutput = findBabylonTaprootOutput(tx);
    
    if (!stakingOutput) {
        result.errors.push('NO_TAPROOT_OUTPUT');
        return result;
    }

    // Validate staking amount (use BigInt for precise calculations)
    const stakeAmount = BigInt(Math.floor(stakingOutput.output.value * 100000000)); // Convert to satoshis
    result.adjustedAmount = Number(stakeAmount);

    // Check if amount is below minimum
    if (stakeAmount < BigInt(params.min_staking_amount)) {
        result.errors.push('INSUFFICIENT_STAKE');
        result.invalidReasons.invalidAmount = true;
        return result;
    }

    // Check if amount exceeds max individual stake
    if (stakeAmount > BigInt(params.max_staking_amount)) {
        result.errors.push('EXCEEDS_MAX_STAKE');
        result.invalidReasons.invalidAmount = true;
        return result;
    }

    // Note: Overflow check is now handled in processBlockWithParams
    // This function only validates the basic requirements

    // Validate staking time
    const stakingTime = result.parsedOpReturn?.staking_time;
    if (stakingTime < params.min_staking_time || stakingTime > params.max_staking_time) {
        result.errors.push('INVALID_STAKING_TIME');
        result.invalidReasons.invalidStakingTime = true;
    }

    result.isValid = result.errors.length === 0;
    return result;
}
