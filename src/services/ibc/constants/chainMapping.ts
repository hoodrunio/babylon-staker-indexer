/**
 * Mapping of chain IDs to human-readable names
 * This helps make IBC channel data more user-friendly
 */
export const ChainIdToName: Record<string, string> = {
    // Cosmos Hub
    'cosmoshub-4': 'Cosmos Hub',
    'cosmoshub-testnet': 'Cosmos Hub Testnet',
    
    // Osmosis
    'osmosis-1': 'Osmosis',
    'osmosis-test-5': 'Osmosis Testnet',
    
    // Babylon
    'bbn-test-5': 'Babylon Testnet',
    'bbn-1': 'Babylon Genesis',
    
    // Celestia
    'celestia': 'Celestia',
    'mocha-4': 'Celestia Testnet',
    
    // Other major IBC chains
    'juno-1': 'Juno',
    'stargaze-1': 'Stargaze',
    'evmos_9001-2': 'Evmos',
    'secret-4': 'Secret Network',
    'akashnet-2': 'Akash',
    'regen-1': 'Regen Network',
    'columbus-5': 'Terra Classic',
    'phoenix-1': 'Terra',
    'injective-1': 'Injective',
    'quicksilver-2': 'Quicksilver',
    'axelar-dojo-1': 'Axelar',
    'kaiyo-1': 'Kujira',
    'sommelier-3': 'Sommelier',
    'stride-1': 'Stride',
    'mars-1': 'Mars Hub',
    'dydx-mainnet-1': 'dYdX',
    'dymension_1100-1': 'Dymension',
    'neutron-1': 'Neutron',
    'noble-1': 'Noble',
    'agoric-3': 'Agoric',
    'umee-1': 'Umee',
    'comdex-1': 'Comdex',
    'crescent-1': 'Crescent',
    'persistence-1': 'Persistence',
    'sei-1': 'Sei',
    'migaloo-1': 'Migaloo',
    'milkyway': 'Milkyway',
};

/**
 * Get a human-readable name for a chain ID
 * @param chainId Chain ID
 * @returns Human-readable name or the original ID if not found
 */
export function getChainName(chainId: string): string {
    return ChainIdToName[chainId] || chainId;
}

/**
 * Format a channel identifier for display
 * @param sourceChainId Source chain ID
 * @param destChainId Destination chain ID
 * @param channelId Channel ID
 * @returns Formatted channel identifier
 */
export function formatChannelIdentifier(
    sourceChainId: string,
    destChainId: string,
    channelId: string
): string {
    const sourceName = getChainName(sourceChainId);
    const destName = getChainName(destChainId);
    return `${sourceName} ↔ ${destName} (${channelId})`;
}
