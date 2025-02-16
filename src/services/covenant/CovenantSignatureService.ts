import { CovenantSignature, ICovenantSignatureDocument } from '../../database/models/CovenantSignature';
import { logger } from '../../utils/logger';

export class CovenantSignatureService {
    // Yeni delegasyon oluşturulduğunda
    async createPendingSignatures(
        stakingTxIdHex: string,
        networkType: string,
        covenantMembers: string[],
        blockHeight: number
    ): Promise<void> {
        try {
            const signatures = covenantMembers.map(memberPkHex => ({
                covenantBtcPkHex: memberPkHex,
                signatureHex: '',
                state: 'PENDING' as const
            }));

            const newTxSignatures = {
                stakingTxIdHex,
                networkType,
                txType: 'STAKING' as const,
                blockHeight,
                signatures,
                totalSignatures: covenantMembers.length,
                signedCount: 0,
                missedCount: 0
            };

            await CovenantSignature.create(newTxSignatures);
            logger.info(`[Covenant] Created pending signatures for staking tx: ${stakingTxIdHex}`);
        } catch (error) {
            logger.error(`[Covenant] Error creating pending signatures: ${error}`);
            throw error;
        }
    }

    // İmza alındığında
    async recordSignature(
        stakingTxIdHex: string,
        covenantBtcPkHex: string,
        signatureHex: string,
        txType: 'STAKING' | 'UNBONDING',
        networkType: string,
        blockHeight: number
    ): Promise<void> {
        try {
            const txSignatures: ICovenantSignatureDocument | null = await CovenantSignature.findOne({
                stakingTxIdHex,
                txType,
                networkType
            });

            if (txSignatures) {
                await txSignatures.markAsSigned(covenantBtcPkHex, signatureHex, blockHeight);
                logger.info(`[Covenant] Recorded signature for staking tx: ${stakingTxIdHex}, covenant: ${covenantBtcPkHex}`);
            } else {
                logger.warn(`[Covenant] No transaction found for staking tx: ${stakingTxIdHex}`);
            }
        } catch (error) {
            logger.error(`[Covenant] Error recording signature: ${error}`);
            throw error;
        }
    }

    // Delegasyon durumu değiştiğinde
    async handleStateChange(
        stakingTxIdHex: string,
        newState: string,
        networkType: string
    ): Promise<void> {
        try {
            if (newState === 'ACTIVE' || newState === 'UNBONDED') {
                const txType = newState === 'ACTIVE' ? 'STAKING' : 'UNBONDING';
                const txSignatures: ICovenantSignatureDocument | null = await CovenantSignature.findOne({
                    stakingTxIdHex,
                    txType,
                    networkType
                });

                if (txSignatures) {
                    const pendingSignatures = txSignatures.signatures.filter(s => s.state === 'PENDING');
                    for (const signature of pendingSignatures) {
                        await txSignatures.markAsMissed(signature.covenantBtcPkHex);
                    }

                    logger.info(`[Covenant] Marked ${pendingSignatures.length} signatures as missed for staking tx: ${stakingTxIdHex}`);
                }
            }
        } catch (error) {
            logger.error(`[Covenant] Error handling state change: ${error}`);
            throw error;
        }
    }

    // İmza istatistiklerini getir
    async getSignatureStats(
        networkType: string,
        covenantBtcPkHex: string
    ): Promise<{
        totalSignatures: number;
        missedSignatures: number;
        signatureRate: number;
    }> {
        try {
            const allTxs = await CovenantSignature.find({ networkType });
            let totalSignatures = 0;
            let missedSignatures = 0;

            for (const tx of allTxs) {
                const memberSignatures = tx.signatures.filter(s => s.covenantBtcPkHex === covenantBtcPkHex);
                totalSignatures += memberSignatures.length;
                missedSignatures += memberSignatures.filter(s => s.state === 'MISSED').length;
            }

            const signatureRate = totalSignatures > 0 ? ((totalSignatures - missedSignatures) / totalSignatures) * 100 : 100;

            return {
                totalSignatures,
                missedSignatures,
                signatureRate
            };
        } catch (error) {
            logger.error(`[Covenant] Error getting signature stats: ${error}`);
            throw error;
        }
    }
} 