import { logger } from '../../../../utils/logger';
import { IIBCTokenService } from '../interfaces/IBCServices';

/**
 * Service responsible for token-related operations in IBC transfers
 */
export class IBCTokenService implements IIBCTokenService {
    /**
     * Extract a readable token symbol from a denom
     * @param denom The IBC denom string (e.g., 'ubbn', 'ibc/1234...', 'transfer/channel-1/uatom')
     * @returns A human-readable symbol 
     */
    public extractTokenSymbol(denom: string): string {
        if (!denom) return 'UNKNOWN';
        
        // Handle native denominations
        if (denom === 'ubbn') return 'BABY';
        
        // Handle common IBC tokens
        if (denom.startsWith('ibc/')) {
            return 'IBC';
        }
        
        // Handle transfer format: e.g., transfer/channel-1/uatom
        if (denom.includes('/')) {
            const parts = denom.split('/');
            // Get the last part which usually contains the actual denom
            const baseDenom = parts[parts.length - 1] || '';
            
            // Common denomination prefixes to transform
            if (baseDenom.startsWith('u')) return baseDenom.substring(1).toUpperCase();
            if (baseDenom.startsWith('a')) return baseDenom.substring(1).toUpperCase();
            
            return baseDenom.toUpperCase();
        }
        
        return denom.toUpperCase();
    }

    /**
     * Format token amount for human-readable display
     * @param amount Amount in smallest unit (e.g., 1000000)
     * @param symbol Token symbol for denomination factor
     * @returns Formatted amount string
     */
    public formatTokenAmount(amount: string, symbol: string): string {
        try {
            const numericAmount = BigInt(amount);
            
            // Different tokens have different denomination factors
            let denomFactor = BigInt(1000000); // Default for most cosmos tokens (6 decimals)
            
            if (symbol === 'BABY' || symbol === 'ATOM' || symbol === 'OSMO') {
                denomFactor = BigInt(1000000); // 6 decimals
            } else if (symbol === 'BTC') {
                denomFactor = BigInt(100000000); // 8 decimals
            } else if (symbol === 'ETH') {
                denomFactor = BigInt(1000000000000000000); // 18 decimals
            }
            
            if (denomFactor === BigInt(1)) {
                return amount;
            }
            
            // Calculate whole units and remainder
            const wholePart = numericAmount / denomFactor;
            const fractionalPart = numericAmount % denomFactor;
            
            // Format with proper decimal places
            if (fractionalPart === BigInt(0)) {
                return wholePart.toString();
            } else {
                // Convert fractional part to string with leading zeros
                let fractionalStr = fractionalPart.toString();
                
                // Pad with leading zeros if needed
                const padding = denomFactor.toString().length - 1 - fractionalStr.length;
                if (padding > 0) {
                    fractionalStr = '0'.repeat(padding) + fractionalStr;
                }
                
                // Trim trailing zeros
                fractionalStr = fractionalStr.replace(/0+$/, '');
                
                if (fractionalStr.length > 0) {
                    return `${wholePart}.${fractionalStr}`;
                } else {
                    return wholePart.toString();
                }
            }
        } catch (error) {
            logger.error(`[IBCTokenService] Error formatting token amount: ${error instanceof Error ? error.message : String(error)}`);
            return amount; // Return original amount on error
        }
    }

    /**
     * Parse transfer data from packet data
     * @param packetData Raw packet data
     * @returns Parsed transfer data
     */
    public parseTransferData(packetData: any): any {
        try {
            // Try to parse packet data as JSON if it's a string
            if (typeof packetData === 'string') {
                return JSON.parse(packetData);
            }
            return packetData;
        } catch (error) {
            logger.error(`[IBCTokenService] Error parsing packet data: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
}
