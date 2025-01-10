import { CacheService } from '../CacheService';
import { BabylonClient } from '../../clients/BabylonClient';
import { BlockSignatureInfo, SignatureStats, SignatureStatsParams } from '../../types/finality';

export class FinalitySignatureService {
    private static instance: FinalitySignatureService | null = null;
    private readonly CACHE_TTL = 300; // 5 minutes

    private constructor(
        private readonly babylonClient: BabylonClient,
        private readonly cacheService: CacheService
    ) {}

    public static getInstance(): FinalitySignatureService {
        if (!FinalitySignatureService.instance) {
            const babylonClient = BabylonClient.getInstance(process.env.BABYLON_NODE_URL);
            const cacheService = CacheService.getInstance();
            FinalitySignatureService.instance = new FinalitySignatureService(babylonClient, cacheService);
        }
        return FinalitySignatureService.instance;
    }

    async getSignatureStats(params: SignatureStatsParams): Promise<SignatureStats> {
        const { fpBtcPkHex, startHeight, endHeight, lastNBlocks } = params;
        
        let actualStartHeight: number;
        let actualEndHeight: number;

        const currentHeight = await this.babylonClient.getCurrentHeight();

        if (lastNBlocks) {
            // Son bloğu hariç tut
            actualEndHeight = currentHeight - 1;
            actualStartHeight = actualEndHeight - lastNBlocks + 1;
        } else if (startHeight && endHeight) {
            actualStartHeight = startHeight;
            // Eğer bitiş yüksekliği mevcut yüksekliğe eşitse, bir blok geri git
            actualEndHeight = endHeight === currentHeight ? endHeight - 1 : endHeight;
        } else {
            throw new Error('Either lastNBlocks or both startHeight and endHeight must be provided');
        }

        // Cache key oluştur
        const cacheKey = `signature_stats:${fpBtcPkHex}:${actualStartHeight}:${actualEndHeight}`;
        
        // Cache'den kontrol et
        const cachedStats = await this.cacheService.get<string>(cacheKey);
        if (cachedStats) {
            return JSON.parse(cachedStats);
        }

        const signatureHistory: BlockSignatureInfo[] = [];
        const missedBlockHeights: number[] = [];
        let signedBlocks = 0;
        const epochStats: { [epochNumber: number]: any } = {};

        // Her blok için oy bilgisini kontrol et
        for (let height = actualStartHeight; height <= actualEndHeight; height++) {
            const [votes, epochInfo] = await Promise.all([
                this.babylonClient.getVotesAtHeight(height),
                this.babylonClient.getEpochByHeight(height)
            ]);

            // Debug log ekle
            console.debug('==================================');
            console.debug(`Processing height ${height}:`);
            console.debug('Raw votes:', votes);
            console.debug('Looking for FP:', fpBtcPkHex);
            console.debug('Available PKs:', votes.map(v => v.fp_btc_pk_hex));

            // İmza kontrolü - btc_pks array'i içinde public key'i arıyoruz
            const normalizedFpPk = fpBtcPkHex.toLowerCase().replace('0x', '');
            console.debug('Normalized search PK:', normalizedFpPk);

            const hasSigned = votes.some(vote => {
                const normalizedVotePk = vote.fp_btc_pk_hex.toLowerCase().replace('0x', '');
                console.debug('Comparing with normalized vote PK:', normalizedVotePk);
                const matches = normalizedVotePk === normalizedFpPk;
                if (matches) {
                    console.debug(`✅ Found matching vote for ${fpBtcPkHex} at height ${height}`);
                }
                return matches;
            });

            const epochNumber = epochInfo.epoch_number;

            // Epoch istatistiklerini güncelle
            if (!epochStats[epochNumber]) {
                epochStats[epochNumber] = {
                    totalBlocks: 0,
                    signedBlocks: 0,
                    missedBlocks: 0,
                    signatureRate: 0,
                    firstBlockHeight: epochInfo.first_block_height,
                    epochInterval: epochInfo.current_epoch_interval
                };
            }

            epochStats[epochNumber].totalBlocks++;
            if (hasSigned) {
                epochStats[epochNumber].signedBlocks++;
                signedBlocks++;
            } else {
                epochStats[epochNumber].missedBlocks++;
                missedBlockHeights.push(height);
            }

            signatureHistory.push({
                height,
                signed: hasSigned,
                timestamp: epochInfo.last_block_time ? new Date(epochInfo.last_block_time) : new Date(),
                epochNumber
            });
        }

        // Epoch bazlı signature rate'leri hesapla
        Object.keys(epochStats).forEach(epochNumber => {
            const stats = epochStats[Number(epochNumber)];
            stats.signatureRate = (stats.signedBlocks / stats.totalBlocks) * 100;
        });

        const totalBlocks = actualEndHeight - actualStartHeight + 1;
        const stats: SignatureStats = {
            fp_btc_pk_hex: fpBtcPkHex,
            startHeight: actualStartHeight,
            endHeight: actualEndHeight,
            currentHeight, // Mevcut yüksekliği de ekle
            totalBlocks,
            signedBlocks,
            missedBlocks: totalBlocks - signedBlocks,
            signatureRate: (signedBlocks / totalBlocks) * 100,
            missedBlockHeights,
            signatureHistory,
            epochStats,
            lastSignedBlock: signatureHistory
                .filter(block => block.signed)
                .sort((a, b) => b.height - a.height)[0]
        };

        // Cache'e kaydet
        await this.cacheService.set(cacheKey, JSON.stringify(stats), this.CACHE_TTL);

        return stats;
    }

    // Belirli bir provider'ın son N bloktaki performansını getir
    async getRecentSignatureStats(fpBtcPkHex: string, lastNBlocks: number): Promise<SignatureStats> {
        return this.getSignatureStats({
            fpBtcPkHex,
            lastNBlocks
        });
    }
} 