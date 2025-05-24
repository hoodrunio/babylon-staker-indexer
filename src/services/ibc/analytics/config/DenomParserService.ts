import { logger } from '../../../../utils/logger';

/**
 * Denom mapping for complex tokens that need manual identification
 */
interface DenomMapping {
    originalDenom: string;
    baseDenom: string;
    symbol: string;
    decimals: number;
    coingeckoId?: string;
    description?: string;
}

/**
 * Denom Parser Service
 * Handles complex IBC denomination parsing and custom token mappings
 */
export class DenomParserService {
    private static instance: DenomParserService | null = null;

    // Custom mappings for complex tokens (wasm, factory, etc.)
    private readonly customMappings: Record<string, DenomMapping> = {
        // WASM tokens - these need to be manually mapped
        'transfer/08-wasm-1369/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': {
            originalDenom: 'transfer/08-wasm-1369/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
            baseDenom: 'wbtc',
            symbol: 'WBTC',
            decimals: 8,
            coingeckoId: 'wrapped-bitcoin',
            description: 'Wrapped Bitcoin via IBC'
        },
        'transfer/08-wasm-1369/0x7a56e1c57c7475ccf742a1832b028f0456652f97': {
            originalDenom: 'transfer/08-wasm-1369/0x7a56e1c57c7475ccf742a1832b028f0456652f97',
            baseDenom: 'unknown-wasm-7a56',
            symbol: 'UNKNOWN',
            decimals: 18,
            description: 'Unknown WASM token - needs identification'
        },
        'transfer/08-wasm-1369/0x657e8c867d8b37dcc18fa4caead9c45eb088c642': {
            originalDenom: 'transfer/08-wasm-1369/0x657e8c867d8b37dcc18fa4caead9c45eb088c642',
            baseDenom: 'unknown-wasm-657e',
            symbol: 'UNKNOWN',
            decimals: 18,
            description: 'Unknown WASM token - needs identification'
        },
        'transfer/08-wasm-1369/0xf6718b2701d4a6498ef77d7c152b2137ab28b8a3': {
            originalDenom: 'transfer/08-wasm-1369/0xf6718b2701d4a6498ef77d7c152b2137ab28b8a3',
            baseDenom: 'unknown-wasm-f671',
            symbol: 'UNKNOWN',
            decimals: 18,
            description: 'Unknown WASM token - needs identification'
        },
        'transfer/08-wasm-1369/0x9356f6d95b8e109f4b7ce3e49d672967d3b48383': {
            originalDenom: 'transfer/08-wasm-1369/0x9356f6d95b8e109f4b7ce3e49d672967d3b48383',
            baseDenom: 'unknown-wasm-9356',
            symbol: 'UNKNOWN',
            decimals: 18,
            description: 'Unknown WASM token - needs identification'
        },
        'transfer/08-wasm-1369/0x004e9c3ef86bc1ca1f0bb5c7662861ee93350568': {
            originalDenom: 'transfer/08-wasm-1369/0x004e9c3ef86bc1ca1f0bb5c7662861ee93350568',
            baseDenom: 'unknown-wasm-004e',
            symbol: 'UNKNOWN',
            decimals: 18,
            description: 'Unknown WASM token - needs identification'
        },
        'transfer/08-wasm-1369/0xf469fbd2abcd6b9de8e169d128226c0fc90a012e': {
            originalDenom: 'transfer/08-wasm-1369/0xf469fbd2abcd6b9de8e169d128226c0fc90a012e',
            baseDenom: 'unknown-wasm-f469',
            symbol: 'UNKNOWN',
            decimals: 18,
            description: 'Unknown WASM token - needs identification'
        },
        'transfer/08-wasm-1369/0xd9d920aa40f578ab794426f5c90f6c731d159def': {
            originalDenom: 'transfer/08-wasm-1369/0xd9d920aa40f578ab794426f5c90f6c731d159def',
            baseDenom: 'unknown-wasm-d9d9',
            symbol: 'UNKNOWN',
            decimals: 18,
            description: 'Unknown WASM token - needs identification'
        },
        'transfer/08-wasm-1369/0xbdf245957992bfbc62b07e344128a1eec7b7ee3f': {
            originalDenom: 'transfer/08-wasm-1369/0xbdf245957992bfbc62b07e344128a1eec7b7ee3f',
            baseDenom: 'unknown-wasm-bdf2',
            symbol: 'UNKNOWN',
            decimals: 18,
            description: 'Unknown WASM token - needs identification'
        },
        'transfer/08-wasm-1369/0x6a9a65b84843f5fd4ac9a0471c4fc11afffbce4a': {
            originalDenom: 'transfer/08-wasm-1369/0x6a9a65b84843f5fd4ac9a0471c4fc11afffbce4a',
            baseDenom: 'unknown-wasm-6a9a',
            symbol: 'UNKNOWN',
            decimals: 18,
            description: 'Unknown WASM token - needs identification'
        },
        'transfer/08-wasm-1369/0x09def5abc67e967d54e8233a4b5ebbc1b3fbe34b': {
            originalDenom: 'transfer/08-wasm-1369/0x09def5abc67e967d54e8233a4b5ebbc1b3fbe34b',
            baseDenom: 'unknown-wasm-09de',
            symbol: 'UNKNOWN',
            decimals: 18,
            description: 'Unknown WASM token - needs identification'
        },
        
        // Factory tokens
        'factory/milk1qg5ega6dykkxc307y25pecuufrjkxkaggkkxh7nad0vhyhtuhw3ssgcye4/umilkBBN': {
            originalDenom: 'factory/milk1qg5ega6dykkxc307y25pecuufrjkxkaggkkxh7nad0vhyhtuhw3ssgcye4/umilkBBN',
            baseDenom: 'umilkbbn',
            symbol: 'milkBBN',
            decimals: 6,
            description: 'Milkyway Staked BBN'
        },

        // IBC Hash mappings - critical for cross-chain tokens
        'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2': {
            originalDenom: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
            baseDenom: 'uatom',
            symbol: 'ATOM',
            decimals: 6,
            coingeckoId: 'cosmos',
            description: 'Cosmos Hub ATOM via IBC'
        },
        'ibc/47BD209179859CDE4A2806763D7189B6E6FE13A17880FE2B42DE1E6C1E329E23': {
            originalDenom: 'ibc/47BD209179859CDE4A2806763D7189B6E6FE13A17880FE2B42DE1E6C1E329E23',
            baseDenom: 'uosmo',
            symbol: 'OSMO',
            decimals: 6,
            coingeckoId: 'osmosis',
            description: 'Osmosis OSMO via IBC'
        },
        'ibc/632D09C1324B38144BD3B8879EC56303496798209341138900F338CCDBADD970': {
            originalDenom: 'ibc/632D09C1324B38144BD3B8879EC56303496798209341138900F338CCDBADD970',
            baseDenom: 'uxprt',
            symbol: 'XPRT',
            decimals: 6,
            coingeckoId: 'persistence',
            description: 'Persistence XPRT via IBC'
        },
        'ibc/65D0BEC6DAD96C7F5043D1E54E54B6BB5D5B3AEC3FF6CEBB75B9E059F3580EA3': {
            originalDenom: 'ibc/65D0BEC6DAD96C7F5043D1E54E54B6BB5D5B3AEC3FF6CEBB75B9E059F3580EA3',
            baseDenom: 'uusdc',
            symbol: 'USDC',
            decimals: 6,
            coingeckoId: 'usd-coin',
            description: 'USD Coin via IBC'
        },
        'ibc/C0E66D1C81D8AAF0E6896E05190FDFBC222367148F86AC3EA679C28327A763CD': {
            originalDenom: 'ibc/C0E66D1C81D8AAF0E6896E05190FDFBC222367148F86AC3EA679C28327A763CD',
            baseDenom: 'uaxl',
            symbol: 'AXL',
            decimals: 6,
            coingeckoId: 'axelar',
            description: 'Axelar AXL via IBC'
        },
        'ibc/F082B65C88E4B6D5EF1DB243CDA1D331D002759E938A0F5CD3FFDC5D53B3E349': {
            originalDenom: 'ibc/F082B65C88E4B6D5EF1DB243CDA1D331D002759E938A0F5CD3FFDC5D53B3E349',
            baseDenom: 'uusdc',
            symbol: 'USDC',
            decimals: 6,
            coingeckoId: 'usd-coin',
            description: 'USD Coin via Axelar IBC'
        },
        'ibc/88386AC48152D48B34B082648DF836F975506F0B57DBBFC10A54213B1BF484CB': {
            originalDenom: 'ibc/88386AC48152D48B34B082648DF836F975506F0B57DBBFC10A54213B1BF484CB',
            baseDenom: 'wbtc',
            symbol: 'WBTC',
            decimals: 8,
            coingeckoId: 'wrapped-bitcoin',
            description: 'Wrapped Bitcoin via IBC'
        },
        'ibc/7C657AF9D002F0EA5327B3AECB0ECE6BED10C7B56AF4C5124700F64782CD0231': {
            originalDenom: 'ibc/7C657AF9D002F0EA5327B3AECB0ECE6BED10C7B56AF4C5124700F64782CD0231',
            baseDenom: 'ucore',
            symbol: 'CORE',
            decimals: 6,
            coingeckoId: 'coredaoorg',
            description: 'Core DAO CORE via IBC'
        },
        'ibc/89EE10FCF78800B572BAAC7080AEFA301B5F3BBC51C5371E907EB129C5B900E7': {
            originalDenom: 'ibc/89EE10FCF78800B572BAAC7080AEFA301B5F3BBC51C5371E907EB129C5B900E7',
            baseDenom: 'uclbtc',
            symbol: 'clBTC',
            decimals: 6,
            description: 'Collateralized BTC via IBC'
        },
        'ibc/CD7ECDBBA538632B45915ED67C4932DDB318818C00C21489D3774E560E87E420': {
            originalDenom: 'ibc/CD7ECDBBA538632B45915ED67C4932DDB318818C00C21489D3774E560E87E420',
            baseDenom: 'umilkbbn',
            symbol: 'milkBBN',
            decimals: 6,
            description: 'Milkyway Staked BBN via IBC'
        },
        'ibc/9D8D4CAE9D8F15B69E93969304AF3878D14BDED39FEAF0060566D6AC22288779': {
            originalDenom: 'ibc/9D8D4CAE9D8F15B69E93969304AF3878D14BDED39FEAF0060566D6AC22288779',
            baseDenom: 'umilktia',
            symbol: 'milkTIA',
            decimals: 6,
            coingeckoId: 'milkyway-staked-tia',
            description: 'Milkyway Staked TIA'
        },

        // Add more mappings as needed...
    };

