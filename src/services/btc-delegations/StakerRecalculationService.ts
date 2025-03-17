import { NewStaker } from '../../database/models/NewStaker';
import { NewBTCDelegation } from '../../database/models/NewBTCDelegation';
import { logger } from '../../utils/logger';
import { StakerUtils } from './utils/StakerUtils';
import { RecentDelegation } from './interfaces/StakerInterfaces';
import { StakerStatsService } from './StakerStatsService';
import { DelegationDetailsService } from './DelegationDetailsService';

export class StakerRecalculationService {
    private static instance: StakerRecalculationService | null = null;
    private stakerStatsService: StakerStatsService;
    private delegationDetailsService: DelegationDetailsService;

    private constructor() {
        this.stakerStatsService = StakerStatsService.getInstance();
        this.delegationDetailsService = DelegationDetailsService.getInstance();
    }

    public static getInstance(): StakerRecalculationService {
        if (!StakerRecalculationService.instance) {
            StakerRecalculationService.instance = new StakerRecalculationService();
        }
        return StakerRecalculationService.instance;
    }

    /**
     * Tüm staker istatistiklerini yeniden hesaplar
     * Bu metod, veritabanı tutarsızlıklarını düzeltmek için kullanılabilir
     */
    public async recalculateAllStakerStats(): Promise<void> {
        try {
            logger.info('Starting recalculation of all staker statistics...');
            
            // Tüm staker'ları getir
            const stakerCount = await NewStaker.countDocuments({});
            logger.info(`Found ${stakerCount} stakers to process`);
            
            // Toplu işleme için batch boyutu
            const batchSize = 50;
            let processedCount = 0;
            
            // Staker'ları batch'ler halinde işle
            for (let skip = 0; skip < stakerCount; skip += batchSize) {
                const stakers = await NewStaker.find({})
                    .skip(skip)
                    .limit(batchSize);
                
                // Her staker için istatistikleri güncelle
                for (const staker of stakers) {
                    try {
                        await this.recalculateStakerStats(staker);
                        logger.info(`Recalculated stats for staker: ${staker.stakerAddress}`);
                    } catch (error) {
                        logger.error(`Error recalculating stats for staker ${staker.stakerAddress}: ${error}`);
                    }
                }
                
                processedCount += stakers.length;
                logger.info(`Processed ${processedCount}/${stakerCount} stakers`);
            }
            
            logger.info('Completed recalculation of all staker statistics');
        } catch (error) {
            logger.error(`Error recalculating staker statistics: ${error}`);
            throw error;
        }
    }

    /**
     * Bir staker'ın istatistiklerini yeniden hesaplar
     * @param staker Staker dökümanı
     */
    public async recalculateStakerStats(staker: any): Promise<void> {
        try {
            // Staker'ın tüm istatistiklerini sıfırla
            this.stakerStatsService.resetStakerStats(staker);
            
            // Delegasyon detaylarını sıfırla
            if (staker.delegations) {
                staker.delegations.splice(0);
            }
            
            // Staker'ın tüm delegasyonlarını getir
            const delegations = await NewBTCDelegation.find({ stakerAddress: staker.stakerAddress });
            
            // İlk ve son staking zamanlarını sıfırla
            staker.firstStakingTime = null;
            staker.lastStakingTime = null;
            
            // Son delegasyonları temizle
            if (staker.recentDelegations) {
                staker.recentDelegations.splice(0);
            }
            
            // Geçici dizi oluştur
            const tempRecentDelegations: RecentDelegation[] = [];
            
            // Her delegasyon için istatistikleri güncelle
            for (const delegation of delegations) {
                // Phase hesapla - null veya undefined kontrolü yap
                const paramsVersion = delegation.paramsVersion !== null && delegation.paramsVersion !== undefined ? 
                    delegation.paramsVersion : undefined;
                const phase = StakerUtils.calculatePhase(paramsVersion);
                
                // İlk ve son staking zamanlarını güncelle
                if (!staker.firstStakingTime || (delegation.createdAt && new Date(delegation.createdAt).getTime() < staker.firstStakingTime)) {
                    staker.firstStakingTime = delegation.createdAt ? new Date(delegation.createdAt).getTime() : delegation.stakingTime;
                }
                if (!staker.lastStakingTime || (delegation.createdAt && new Date(delegation.createdAt).getTime() > staker.lastStakingTime)) {
                    staker.lastStakingTime = delegation.createdAt ? new Date(delegation.createdAt).getTime() : delegation.stakingTime;
                }
                
                // Delegasyon detayını ekle
                const delegationDetail = this.delegationDetailsService.createDelegationDetail(delegation, phase);
                staker.delegations.push(delegationDetail);
                
                // Toplam sayıları artır
                staker.totalDelegationsCount += 1;
                staker.totalStakedSat += delegation.totalSat;
                staker.delegationStates[delegation.state] += 1;
                
                // Ağ bazında toplam istatistikleri güncelle
                if (staker.networkStats) {
                    const networkStats = staker.networkStats[delegation.networkType];
                    if (networkStats) {
                        networkStats.totalDelegations += 1;
                        networkStats.totalStakedSat += delegation.totalSat;
                    }
                }
                
                // Eğer durum ACTIVE ise, aktif sayıları artır
                if (delegation.state === 'ACTIVE') {
                    staker.activeDelegationsCount += 1;
                    staker.activeStakedSat += delegation.totalSat;
                    
                    // Ağ bazında aktif istatistikleri güncelle
                    if (staker.networkStats) {
                        const networkStats = staker.networkStats[delegation.networkType];
                        if (networkStats) {
                            networkStats.activeDelegations += 1;
                            networkStats.activeStakedSat += delegation.totalSat;
                        }
                    }
                }
                
                // Phase bazlı istatistikleri güncelle
                this.stakerStatsService.updatePhaseStats(
                    staker, 
                    phase, 
                    delegation.networkType, 
                    delegation.finalityProviderBtcPksHex[0], 
                    delegation.totalSat, 
                    delegation.state === 'ACTIVE', 
                    true
                );
                
                // Unique finality provider istatistiklerini güncelle
                this.stakerStatsService.updateUniqueFinalityProviders(
                    staker, 
                    delegation.finalityProviderBtcPksHex[0], 
                    delegation.totalSat
                );
                
                // Son delegasyonları güncelle (en fazla 10 tane)
                if (tempRecentDelegations.length < 10) {
                    tempRecentDelegations.push({
                        stakingTxIdHex: delegation.stakingTxIdHex,
                        txHash: StakerUtils.formatTxHash(delegation.txHash, delegation.stakingTxIdHex),
                        state: delegation.state,
                        networkType: delegation.networkType,
                        totalSat: delegation.totalSat,
                        stakingTime: delegation.stakingTime
                    });
                }
            }
            
            // Son delegasyonları stakingTime'a göre sırala (en yeniden en eskiye)
            tempRecentDelegations.sort((a, b) => (b.stakingTime || 0) - (a.stakingTime || 0));
            
            // Sıralanmış delegasyonları staker'a ekle
            tempRecentDelegations.forEach(d => {
                staker.recentDelegations.push(d);
            });
            
            // Son güncelleme zamanını ayarla
            staker.lastUpdated = new Date();
            
            // Staker'ı kaydet
            await staker.save();
        } catch (error) {
            StakerUtils.logError(`Error recalculating stats for staker: ${staker.stakerAddress}`, error);
            throw error;
        }
    }
} 