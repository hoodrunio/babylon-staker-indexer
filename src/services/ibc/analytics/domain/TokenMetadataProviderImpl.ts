import { ITokenMetadataProvider } from './TokenRepository';
import { TokenMetadata } from './Token';
import { DenomParserService } from '../config/DenomParserService';
import { logger } from '../../../../utils/logger';

/**
 * Token Metadata Provider Implementation
 * Adapts existing DenomParserService to new interface
 */
export class TokenMetadataProviderImpl implements ITokenMetadataProvider {
    private readonly denomParser: DenomParserService;
    private readonly staticRegistry: Map<string, TokenMetadata> = new Map();

    constructor() {
        this.denomParser = DenomParserService.getInstance();
        this.initializeStaticRegistry();
    }

    parseBaseDenom(denom: string): string {
        return this.denomParser.parseBaseDenom(denom);
    }

    getMetadata(denom: string): TokenMetadata | null {
        const baseDenom = this.parseBaseDenom(denom);

        // Check static registry first
        if (this.staticRegistry.has(baseDenom)) {
            return this.staticRegistry.get(baseDenom)!;
        }

        // Check denom parser custom mappings
        const mapping = this.denomParser.getDenomMapping(denom);
        if (mapping) {
            const metadata: TokenMetadata = {
                originalDenom: mapping.originalDenom,
                baseDenom: mapping.baseDenom,
                symbol: mapping.symbol,
                decimals: mapping.decimals,
                coingeckoId: mapping.coingeckoId,
                description: mapping.description
            };

            // Cache in static registry for faster future lookups
            this.staticRegistry.set(baseDenom, metadata);
            return metadata;
        }

        // Check if it's a known base denomination
        const knownMetadata = this.getKnownTokenMetadata(baseDenom);
        if (knownMetadata) {
            this.staticRegistry.set(baseDenom, knownMetadata);
            return knownMetadata;
        }

        logger.warn(`[TokenMetadataProvider] No metadata found for denom: ${denom} (base: ${baseDenom})`);
        return null;
    }

    registerMapping(denom: string, metadata: TokenMetadata): void {
        // Register in static registry
        this.staticRegistry.set(metadata.baseDenom, metadata);
        
        // Register in denom parser for complex denominations
        if (denom !== metadata.baseDenom) {
            this.denomParser.addCustomMapping({
                originalDenom: metadata.originalDenom,
                baseDenom: metadata.baseDenom,
                symbol: metadata.symbol,
                decimals: metadata.decimals,
                coingeckoId: metadata.coingeckoId,
                description: metadata.description
            });
        }

        logger.info(`[TokenMetadataProvider] Registered mapping: ${denom} -> ${metadata.baseDenom} (${metadata.symbol})`);
    }

    needsMapping(denom: string): boolean {
        return this.denomParser.needsCustomMapping(denom);
    }

    /**
     * Get all registered metadata
     */
    getAllMetadata(): Map<string, TokenMetadata> {
        return new Map(this.staticRegistry);
    }

    /**
     * Get metadata statistics
     */
    getStats(): {
        totalMappings: number;
        customMappings: number;
        knownTokens: number;
    } {
        const customMappings = Object.keys(this.denomParser.getAllCustomMappings()).length;
        
        return {
            totalMappings: this.staticRegistry.size,
            customMappings,
            knownTokens: this.staticRegistry.size - customMappings
        };
    }

    private initializeStaticRegistry(): void {
        // Initialize with known Babylon ecosystem tokens
        const knownTokens: TokenMetadata[] = [
            {
                originalDenom: 'ubbn',
                baseDenom: 'ubbn',
                symbol: 'BABY',
                decimals: 6,
                coingeckoId: 'babylon',
                description: 'Babylon Bitcoin Staking Hub'
            },
            {
                originalDenom: 'uatom',
                baseDenom: 'uatom',
                symbol: 'ATOM',
                decimals: 6,
                coingeckoId: 'cosmos',
                description: 'Cosmos Hub'
            },
            {
                originalDenom: 'uosmo',
                baseDenom: 'uosmo',
                symbol: 'OSMO',
                decimals: 6,
                coingeckoId: 'osmosis',
                description: 'Osmosis DEX'
            },
            {
                originalDenom: 'uaxl',
                baseDenom: 'uaxl',
                symbol: 'AXL',
                decimals: 6,
                coingeckoId: 'axelar',
                description: 'Axelar Network'
            },
            {
                originalDenom: 'wbtc',
                baseDenom: 'wbtc',
                symbol: 'WBTC',
                decimals: 8,
                coingeckoId: 'bitcoin', // Use bitcoin price for WBTC
                description: 'Wrapped Bitcoin'
            },
            {
                originalDenom: 'btc',
                baseDenom: 'btc',
                symbol: 'BTC',
                decimals: 8,
                coingeckoId: 'bitcoin',
                description: 'Bitcoin'
            },
            {
                originalDenom: 'uusdc',
                baseDenom: 'uusdc',
                symbol: 'USDC',
                decimals: 6,
                coingeckoId: 'usd-coin',
                description: 'USD Coin',
                isStable: true
            },
            {
                originalDenom: 'uusdt',
                baseDenom: 'uusdt',
                symbol: 'USDT',
                decimals: 6,
                coingeckoId: 'tether',
                description: 'Tether USD',
                isStable: true
            },
            {
                originalDenom: 'umilkbbn',
                baseDenom: 'umilkbbn',
                symbol: 'milkBBN',
                decimals: 6,
                description: 'Milkyway Staked BBN'
            },
            {
                originalDenom: 'umilktia',
                baseDenom: 'umilktia',
                symbol: 'milkTIA',
                decimals: 6,
                coingeckoId: 'milkyway-staked-tia',
                description: 'Milkyway Staked TIA'
            },
            {
                originalDenom: 'uclbtc',
                baseDenom: 'uclbtc',
                symbol: 'clBTC',
                decimals: 6,
                description: 'Collateralized BTC'
            }
        ];

        for (const metadata of knownTokens) {
            this.staticRegistry.set(metadata.baseDenom, metadata);
        }

        logger.info(`[TokenMetadataProvider] Initialized with ${knownTokens.length} known tokens`);
    }

    private getKnownTokenMetadata(baseDenom: string): TokenMetadata | null {
        // This is a fallback for when denom parsing doesn't find a custom mapping
        // but we still want to provide basic metadata for unknown tokens
        
        // Extract symbol from base denom (remove 'u' prefix if present)
        const symbol = baseDenom.startsWith('u') && baseDenom.length > 1 
            ? baseDenom.substring(1).toUpperCase()
            : baseDenom.toUpperCase();

        // Default to 6 decimals for most Cosmos tokens
        const decimals = baseDenom.includes('btc') ? 8 : 6;

        return {
            originalDenom: baseDenom,
            baseDenom: baseDenom,
            symbol: symbol,
            decimals: decimals,
            description: `Unknown token: ${symbol}`
        };
    }
} 