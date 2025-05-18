import { FinalityProviderService } from '../../../services/finality/FinalityProviderService';
import { Network } from '../../../types/finality';
import { Router, Request, Response } from 'express';
import { logger } from '../../../utils/logger';
import { formatSatoshis } from '../../../utils/util';
import { FinalityProviderWithMeta } from '../../../types/finality/btcstaking';

export class FinalityProviderController {
    private static instance: FinalityProviderController | null = null;
    private finalityProviderService: FinalityProviderService;

    private constructor() {
        this.finalityProviderService = FinalityProviderService.getInstance();
    }

    public static getInstance(): FinalityProviderController {
        if (!FinalityProviderController.instance) {
            FinalityProviderController.instance = new FinalityProviderController();
        }
        return FinalityProviderController.instance;
    }

    /**
     * Register provider routes on the provided router
     * @param router Express router
     */
    public registerRoutes(router: Router): void {
        // Get all finality providers with optional filtering and sorting
        router.get('/providers', this.getFinalityProviders.bind(this));
        
        // For backward compatibility - redirect to filtered active providers
        router.get('/providers/active', this.getActiveFinalityProviders.bind(this));
        
        // Get a specific finality provider by BTC public key
        router.get('/providers/:fpBtcPkHex', this.getFinalityProviderByBtcPk.bind(this));
        
        // Get a specific finality provider's power
        router.get('/providers/:fpBtcPkHex/power', this.getFinalityProviderPower.bind(this));
    }