    private constructor() {
        logger.info('[DenomParserService] Initialized with custom mappings');
    }

    public static getInstance(): DenomParserService {
        if (!DenomParserService.instance) {
            DenomParserService.instance = new DenomParserService();
        }
        return DenomParserService.instance;
    }

    /**
     * Parse any denomination to extract the base denom
     * Handles IBC paths, factory tokens, wasm tokens, etc.
     */
    public parseBaseDenom(denom: string): string {
        if (!denom) return '';

        // Check custom mappings first
        if (this.customMappings[denom]) {
            return this.customMappings[denom].baseDenom;
        }

        // Handle IBC transfer paths
        if (denom.startsWith('transfer/')) {
            return this.parseIBCTransferPath(denom);
        }

        // Handle factory tokens
        if (denom.startsWith('factory/')) {
            return this.parseFactoryToken(denom);
        }

        // Handle wasm tokens (if not in custom mappings)
        if (denom.includes('08-wasm-') || denom.includes('/0x')) {
            logger.warn(`[DenomParserService] Unmapped wasm token: ${denom}`);
            return 'unknown-wasm';
        }

        // Handle CW20 tokens
        if (denom.startsWith('cw20:')) {
            return this.parseCW20Token(denom);
        }

        // For standard denoms, return as-is
        return denom;
    }

