import { BitcoinRPC } from './bitcoin-rpc.js';
import { parseOpReturn } from './op-return-parser.js';
import { VersionParams } from './params-validator.js';

interface StakeValidationResult {
    isValid: boolean;
    hasBabylonPrefix: boolean;
    errors: string[];
    isOverflow: boolean;
    adjustedAmount: number;
    overflowAmount?: number;
    parsedOpReturn?: any;
    invalidReasons: InvalidReasons;
}

interface InvalidReasons {
    wrongOutputCount: boolean;
    noOpReturn: boolean;
    invalidOpReturn: boolean;
    invalidAmount: boolean;
    invalidStakingTime: boolean;
    invalidTaprootKey: boolean;
}

interface BitcoinTransactionVin {
    txid: string;
    vout: number;
    scriptSig: any;
    txinwitness: string[];
    sequence: number;
}

interface BitcoinTransactionVout {
    value: number;
    n: number;
    scriptPubKey: any;
}

export interface BitcoinTransaction {
    txid: string;
    hash: string;
    version: number;
    size: number;
    vsize: number;
    weight: number;
    locktime: number;
    vin: BitcoinTransactionVin[];
    vout: BitcoinTransactionVout[];
    hex: string;
    blockhash: string;
    confirmations: number;
    time: number;
    blocktime: number;
}

const OP_RETURN_BONDING_PREFIX = '6a47';
const STAKING_TAG = '62626e31';
const EXPECTED_BONDING_LENGTH = 146;
const TAG_SLICE_START = 4;
const TAG_SLICE_END = 12;
const STAKING_TIME_SLICE_START = 142;
const STAKING_TIME_SLICE_END = 146;

const bitcoinRpc = new BitcoinRPC(process.env.BTC_RPC_URL || 'default_rpc_url');

function checkBondingOpReturn(
    hexData: string,
    params: VersionParams
): string[] {
    if (hexData.length !== EXPECTED_BONDING_LENGTH)
        return [`INVALID_OP_RETURN_LENGTH: ${hexData.length / 2} bytes`];

    try {
        const tag = hexData.slice(TAG_SLICE_START, TAG_SLICE_END);

        if (!tag.toLowerCase().startsWith(STAKING_TAG))
            return [`INVALID_TAG: ${tag}`];

        const stakingTimeHex = hexData.slice(STAKING_TIME_SLICE_START, STAKING_TIME_SLICE_END);
        const stakingTimeValue = parseInt(stakingTimeHex, 16);

        if (stakingTimeValue < params.min_staking_time || stakingTimeValue > params.max_staking_time)
            return [`INVALID_STAKING_TIME: ${stakingTimeValue}`];
    } catch (error) {
        return [`OP_RETURN_PARSE_ERROR: ${error instanceof Error ? error.message : String(error)}`];
    }

    return [];
}

function isTaprootOutput(output: any): boolean {
    if (!output?.scriptPubKey)
        return false;

    const { hex, type } = output.scriptPubKey;

    const isTaprootHex = hex?.startsWith('5120') && hex.length === 68;
    const isTaprootType = type === 'witness_v1_taproot';

    return isTaprootHex || isTaprootType;
}

function findBabylonTaprootOutput(tx: any): { output: any; index: number } | null {
    if (!tx?.vin || !tx?.vout)
        return null;

    const inputAddresses = new Set(
        tx.vin
            .map((input: any) => input.prevout?.scriptPubKey?.address || null)
            .filter(Boolean)
    );

    for (let i = 0; i < tx.vout.length; i++) {
        const output = tx.vout[i];
        const scriptPubKey = output.scriptPubKey;

        if (
            isTaprootOutput(output) &&
            scriptPubKey?.type === 'witness_v1_taproot' &&
            !inputAddresses.has(scriptPubKey?.address)
        ) {
            return {
                output,
                index: i
            };
        }
    }

    return null;
}

function initializeValidationResult(): StakeValidationResult {
    return {
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
            invalidTaprootKey: false,
        },
    };
}

function updateValidationResult(
    result: StakeValidationResult,
    error: string | string[],
    reasonKey: keyof InvalidReasons
): StakeValidationResult {
    result.errors.push(...(Array.isArray(error) ? error : [error]));
    result.invalidReasons[reasonKey] = true;
    return result;
}

export async function validateBondingTransaction(
    tx: BitcoinTransaction,
    params: VersionParams
): Promise<StakeValidationResult> {
    const result = initializeValidationResult();

   try {
        const opReturnOutput = tx.vout.find(output => output.scriptPubKey?.hex?.startsWith(OP_RETURN_BONDING_PREFIX));

        if (!opReturnOutput)
            return updateValidationResult(result, 'NO_OP_RETURN', 'noOpReturn');

        const opReturnData = opReturnOutput.scriptPubKey.hex;
        const formatErrors = checkBondingOpReturn(opReturnData, params);

        if (formatErrors.length)
            return updateValidationResult(result, formatErrors, 'invalidOpReturn');

        result.parsedOpReturn = parseOpReturn(opReturnData);
        result.hasBabylonPrefix = true;

        const stakingOutput = findBabylonTaprootOutput(tx);

        if (!stakingOutput)
            return updateValidationResult(result, 'NO_TAPROOT_OUTPUT', 'invalidTaprootKey');

        const stakeAmount = BigInt(Math.floor(stakingOutput.output.value * 1e8));
        result.adjustedAmount = Number(stakeAmount);

        if (stakeAmount < BigInt(params.min_staking_amount))
            return updateValidationResult(result, 'INSUFFICIENT_STAKE', 'invalidAmount');
        if (stakeAmount > BigInt(params.max_staking_amount))
            return updateValidationResult(result, 'EXCEEDS_MAX_STAKE', 'invalidAmount');

        const stakingTime = result.parsedOpReturn?.staking_time;

        if (stakingTime < params.min_staking_time || stakingTime > params.max_staking_time)
            return updateValidationResult(result, 'INVALID_STAKING_TIME', 'invalidStakingTime');

        result.isValid = true;
    } catch (error) {
        result.errors.push(`VALIDATION_ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
}

export async function validateUnbondingTransaction(
    tx: BitcoinTransaction,
    params: VersionParams
): Promise<StakeValidationResult> {
    const result = initializeValidationResult();

    try {
        if (tx.vin.length !== 1 || tx.vout.length !== 1)
            return updateValidationResult(result, 'INVALID_INPUT_OUTPUT_COUNT', 'wrongOutputCount');

        const witnessLength = tx.vin[0].txinwitness.filter(Boolean).length;

        if (witnessLength < 6)
            return updateValidationResult(result, 'INVALID_WITNESS', 'invalidTaprootKey');

        const stakingTransactionId = tx.vin[0].txid;
        const stakingTransaction = await bitcoinRpc.getRawTransaction(stakingTransactionId);
        const stakingOpReturnOutput = stakingTransaction.vout.find(
            (output: BitcoinTransactionVout) => output.scriptPubKey?.hex?.startsWith(OP_RETURN_BONDING_PREFIX)
        );

        if (!stakingOpReturnOutput)
            return updateValidationResult(result, 'NO_OP_RETURN', 'invalidOpReturn');

        const stakingOpReturnData = stakingOpReturnOutput.scriptPubKey.hex;
        const formatErrorsStaking = checkBondingOpReturn(stakingOpReturnData, params);

        if (formatErrorsStaking.length)
            return updateValidationResult(result, formatErrorsStaking, 'invalidOpReturn');

        result.hasBabylonPrefix = true;
        result.isValid = true;
    } catch (error) {
        result.errors.push(`VALIDATION_ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
}
