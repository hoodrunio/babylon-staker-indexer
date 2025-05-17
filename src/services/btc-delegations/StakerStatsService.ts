import { StakerUtils } from './utils/StakerUtils';

export class StakerStatsService {
    private static instance: StakerStatsService | null = null;

    private constructor() {}

    public static getInstance(): StakerStatsService {
        if (!StakerStatsService.instance) {
            StakerStatsService.instance = new StakerStatsService();
        }
        return StakerStatsService.instance;
    }

    /**
     * Updates staker statistics
     * @param staker Staker document
     * @param delegation Delegation data
     * @param phase Phase value
     */
    public async updateStakerStats(staker: any, delegation: any, phase: number): Promise<void> {
        try {
            const { state, networkType, totalSat, stakingTxIdHex, finalityProviderBtcPksHex } = delegation;
            
            // Verify finality provider public key
            if (!finalityProviderBtcPksHex || finalityProviderBtcPksHex.length === 0) {
                StakerUtils.logError(`Missing finalityProviderBtcPksHex for delegation: ${stakingTxIdHex}`, new Error('Missing finality provider'));
                return;
            }
            
            const finalityProviderBtcPkHex = finalityProviderBtcPksHex[0]; // Use the first finality provider
            const oldState = staker.recentDelegations.find((d: any) => d.stakingTxIdHex === stakingTxIdHex)?.state;

            // If the status has changed, decrease the old status
            if (oldState && oldState !== state) {
                staker.delegationStates[oldState] = Math.max(0, (staker.delegationStates[oldState] || 0) - 1);
                
                // If the old status is ACTIVE and the new status is not ACTIVE, decrease the active counts
                if (oldState === 'ACTIVE' && state !== 'ACTIVE') {
                    staker.activeDelegationsCount = Math.max(0, staker.activeDelegationsCount - 1);
                    staker.activeStakedSat = Math.max(0, staker.activeStakedSat - totalSat);
                    
                    // Update active statistics on a network basis
                    if (staker.networkStats && staker.networkStats[networkType]) {
                        staker.networkStats[networkType].activeDelegations = Math.max(0, staker.networkStats[networkType].activeDelegations - 1);
                        staker.networkStats[networkType].activeStakedSat = Math.max(0, staker.networkStats[networkType].activeStakedSat - totalSat);
                    }

                    // Update phase-based active statistics
                    this.updatePhaseStats(staker, phase, networkType, finalityProviderBtcPkHex, totalSat, false, false);
                }
            }

            // Increase the new status
            staker.delegationStates[state] = (staker.delegationStates[state] || 0) + 1;

            // If the new status is ACTIVE and the old status is not ACTIVE, increase the active counts
            if (state === 'ACTIVE' && oldState !== 'ACTIVE') {
                staker.activeDelegationsCount += 1;
                staker.activeStakedSat += totalSat;
                
                // Update active statistics on a network basis
                if (staker.networkStats && staker.networkStats[networkType]) {
                    staker.networkStats[networkType].activeDelegations += 1;
                    staker.networkStats[networkType].activeStakedSat += totalSat;
                }

                // Update phase-based active statistics
                this.updatePhaseStats(staker, phase, networkType, finalityProviderBtcPkHex, totalSat, true, oldState ? false : true);
            }

            // If it is a new delegation, increase the total counts
            if (!oldState) {
                staker.totalDelegationsCount += 1;
                staker.totalStakedSat += totalSat;
                
                // Update total statistics on a network basis
                if (staker.networkStats && staker.networkStats[networkType]) {
                    staker.networkStats[networkType].totalDelegations += 1;
                    staker.networkStats[networkType].totalStakedSat += totalSat;
                }

                // Update phase-based total statistics
                this.updatePhaseStats(staker, phase, networkType, finalityProviderBtcPkHex, totalSat, state === 'ACTIVE', true);

                // Update unique finality provider statistics
                this.updateUniqueFinalityProviders(staker, finalityProviderBtcPkHex, totalSat, state, true);
            } else if (oldState && oldState !== state) {
                // If the status has changed and became UNBONDED, update finality provider statistics
                if (state === 'UNBONDED') {
                    this.updateUniqueFinalityProviders(staker, finalityProviderBtcPkHex, totalSat, state, false);
                }
            }
        } catch (error) {
            StakerUtils.logError('Error updating staker stats', error);
            throw error;
        }
    }