    /**
     * Parse IBC transfer paths like:
     * - transfer/channel-190/uxprt -> uxprt
     * - transfer/channel-0/transfer/channel-190/uxprt -> uxprt
     */
    private parseIBCTransferPath(denom: string): string {
        const parts = denom.split('/');
        
        // The actual denom is always the last part
        const lastPart = parts[parts.length - 1];
        
        // If the last part is still an IBC path, recurse
        if (lastPart.startsWith('transfer/')) {
            return this.parseIBCTransferPath(lastPart);
        }
        
        return lastPart;
    }

    /**
     * Parse factory tokens like:
     * factory/osmo1.../umilkTIA -> umilkTIA
     */
    private parseFactoryToken(denom: string): string {
        const parts = denom.split('/');
        if (parts.length >= 3) {
            return parts[2]; // factory/creator/subdenom
        }
        
        logger.warn(`[DenomParserService] Invalid factory token format: ${denom}`);
        return denom;
    }

    /**
     * Parse CW20 tokens
     */
    private parseCW20Token(denom: string): string {
        // Remove cw20: prefix and return contract address or token identifier
        return denom.replace('cw20:', '');
    }

    /**
     * Get complete mapping information for a denom
     */
    public getDenomMapping(denom: string): DenomMapping | null {
        // Check custom mappings
        if (this.customMappings[denom]) {
            return this.customMappings[denom];
        }

        // For standard denoms, create a basic mapping
        const baseDenom = this.parseBaseDenom(denom);
        if (baseDenom !== denom && baseDenom !== 'unknown-wasm') {
            return {
                originalDenom: denom,
                baseDenom,
                symbol: baseDenom.toUpperCase().replace('U', ''),
                decimals: 6, // Default for Cosmos tokens
                description: `IBC token derived from ${baseDenom}`
            };
        }

        return null;
    }

