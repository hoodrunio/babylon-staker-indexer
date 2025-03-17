import { logger } from '../../utils/logger';
import { StakerUtils } from './utils/StakerUtils';
import { StakerManagementService } from './StakerManagementService';
import { DelegationDetailsService } from './DelegationDetailsService';
import { StakerStatsService } from './StakerStatsService';
import { StakerQueryService } from './StakerQueryService';
import { StakerRecalculationService } from './StakerRecalculationService';
import { RecentDelegation } from './interfaces/StakerInterfaces';

export class NewStakerService {
    private static instance: NewStakerService | null = null;
    private stakerManagementService: StakerManagementService;
    private delegationDetailsService: DelegationDetailsService;
    private stakerStatsService: StakerStatsService;
    private stakerQueryService: StakerQueryService;
    private stakerRecalculationService: StakerRecalculationService;

    private constructor() {
        this.stakerManagementService = StakerManagementService.getInstance();
        this.delegationDetailsService = DelegationDetailsService.getInstance();
        this.stakerStatsService = StakerStatsService.getInstance();
        this.stakerQueryService = StakerQueryService.getInstance();
        this.stakerRecalculationService = StakerRecalculationService.getInstance();
    }

    public static getInstance(): NewStakerService {
        if (!NewStakerService.instance) {
            NewStakerService.instance = new NewStakerService();
        }
        return NewStakerService.instance;
    }

    /**
     * Yeni bir delegasyon eklendiğinde veya güncellendiğinde staker bilgilerini günceller
     * @param delegation Delegasyon verisi
     */
    public async updateStakerFromDelegation(delegation: any): Promise<void> {
        try {
            const { 
                stakerAddress, 
                stakerBtcAddress, 
                stakerBtcPkHex, 
                state, 
                networkType, 
                totalSat, 
                stakingTime, 
                stakingTxIdHex, 
                txHash,
                paramsVersion
            } = delegation;

            // Phase hesapla
            const phase = StakerUtils.calculatePhase(paramsVersion);

            // Staker'ı bul veya oluştur
            let staker = await this.stakerManagementService.findOrCreateStaker(
                stakerAddress,
                stakerBtcAddress,
                stakerBtcPkHex,
                stakingTime
            );

            // Son delegasyonları güncelle
            const recentDelegation: RecentDelegation = {
                stakingTxIdHex,
                txHash: StakerUtils.formatTxHash(txHash, stakingTxIdHex),
                state,  
                networkType,
                totalSat,
                stakingTime
            };
            this.stakerManagementService.updateRecentDelegations(staker, recentDelegation);

            // Delegasyon detaylarını güncelle
            await this.delegationDetailsService.updateDelegationDetails(staker, delegation, phase);

            // Staker istatistiklerini güncelle
            await this.stakerStatsService.updateStakerStats(staker, delegation, phase);

            // Son güncelleme zamanını ayarla
            staker.lastUpdated = new Date();

            // Staker'ı kaydet
            await staker.save();
        } catch (error) {
            logger.error(`Error updating staker from delegation: ${error}`);
            throw error;
        }
    }

    /**
     * Tüm staker istatistiklerini yeniden hesaplar
     * Bu metod, veritabanı tutarsızlıklarını düzeltmek için kullanılabilir
     */
    public async recalculateAllStakerStats(): Promise<void> {
        return this.stakerRecalculationService.recalculateAllStakerStats();
    }

    /**
     * Delegasyonlardan staker'ları oluşturur
     * Bu metod, delegasyonlardan staker'ları oluşturmak için kullanılır
     */
    public async createStakersFromDelegations(): Promise<void> {
        return this.stakerManagementService.createStakersFromDelegations();
    }

    /**
     * Tüm staker'ları getirir
     * @param limit Limit
     * @param skip Atlanacak kayıt sayısı
     * @param sortField Sıralama alanı
     * @param sortOrder Sıralama yönü (asc/desc)
     */
    public async getAllStakers(limit = 10, skip = 0, sortField = 'totalStakedSat', sortOrder = 'desc'): Promise<any[]> {
        return this.stakerQueryService.getAllStakers(limit, skip, sortField, sortOrder);
    }

    /**
     * Toplam staker sayısını getirir
     */
    public async getStakersCount(): Promise<number> {
        return this.stakerQueryService.getStakersCount();
    }

    /**
     * Bir staker'ı ID'sine göre getirir
     * @param stakerAddress Staker adresi
     */
    public async getStakerByAddress(stakerAddress: string): Promise<any> {
        return this.stakerQueryService.getStakerByAddress(stakerAddress);
    }

    /**
     * Bir staker'ın delegasyonlarını getirir
     * @param stakerAddress Staker adresi
     * @param limit Limit
     * @param skip Atlanacak kayıt sayısı
     * @param sortField Sıralama alanı
     * @param sortOrder Sıralama yönü (asc/desc)
     */
    public async getStakerDelegations(
        stakerAddress: string, 
        limit = 10, 
        skip = 0, 
        sortField = 'stakingTime', 
        sortOrder = 'desc'
    ): Promise<any[]> {
        return this.stakerQueryService.getStakerDelegations(stakerAddress, limit, skip, sortField, sortOrder);
    }

    /**
     * Bir staker'ın phase bazlı istatistiklerini getirir
     * @param stakerAddress Staker adresi
     * @param phase Phase değeri (opsiyonel)
     */
    public async getStakerPhaseStats(stakerAddress: string, phase?: number): Promise<any[]> {
        return this.stakerQueryService.getStakerPhaseStats(stakerAddress, phase);
    }

    /**
     * Bir staker'ın unique finality provider'larını getirir
     * @param stakerAddress Staker adresi
     */
    public async getStakerUniqueFinalityProviders(stakerAddress: string): Promise<any[]> {
        return this.stakerQueryService.getStakerUniqueFinalityProviders(stakerAddress);
    }
} 