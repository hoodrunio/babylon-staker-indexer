import { FinalityProviderStat, PhaseStat } from './interfaces/StakerInterfaces';
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
     * Staker istatistiklerini günceller
     * @param staker Staker dökümanı
     * @param delegation Delegasyon verisi
     * @param phase Phase değeri
     */
    public async updateStakerStats(staker: any, delegation: any, phase: number): Promise<void> {
        try {
            const { state, networkType, totalSat, stakingTxIdHex, finalityProviderBtcPksHex } = delegation;
            const finalityProviderBtcPkHex = finalityProviderBtcPksHex[0]; // İlk finality provider'ı kullan
            const oldState = staker.recentDelegations.find((d: any) => d.stakingTxIdHex === stakingTxIdHex)?.state;

            // Eğer durum değişmişse, eski durumu azalt
            if (oldState && oldState !== state) {
                staker.delegationStates[oldState] = Math.max(0, (staker.delegationStates[oldState] || 0) - 1);
                
                // Eğer eski durum ACTIVE ise ve yeni durum ACTIVE değilse, aktif sayılarını azalt
                if (oldState === 'ACTIVE' && state !== 'ACTIVE') {
                    staker.activeDelegationsCount = Math.max(0, staker.activeDelegationsCount - 1);
                    staker.activeStakedSat = Math.max(0, staker.activeStakedSat - totalSat);
                    
                    // Ağ bazında aktif istatistikleri güncelle
                    if (staker.networkStats && staker.networkStats[networkType]) {
                        staker.networkStats[networkType].activeDelegations = Math.max(0, staker.networkStats[networkType].activeDelegations - 1);
                        staker.networkStats[networkType].activeStakedSat = Math.max(0, staker.networkStats[networkType].activeStakedSat - totalSat);
                    }

                    // Phase bazlı aktif istatistikleri güncelle
                    this.updatePhaseStats(staker, phase, networkType, finalityProviderBtcPkHex, totalSat, false, false);
                }
            }

            // Yeni durumu artır
            staker.delegationStates[state] = (staker.delegationStates[state] || 0) + 1;

            // Eğer yeni durum ACTIVE ise ve eski durum ACTIVE değilse, aktif sayılarını artır
            if (state === 'ACTIVE' && oldState !== 'ACTIVE') {
                staker.activeDelegationsCount += 1;
                staker.activeStakedSat += totalSat;
                
                // Ağ bazında aktif istatistikleri güncelle
                if (staker.networkStats && staker.networkStats[networkType]) {
                    staker.networkStats[networkType].activeDelegations += 1;
                    staker.networkStats[networkType].activeStakedSat += totalSat;
                }

                // Phase bazlı aktif istatistikleri güncelle
                this.updatePhaseStats(staker, phase, networkType, finalityProviderBtcPkHex, totalSat, true, oldState ? false : true);
            }

            // Eğer yeni bir delegasyon ise, toplam sayıları artır
            if (!oldState) {
                staker.totalDelegationsCount += 1;
                staker.totalStakedSat += totalSat;
                
                // Ağ bazında toplam istatistikleri güncelle
                if (staker.networkStats && staker.networkStats[networkType]) {
                    staker.networkStats[networkType].totalDelegations += 1;
                    staker.networkStats[networkType].totalStakedSat += totalSat;
                }

                // Phase bazlı toplam istatistikleri güncelle
                this.updatePhaseStats(staker, phase, networkType, finalityProviderBtcPkHex, totalSat, state === 'ACTIVE', true);

                // Unique finality provider istatistiklerini güncelle
                this.updateUniqueFinalityProviders(staker, finalityProviderBtcPkHex, totalSat);
            }
        } catch (error) {
            StakerUtils.logError('Error updating staker stats', error);
            throw error;
        }
    }

    /**
     * Phase bazlı istatistikleri günceller
     * @param staker Staker dökümanı
     * @param phase Phase değeri
     * @param networkType Ağ tipi
     * @param finalityProviderBtcPkHex Finality provider BTC public key'i
     * @param totalSat Toplam satoshi miktarı
     * @param isActive Aktif mi?
     * @param isNew Yeni mi?
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
            // Phase stats dizisini kontrol et
            if (!staker.phaseStats) {
                // Mongoose DocumentArray oluştur
                staker.phaseStats = staker.phaseStats || [];
            }

            // Bu phase için istatistik var mı?
            let phaseStats = staker.phaseStats.find((p: any) => p.phase === phase);
            
            if (!phaseStats) {
                // Yeni phase istatistiği oluştur
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

            // İstatistikleri güncelle
            if (isNew) {
                phaseStats.totalDelegations += 1;
                phaseStats.totalStakedSat += totalSat;
            }

            if (isActive) {
                phaseStats.activeDelegations += 1;
                phaseStats.activeStakedSat += totalSat;
            } else if (!isNew) {
                // Aktif değilse ve yeni değilse, aktif sayılarını azalt
                phaseStats.activeDelegations = Math.max(0, phaseStats.activeDelegations - 1);
                phaseStats.activeStakedSat = Math.max(0, phaseStats.activeStakedSat - totalSat);
            }

            // Finality provider istatistiklerini güncelle
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
                
                fpStats.delegationsCount += 1;
                fpStats.totalStakedSat += totalSat;
            }
        } catch (error) {
            StakerUtils.logError('Error updating phase stats', error);
            throw error;
        }
    }

    /**
     * Unique finality provider istatistiklerini günceller
     * @param staker Staker dökümanı
     * @param finalityProviderBtcPkHex Finality provider BTC public key'i
     * @param totalSat Toplam satoshi miktarı
     */
    public updateUniqueFinalityProviders(staker: any, finalityProviderBtcPkHex: string, totalSat: number): void {
        try {
            // Unique finality providers dizisini kontrol et
            if (!staker.uniqueFinalityProviders) {
                // Mongoose DocumentArray oluştur
                staker.uniqueFinalityProviders = staker.uniqueFinalityProviders || [];
            }

            // Bu finality provider için istatistik var mı?
            let fpStats = staker.uniqueFinalityProviders.find((fp: any) => fp.btcPkHex === finalityProviderBtcPkHex);
            
            if (!fpStats) {
                // Yeni finality provider istatistiği oluştur
                fpStats = {
                    btcPkHex: finalityProviderBtcPkHex,
                    delegationsCount: 0,
                    totalStakedSat: 0
                };
                staker.uniqueFinalityProviders.push(fpStats);
            }
            
            // İstatistikleri güncelle
            fpStats.delegationsCount += 1;
            fpStats.totalStakedSat += totalSat;
        } catch (error) {
            StakerUtils.logError('Error updating unique finality providers', error);
            throw error;
        }
    }

    /**
     * Staker istatistiklerini sıfırlar
     * @param staker Staker dökümanı
     */
    public resetStakerStats(staker: any): void {
        try {
            // Staker'ın tüm istatistiklerini sıfırla
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
            
            // Phase istatistiklerini sıfırla
            if (staker.phaseStats) {
                staker.phaseStats.splice(0);
            }
            
            // Unique finality provider istatistiklerini sıfırla
            if (staker.uniqueFinalityProviders) {
                staker.uniqueFinalityProviders.splice(0);
            }
        } catch (error) {
            StakerUtils.logError('Error resetting staker stats', error);
            throw error;
        }
    }
} 