    /**
     * Get finality providers with optional status filter and sorting
     */
    public async getFinalityProviders(req: Request, res: Response): Promise<Response> {
        try {
            const network = req.network || Network.MAINNET;
            const status = req.query.status as string || 'all';
            const sortBy = req.query.sortBy as string || 'active_tvl'; // Default sorting by active_tvl
            const sortOrder = req.query.sortOrder as string || 'desc'; // Default sort order is descending
            
            // Validate status parameter
            if (status && !['active', 'inactive', 'all'].includes(status.toLowerCase())) {
                return res.status(400).json({
                    error: 'Invalid status parameter. Must be one of: active, inactive, all'
                });
            }
            
            // Validate sortBy parameter
            const validSortFields = ['active_tvl', 'total_tvl', 'delegation_count', 'power', 'commission'];
            if (sortBy && !validSortFields.includes(sortBy.toLowerCase())) {
                return res.status(400).json({
                    error: `Invalid sortBy parameter. Must be one of: ${validSortFields.join(', ')}`
                });
            }
            
            // Validate sortOrder parameter
            if (sortOrder && !['asc', 'desc'].includes(sortOrder.toLowerCase())) {
                return res.status(400).json({
                    error: 'Invalid sortOrder parameter. Must be one of: asc, desc'
                });
            }
            
            let providers;
            
            // Get providers based on status parameter
            if (status.toLowerCase() === 'active') {
                providers = await this.finalityProviderService.getActiveFinalityProviders(network);
                logger.info(`Retrieved ${providers.length} active finality providers for ${network}`);
            } else if (status.toLowerCase() === 'inactive') {
                // Get all providers first
                const allProviders = await this.finalityProviderService.getAllFinalityProviders(network);
                // Then get active providers
                const activeProviders = await this.finalityProviderService.getActiveFinalityProviders(network);
                
                // Create a set of active provider keys for efficient lookup
                const activePkSet = new Set(activeProviders.map(p => p.btc_pk));
                
                // Filter out active providers to get inactive ones
                providers = allProviders.filter(p => !activePkSet.has(p.btc_pk));
                logger.info(`Retrieved ${providers.length} inactive finality providers for ${network}`);
            } else {
                // Default to all providers
                providers = await this.finalityProviderService.getAllFinalityProviders(network);            
                logger.info(`Retrieved ${providers.length} total finality providers for ${network}`);
            }

            // ALWAYS get the latest active providers from the node
            // Finality providers' active status can change over time
            // We should not rely on the status query parameter for determining actual active status
            const activeProviders = await this.finalityProviderService.getActiveFinalityProviders(network);
            const activePkSet = new Set(activeProviders.map(p => p.btc_pk));

            // Get all delegation stats in a single query for better performance
            const allDelegationStats = await this.finalityProviderService.getAllFinalityProviderDelegationStats(network);
            
            // Enhance providers with TVL and delegation count information
            const providersWithStats = providers.map(provider => {
                const delegationStats = allDelegationStats[provider.btc_pk] || {
                    active_tvl: "0 BTC",
                    active_tvl_sat: 0,
                    total_tvl: "0 BTC",
                    total_tvl_sat: 0,
                    delegation_count: 0
                };
                
                // Get power from active providers list (if available)
                // activeProviders contains FinalityProviderWithMeta objects which have voting_power
                const activeProvider = activeProviders.find(p => p.btc_pk === provider.btc_pk) as FinalityProviderWithMeta | undefined;
                const activePower = activeProvider ? activeProvider.voting_power : 0;
                
                return {
                    ...provider,
                    is_active: activePkSet.has(provider.btc_pk),
                    active_tvl: delegationStats.active_tvl,
                    active_tvl_sat: delegationStats.active_tvl_sat,
                    total_tvl: delegationStats.total_tvl,
                    total_tvl_sat: delegationStats.total_tvl_sat,
                    delegation_count: delegationStats.delegation_count,
                    power: activePower > 0 ? formatSatoshis(activePower) : "0 BTC",
                    power_sat: activePower
                };
            });
            
            // Sort providers based on sortBy and sortOrder parameters
            const sortedProviders = [...providersWithStats].sort((a, b) => {
                let aValue, bValue;
                
                switch(sortBy.toLowerCase()) {
                    case 'active_tvl':
                        aValue = a.active_tvl_sat;
                        bValue = b.active_tvl_sat;
                        break;
                    case 'total_tvl':
                        aValue = a.total_tvl_sat;
                        bValue = b.total_tvl_sat;
                        break;
                    case 'delegation_count':
                        aValue = a.delegation_count;
                        bValue = b.delegation_count;
                        break;
                    case 'power':
                        aValue = a.power_sat;
                        bValue = b.power_sat;
                        break;
                    case 'commission':
                        aValue = parseFloat(a.commission) || 0;
                        bValue = parseFloat(b.commission) || 0;
                        break;
                    default:
                        aValue = a.active_tvl_sat;
                        bValue = b.active_tvl_sat;
                }
                
                return sortOrder.toLowerCase() === 'asc' 
                    ? aValue - bValue
                    : bValue - aValue;
            });

            // Calculate total stats across all providers
            const totalActiveTVLSat = sortedProviders.reduce((sum, p) => sum + (p.active_tvl_sat || 0), 0);
            const totalTVLSat = sortedProviders.reduce((sum, p) => sum + (p.total_tvl_sat || 0), 0);
            const totalDelegations = sortedProviders.reduce((sum, p) => sum + (p.delegation_count || 0), 0);
            
            return res.json({
                providers: sortedProviders,
                count: sortedProviders.length,
                active_count: activePkSet.size,
                stats: {
                    total_active_tvl: formatSatoshis(totalActiveTVLSat),
                    total_active_tvl_sat: totalActiveTVLSat,
                    total_tvl: formatSatoshis(totalTVLSat),
                    total_tvl_sat: totalTVLSat,
                    total_delegations: totalDelegations
                }
            });
        } catch (error) {
            logger.error('Error getting finality providers:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get active finality providers (redirects to filtered providers with active status)
     */
    public async getActiveFinalityProviders(req: Request, res: Response): Promise<Response> {
        try {
            // Modify request query to filter by active status
            req.query.status = 'active';
            return this.getFinalityProviders(req, res);
        } catch (error) {
            logger.error('Error getting active finality providers:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get a specific finality provider by BTC public key
     */
    public async getFinalityProviderByBtcPk(req: Request, res: Response): Promise<Response> {
        try {
            const { fpBtcPkHex } = req.params;
            const network = req.network || Network.MAINNET;
            
            // Get the finality provider
            const provider = await this.finalityProviderService.getFinalityProvider(fpBtcPkHex, network);
            if (!provider) {
                return res.status(404).json({
                    error: 'Finality provider not found',
                    message: `No finality provider found with BTC public key ${fpBtcPkHex}`
                });
            }
            
            // Get delegation statistics for this provider
            const delegationStats = await this.finalityProviderService.getFinalityProviderDelegationStats(fpBtcPkHex, network);
            
            // Check if the provider is active
            const activeProviders = await this.finalityProviderService.getActiveFinalityProviders(network);
            const activeProvider = activeProviders.find(p => p.btc_pk === fpBtcPkHex) as FinalityProviderWithMeta | undefined;
            
            // Combine data for response
            const response = {
                ...provider,
                is_active: !!activeProvider,
                active_tvl: delegationStats.active_tvl,
                active_tvl_sat: delegationStats.active_tvl_sat,
                total_tvl: delegationStats.total_tvl,
                total_tvl_sat: delegationStats.total_tvl_sat,
                delegation_count: delegationStats.delegation_count,
                power: activeProvider ? formatSatoshis(activeProvider.voting_power) : "0 BTC",
                power_sat: activeProvider ? activeProvider.voting_power : 0
            };
            
            return res.json(response);
        } catch (error) {
            logger.error('Error getting finality provider:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get a finality provider's voting power
     */
    public async getFinalityProviderPower(req: Request, res: Response): Promise<Response> {
        try {
            const { fpBtcPkHex } = req.params;
            const network = req.network || Network.MAINNET;
            
            // Get the provider's power
            const power = await this.finalityProviderService.getFinalityProviderPower(fpBtcPkHex, network);
            
            if (!power) {
                return res.status(404).json({
                    error: 'Finality provider power not found',
                    message: `No power information found for finality provider with BTC public key ${fpBtcPkHex}`
                });
            }
            
            return res.json(power);
        } catch (error) {
            logger.error('Error getting finality provider power:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}
