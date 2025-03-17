import { NewStaker } from '../../database/models/NewStaker';
import { NewBTCDelegation } from '../../database/models/NewBTCDelegation';
import { logger } from '../../utils/logger';
import { StakerUtils } from './utils/StakerUtils';
import { RecentDelegation } from './interfaces/StakerInterfaces';

export class StakerManagementService {
    private static instance: StakerManagementService | null = null;

    private constructor() {}

    public static getInstance(): StakerManagementService {
        if (!StakerManagementService.instance) {
            StakerManagementService.instance = new StakerManagementService();
        }
        return StakerManagementService.instance;
    }

    /**
     * Staker'ı bulur veya oluşturur
     * @param stakerAddress Staker adresi
     * @param stakerBtcAddress Staker BTC adresi
     * @param stakerBtcPkHex Staker BTC public key'i
     * @param stakingTime Staking zamanı
     */
    public async findOrCreateStaker(
        stakerAddress: string,
        stakerBtcAddress: string,
        stakerBtcPkHex: string,
        stakingTime: number
    ): Promise<any> {
        try {
            let staker = await NewStaker.findOne({ stakerAddress });
            
            if (!staker) {
                staker = new NewStaker({
                    stakerAddress,
                    stakerBtcAddress: stakerBtcAddress || '',
                    stakerBtcPkHex: stakerBtcPkHex || '',
                    firstStakingTime: stakingTime,
                    lastStakingTime: stakingTime,
                    delegations: [],
                    uniqueFinalityProviders: [],
                    phaseStats: []
                });
            } else {
                // Staker BTC bilgilerini güncelle (eğer boşsa)
                if (!staker.stakerBtcAddress && stakerBtcAddress) {
                    staker.stakerBtcAddress = stakerBtcAddress;
                }
                if (!staker.stakerBtcPkHex && stakerBtcPkHex) {
                    staker.stakerBtcPkHex = stakerBtcPkHex;
                }

                // İlk ve son staking zamanlarını güncelle
                if (!staker.firstStakingTime || stakingTime < staker.firstStakingTime) {
                    staker.firstStakingTime = stakingTime;
                }
                if (!staker.lastStakingTime || stakingTime > staker.lastStakingTime) {
                    staker.lastStakingTime = stakingTime;
                }
            }
            
            return staker;
        } catch (error) {
            StakerUtils.logError('Error finding or creating staker', error);
            throw error;
        }
    }

    /**
     * Son delegasyonları günceller
     * @param staker Staker dökümanı
     * @param newDelegation Yeni delegasyon
     */
    public updateRecentDelegations(staker: any, newDelegation: RecentDelegation): void {
        try {
            // Mevcut recentDelegations'ı bir array olarak alıp işlem yapalım
            const currentDelegations: RecentDelegation[] = staker.recentDelegations ? 
                Array.from(staker.recentDelegations).map((d: any) => ({
                    stakingTxIdHex: d.stakingTxIdHex,
                    txHash: d.txHash,
                    state: d.state,
                    networkType: d.networkType,
                    totalSat: d.totalSat,
                    stakingTime: d.stakingTime
                })) : [];

            // Eğer bu delegasyon zaten varsa, güncelle
            const existingIndex = currentDelegations.findIndex(d => d.stakingTxIdHex === newDelegation.stakingTxIdHex);
            if (existingIndex !== -1) {
                currentDelegations[existingIndex] = newDelegation;
            } else {
                // Yoksa ekle ve en fazla 10 tane tut
                currentDelegations.unshift(newDelegation);
                if (currentDelegations.length > 10) {
                    currentDelegations.splice(10);
                }
            }

            // Güncellenmiş recentDelegations'ı staker'a ata
            // Önce mevcut diziyi temizle
            if (staker.recentDelegations) {
                staker.recentDelegations.splice(0);
            }
            
            // Sonra yeni değerleri ekle
            currentDelegations.forEach(d => {
                staker.recentDelegations.push(d);
            });
        } catch (error) {
            StakerUtils.logError('Error updating recent delegations', error);
            throw error;
        }
    }

    /**
     * Delegasyonlardan staker'ları oluşturur
     * Bu metod, delegasyonlardan staker'ları oluşturmak için kullanılır
     */
    public async createStakersFromDelegations(): Promise<void> {
        try {
            logger.info('Starting to create stakers from delegations...');
            
            // Tüm staker adreslerini getir (distinct)
            const stakerAddresses = await NewBTCDelegation.distinct('stakerAddress');
            
            logger.info(`Found ${stakerAddresses.length} unique staker addresses`);
            
            // Toplu işleme için batch boyutu
            const batchSize = 100;
            let processedCount = 0;
            let createdCount = 0;
            
            // Staker adreslerini batch'ler halinde işle
            for (let i = 0; i < stakerAddresses.length; i += batchSize) {
                const batch = stakerAddresses.slice(i, i + batchSize);
                
                // Her batch için paralel işlem
                await Promise.all(batch.map(async (stakerAddress) => {
                    try {
                        // Staker'ın zaten var olup olmadığını kontrol et
                        const existingStaker = await NewStaker.findOne({ stakerAddress });
                        
                        if (!existingStaker) {
                            // Staker'ın ilk delegasyonunu getir
                            const firstDelegation = await NewBTCDelegation.findOne({ stakerAddress })
                                .sort({ createdAt: 1 })
                                .limit(1);
                            
                            if (firstDelegation) {
                                // Yeni staker oluştur
                                const newStaker = new NewStaker({
                                    stakerAddress,
                                    stakerBtcAddress: firstDelegation.stakerBtcAddress || '',
                                    stakerBtcPkHex: firstDelegation.stakerBtcPkHex || '',
                                    firstStakingTime: firstDelegation.createdAt ? new Date(firstDelegation.createdAt).getTime() : firstDelegation.stakingTime,
                                    lastStakingTime: firstDelegation.createdAt ? new Date(firstDelegation.createdAt).getTime() : firstDelegation.stakingTime,
                                    delegations: [],
                                    uniqueFinalityProviders: [],
                                    phaseStats: [],
                                    delegationStates: {
                                        PENDING: 0,
                                        VERIFIED: 0,
                                        ACTIVE: 0,
                                        UNBONDED: 0
                                    },
                                    networkStats: {
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
                                    }
                                });
                                
                                // Staker'ı kaydet
                                await newStaker.save();
                                createdCount++;
                            }
                        }
                    } catch (error) {
                        logger.error(`Error processing staker ${stakerAddress}: ${error}`);
                    }
                }));
                
                processedCount += batch.length;
                logger.info(`Processed ${processedCount}/${stakerAddresses.length} stakers, created ${createdCount} new stakers`);
            }
            
            logger.info(`Completed creating stakers from delegations. Created ${createdCount} new stakers`);
        } catch (error) {
            logger.error(`Error creating stakers from delegations: ${error}`);
            throw error;
        }
    }
} 