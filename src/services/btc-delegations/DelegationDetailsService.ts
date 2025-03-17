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
     * Delegasyon detaylarını günceller
     * @param staker Staker dökümanı
     * @param delegation Delegasyon verisi
     * @param phase Phase değeri
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
                paramsVersion 
            } = delegation;

            // Delegasyon detayı oluştur
            const delegationDetail: DelegationDetail = {
                stakingTxIdHex,
                txHash: StakerUtils.formatTxHash(txHash, stakingTxIdHex),
                finalityProviderBtcPkHex: finalityProviderBtcPksHex[0], // İlk finality provider'ı kullan
                totalSat,
                stakingTime,
                unbondingTime,
                state,
                networkType,
                paramsVersion,
                phase
            };

            // Mevcut delegasyonları kontrol et
            const existingDelegationIndex = staker.delegations ? 
                Array.from(staker.delegations).findIndex((d: any) => d.stakingTxIdHex === stakingTxIdHex) : -1;

            if (existingDelegationIndex !== -1) {
                // Mevcut delegasyonu güncelle
                if (staker.delegations[existingDelegationIndex]) {
                    staker.delegations[existingDelegationIndex].state = state;
                    if (txHash) staker.delegations[existingDelegationIndex].txHash = StakerUtils.formatTxHash(txHash, stakingTxIdHex);
                }
            } else {
                // Yeni delegasyon ekle
                if (!staker.delegations) {
                    // Mongoose DocumentArray oluştur
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
     * Delegasyon detayını oluşturur
     * @param delegation Delegasyon verisi
     * @param phase Phase değeri
     * @returns Delegasyon detayı
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
            paramsVersion 
        } = delegation;

        return {
            stakingTxIdHex,
            txHash: StakerUtils.formatTxHash(txHash, stakingTxIdHex),
            finalityProviderBtcPkHex: finalityProviderBtcPksHex[0], // İlk finality provider'ı kullan
            totalSat,
            stakingTime,
            unbondingTime,
            state,
            networkType,
            paramsVersion,
            phase
        };
    }
} 