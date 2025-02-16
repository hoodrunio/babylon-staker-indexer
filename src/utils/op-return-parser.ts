import { ValidationConfig, ValidationError, ParsedOpReturn } from '../types/validation';
import { logger } from './logger';
// Constants
const OP_RETURN_PREFIX = '6a47';
const BABYLON_TAG = '62626e31';
const EXPECTED_LENGTH = 146; // 73 bytes in hex

// Default configuration for backward compatibility
const DEFAULT_CONFIG: ValidationConfig = {
    minStakingTime: 1,           // Minimum possible value
    maxStakingTime: 65535,       // Maximum possible value (16-bit)
    minStakeAmount: 0,           // No minimum
    maxStakeAmount: 21000000,    // Maximum possible BTC
    allowedVersions: [0],        // Default to version 0 only
    stakingCap: undefined        // No cap by default
};

interface ParsedComponents {
    version: number;
    staker_public_key: string;
    finality_provider: string;
    staking_time: number;
}

function isValidFormat(hexData: string): boolean {
    return hexData.startsWith(OP_RETURN_PREFIX) && 
           hexData.length === EXPECTED_LENGTH &&
           hexData.slice(4, 12).toLowerCase() === BABYLON_TAG;
}

function parseComponents(hexData: string): ParsedComponents | null {
    try {
        const data = hexData.slice(12);
        const version = parseInt(data.slice(0, 2), 16);
        
        return {
            version,
            staker_public_key: data.slice(2, 66),
            finality_provider: data.slice(66, 130),
            staking_time: parseInt(data.slice(130, 134), 16)
        };
    } catch (e) {
        logger.error('Error parsing OP_RETURN components:', e);
        return null;
    }
}

function validateBusinessRules(
    components: ParsedComponents,
    config: ValidationConfig
): ValidationError[] {
    const errors: ValidationError[] = [];

    // Version validation
    if (!config.allowedVersions.includes(components.version)) {
        errors.push({
            code: 'INVALID_VERSION',
            message: `Version ${components.version} is not allowed. Allowed versions: ${config.allowedVersions.join(', ')}`,
            severity: 'ERROR'
        });
    }

    // Staking time validation
    if (components.staking_time < config.minStakingTime || 
        components.staking_time > config.maxStakingTime) {
        errors.push({
            code: 'INVALID_STAKING_TIME',
            message: `Staking time ${components.staking_time} is outside allowed range [${config.minStakingTime}-${config.maxStakingTime}]`,
            severity: 'ERROR',
            data: {
                value: components.staking_time,
                min: config.minStakingTime,
                max: config.maxStakingTime
            }
        });
    }

    return errors;
}

export function parseOpReturn(hexData: string, config: ValidationConfig = DEFAULT_CONFIG): ParsedOpReturn | null {
    try {
        // Basic format validation
        if (!isValidFormat(hexData)) {
            return null;
        }

        // Parse components
        const components = parseComponents(hexData);
        if (!components) {
            return null;
        }

        // Business rules validation
        const errors = validateBusinessRules(components, config);

        return {
            ...components,
            validationResult: {
                isValid: errors.length === 0,
                errors
            }
        };
    } catch (e) {
        logger.error('Error parsing OP_RETURN:', e);
        return null;
    }
}