    /**
     * Updates phase-based statistics
     * @param staker Staker document
     * @param phase Phase value
     * @param networkType Network type
     * @param finalityProviderBtcPkHex Finality provider BTC public key
     * @param totalSat Total satoshi amount
     * @param isActive Is active?
     * @param isNew Is new?
     */
    public updatePhaseStats(
        staker: any, 
        phase: number, 
        networkType: string, 
        finalityProviderBtcPkHex: string, 
        totalSat: number, 
        isActive: boolean, 
        isNew: boolean
    ): void {
        try {
            // Check the phase stats array
            if (!staker.phaseStats) {
                // Create Mongoose DocumentArray
                staker.phaseStats = staker.phaseStats || [];
            }

            // Is there a statistic for this phase?
            let phaseStats = staker.phaseStats.find((p: any) => p.phase === phase);
            
            if (!phaseStats) {
                // Create new phase statistic
                phaseStats = {
                    phase,
                    totalDelegations: 0,
                    totalStakedSat: 0,
                    activeDelegations: 0,
                    activeStakedSat: 0,
                    finalityProviders: []
                };
                staker.phaseStats.push(phaseStats);
            }

            // Update statistics
            if (isNew) {
                phaseStats.totalDelegations += 1;
                phaseStats.totalStakedSat += totalSat;
            }

            if (isActive) {
                phaseStats.activeDelegations += 1;
                phaseStats.activeStakedSat += totalSat;
            } else if (!isNew) {
                // If not active and not new, decrease the active counts
                phaseStats.activeDelegations = Math.max(0, phaseStats.activeDelegations - 1);
                phaseStats.activeStakedSat = Math.max(0, phaseStats.activeStakedSat - totalSat);
            }

            // Update finality provider statistics
            if (isNew) {
                let fpStats = phaseStats.finalityProviders.find((fp: any) => fp.btcPkHex === finalityProviderBtcPkHex);
                
                if (!fpStats) {
                    fpStats = {
                        btcPkHex: finalityProviderBtcPkHex,
                        delegationsCount: 0,
                        totalStakedSat: 0
                    };
                    phaseStats.finalityProviders.push(fpStats);
                }
                
                // Increase delegationsCount and totalStakedSat for delegations that are not UNBONDED
                // To be consistent with the logic in the fix-finality-provider-stats.ts script
                if (isActive) {
                    fpStats.delegationsCount += 1;
                    fpStats.totalStakedSat += totalSat;
                }
            }
        } catch (error) {
            StakerUtils.logError('Error updating phase stats', error);
            throw error;
        }
    }

    /**
     * Updates unique finality provider statistics
     * @param staker Staker document
     * @param finalityProviderBtcPkHex Finality provider BTC public key
     * @param totalSat Total satoshi amount
     * @param state Delegation state
     * @param isNew Is this a new delegation?
     */
    public updateUniqueFinalityProviders(
        staker: any, 
        finalityProviderBtcPkHex: string, 
        totalSat: number,
        state: string,
        isNew: boolean
    ): void {
        try {
            // Check the unique finality providers array
            if (!staker.uniqueFinalityProviders) {
                // Create Mongoose DocumentArray
                staker.uniqueFinalityProviders = staker.uniqueFinalityProviders || [];
            }

            // Is there a statistic for this finality provider?
            let fpStats = staker.uniqueFinalityProviders.find((fp: any) => fp.btcPkHex === finalityProviderBtcPkHex);
            
            if (!fpStats) {
                // Create new finality provider statistic
                fpStats = {
                    btcPkHex: finalityProviderBtcPkHex,
                    delegationsCount: 0,
                    totalStakedSat: 0
                };
                staker.uniqueFinalityProviders.push(fpStats);
            }
            
            // If it is a new delegation and not UNBONDED, increase the counter
            if (isNew) {
                if (state !== 'UNBONDED') {
                    fpStats.delegationsCount += 1;
                    fpStats.totalStakedSat += totalSat;
                }
            } 
            // If the delegation has transitioned to the UNBONDED state and is not new, decrease the counter
            else if (state === 'UNBONDED') {
                fpStats.delegationsCount = Math.max(0, fpStats.delegationsCount - 1);
                fpStats.totalStakedSat = Math.max(0, fpStats.totalStakedSat - totalSat);
            }
        } catch (error) {
            StakerUtils.logError('Error updating unique finality providers', error);
            throw error;
        }
    }

    /**
     * Resets staker statistics
     * @param staker Staker document
     */
    public resetStakerStats(staker: any): void {
        try {
            // Reset all staker statistics
            staker.activeDelegationsCount = 0;
            staker.totalDelegationsCount = 0;
            staker.totalStakedSat = 0;
            staker.activeStakedSat = 0;
            staker.delegationStates = {
                PENDING: 0,
                VERIFIED: 0,
                ACTIVE: 0,
                UNBONDED: 0
            };
            staker.networkStats = {
                mainnet: {
                    totalDelegations: 0,
                    activeDelegations: 0,
                    totalStakedSat: 0,
                    activeStakedSat: 0
                },
                testnet: {
                    totalDelegations: 0,
                    activeDelegations: 0,
                    totalStakedSat: 0,
                    activeStakedSat: 0
                }
            };
            
            // Reset phase statistics
            if (staker.phaseStats) {
                staker.phaseStats.splice(0);
            }
            
            // Reset unique finality provider statistics
            if (staker.uniqueFinalityProviders) {
                staker.uniqueFinalityProviders.splice(0);
            }
        } catch (error) {
            StakerUtils.logError('Error resetting staker stats', error);
            throw error;
        }
    }
}