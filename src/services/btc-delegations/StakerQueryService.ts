import { NewStaker } from '../../database/models/NewStaker';
import { NewBTCDelegation } from '../../database/models/NewBTCDelegation';
import { StakerUtils } from './utils/StakerUtils';

export class StakerQueryService {
    private static instance: StakerQueryService | null = null;

    private constructor() {}

    public static getInstance(): StakerQueryService {
        if (!StakerQueryService.instance) {
            StakerQueryService.instance = new StakerQueryService();
        }
        return StakerQueryService.instance;
    }

    /**
     * Tüm staker'ları getirir
     * @param limit Limit
     * @param skip Atlanacak kayıt sayısı
     * @param sortField Sıralama alanı
     * @param sortOrder Sıralama yönü (asc/desc)
     */
    public async getAllStakers(limit = 10, skip = 0, sortField = 'totalStakedSat', sortOrder = 'desc'): Promise<any[]> {
        try {
            const sort: any = {};
            sort[sortField] = sortOrder === 'asc' ? 1 : -1;
            
            return NewStaker.find({})
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean();
        } catch (error) {
            StakerUtils.logError('Error getting all stakers', error);
            throw error;
        }
    }

    /**
     * Toplam staker sayısını getirir
     */
    public async getStakersCount(): Promise<number> {
        try {
            return NewStaker.countDocuments({});
        } catch (error) {
            StakerUtils.logError('Error getting stakers count', error);
            throw error;
        }
    }

    /**
     * Bir staker'ı ID'sine göre getirir
     * @param stakerAddress Staker adresi
     */
    public async getStakerByAddress(stakerAddress: string): Promise<any> {
        try {
            return NewStaker.findOne({ stakerAddress }).lean();
        } catch (error) {
            StakerUtils.logError(`Error getting staker by address: ${stakerAddress}`, error);
            throw error;
        }
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
        try {
            const sort: any = {};
            sort[sortField] = sortOrder === 'asc' ? 1 : -1;
            
            return NewBTCDelegation.find({ stakerAddress })
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean();
        } catch (error) {
            StakerUtils.logError(`Error getting staker delegations: ${stakerAddress}`, error);
            throw error;
        }
    }

    /**
     * Bir staker'ın phase bazlı istatistiklerini getirir
     * @param stakerAddress Staker adresi
     * @param phase Phase değeri (opsiyonel)
     */
    public async getStakerPhaseStats(stakerAddress: string, phase?: number): Promise<any[]> {
        try {
            const staker = await NewStaker.findOne({ stakerAddress }).lean();
            
            if (!staker || !staker.phaseStats) {
                return [];
            }
            
            if (phase !== undefined) {
                const phaseStats = staker.phaseStats.find((p: any) => p.phase === phase);
                return phaseStats ? [phaseStats] : [];
            }
            
            return staker.phaseStats;
        } catch (error) {
            StakerUtils.logError(`Error getting staker phase stats: ${stakerAddress}`, error);
            throw error;
        }
    }

    /**
     * Bir staker'ın unique finality provider'larını getirir
     * @param stakerAddress Staker adresi
     */
    public async getStakerUniqueFinalityProviders(stakerAddress: string): Promise<any[]> {
        try {
            const staker = await NewStaker.findOne({ stakerAddress }).lean();
            
            if (!staker || !staker.uniqueFinalityProviders) {
                return [];
            }
            
            return staker.uniqueFinalityProviders;
        } catch (error) {
            StakerUtils.logError(`Error getting staker unique finality providers: ${stakerAddress}`, error);
            throw error;
        }
    }
} 