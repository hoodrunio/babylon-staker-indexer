import { DelegationDetail } from './interfaces/StakerInterfaces';
import { StakerUtils } from './utils/StakerUtils';

export class DelegationDetailsService {
    private static instance: DelegationDetailsService | null = null;

    private constructor() {}

    public static getInstance(): DelegationDetailsService {
        if (!DelegationDetailsService.instance) {
            DelegationDetailsService.instance = new DelegationDetailsService();
        }
        return DelegationDetailsService.instance;
    }

    /**
     * Updates delegation details
     * @param staker Staker document
     * @param delegation Delegation data
     * @param phase Phase value
     */
    public async updateDelegationDetails(staker: any, delegation: any, phase: number): Promise<void> {
        try {
            const { 
                stakingTxIdHex, 
                txHash,
                finalityProviderBtcPksHex, 
                totalSat, 
                stakingTime, 
                unbondingTime, 
                state, 
                networkType, 
                paramsVersion,
                createdAt,
                updatedAt 
            } = delegation;

            // Create delegation detail
            const delegationDetail: DelegationDetail = {
                stakingTxIdHex,
                txHash: StakerUtils.formatTxHash(txHash, stakingTxIdHex),
                finalityProviderBtcPkHex: finalityProviderBtcPksHex[0], // Use the first finality provider
                totalSat,
                stakingTime,
                unbondingTime,
                state,
                networkType,
                paramsVersion,
                phase,
                createdAt: createdAt ? new Date(createdAt) : new Date(),
                updatedAt: updatedAt ? new Date(updatedAt) : new Date()
            };

            // Check existing delegations
            const existingDelegationIndex = staker.delegations ? 
                Array.from(staker.delegations).findIndex((d: any) => d.stakingTxIdHex === stakingTxIdHex) : -1;

            if (existingDelegationIndex !== -1) {
                // Update existing delegation
                if (staker.delegations[existingDelegationIndex]) {
                    staker.delegations[existingDelegationIndex].state = state;
                    if (txHash) staker.delegations[existingDelegationIndex].txHash = StakerUtils.formatTxHash(txHash, stakingTxIdHex);
                    staker.delegations[existingDelegationIndex].updatedAt = new Date();
                }
            } else {
                // Add new delegation
                if (!staker.delegations) {
                    // Create Mongoose DocumentArray
                    staker.delegations = staker.delegations || [];
                }
                staker.delegations.push(delegationDetail);
            }
        } catch (error) {
            StakerUtils.logError('Error updating delegation details', error);
            throw error;
        }
    }

    /**
     * Creates a delegation detail
     * @param delegation Delegation data
     * @param phase Phase value
     * @returns Delegation detail
     */
    public createDelegationDetail(delegation: any, phase: number): DelegationDetail {
        const { 
            stakingTxIdHex, 
            txHash,
            finalityProviderBtcPksHex, 
            totalSat, 
            stakingTime, 
            unbondingTime, 
            state, 
            networkType, 
            paramsVersion,
            createdAt,
            updatedAt 
        } = delegation;

        return {
            stakingTxIdHex,
            txHash: StakerUtils.formatTxHash(txHash, stakingTxIdHex),
            finalityProviderBtcPkHex: finalityProviderBtcPksHex[0], // Use the first finality provider
            totalSat,
            stakingTime,
            unbondingTime,
            state,
            networkType,
            paramsVersion,
            phase,
            createdAt: createdAt ? new Date(createdAt) : new Date(),
            updatedAt: updatedAt ? new Date(updatedAt) : new Date()
        };
    }
}