    /**
     * Add a custom mapping for complex tokens
     */
    public addCustomMapping(mapping: DenomMapping): void {
        this.customMappings[mapping.originalDenom] = mapping;
        logger.info(`[DenomParserService] Added custom mapping: ${mapping.originalDenom} -> ${mapping.baseDenom}`);
    }

    /**
     * Add multiple custom mappings at once
     */
    public addCustomMappings(mappings: DenomMapping[]): void {
        mappings.forEach(mapping => this.addCustomMapping(mapping));
    }

    /**
     * Check if a denom needs custom mapping (wasm, complex factory tokens, etc.)
     */
    public needsCustomMapping(denom: string): boolean {
        // Already has mapping
        if (this.customMappings[denom]) {
            return false;
        }

        // Wasm tokens always need custom mapping
        if (denom.includes('08-wasm-') || denom.includes('/0x')) {
            return true;
        }

        // Complex factory tokens with long addresses might need custom mapping
        if (denom.startsWith('factory/') && denom.length > 100) {
            return true;
        }

        return false;
    }

    /**
     * Get all custom mappings (for debugging/monitoring)
     */
    public getAllCustomMappings(): Record<string, DenomMapping> {
        return { ...this.customMappings };
    }

    /**
     * Bulk parse multiple denoms efficiently
     */
    public parseMultipleDenoms(denoms: string[]): Record<string, string> {
        const result: Record<string, string> = {};
        
        denoms.forEach(denom => {
            result[denom] = this.parseBaseDenom(denom);
        });

        return result;
    }

    /**
     * Get statistics about denom parsing
     */
    public getParsingStats(denoms: string[]): {
        total: number;
        parsed: number;
        needsMapping: number;
        unknown: number;
        customMapped: number;
    } {
        let parsed = 0;
        let needsMapping = 0;
        let unknown = 0;
        let customMapped = 0;

        denoms.forEach(denom => {
            if (this.customMappings[denom]) {
                customMapped++;
            } else if (this.needsCustomMapping(denom)) {
                needsMapping++;
            } else {
                const baseDenom = this.parseBaseDenom(denom);
                if (baseDenom === 'unknown-wasm') {
                    unknown++;
                } else {
                    parsed++;
                }
            }
        });

        return {
            total: denoms.length,
            parsed,
            needsMapping,
            unknown,
            customMapped
        };
    }

    /**
     * Reset singleton instance (useful for testing)
     */
    public static resetInstance(): void {
        DenomParserService.instance = null;
    }
} 