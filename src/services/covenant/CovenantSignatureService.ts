import { CovenantSignature, ICovenantSignatureDocument } from '../../database/models/CovenantSignature';
import { logger } from '../../utils/logger';

export class CovenantSignatureService {
    // When a new delegation is created
    async createPendingSignatures(
        stakingTxIdHex: string,
        networkType: string,
        covenantMembers: string[],
        blockHeight: number
    ): Promise<void> {
        try {
            // Check if record already exists
            const existingRecord = await CovenantSignature.findOne({
                stakingTxIdHex,
                networkType,
                txType: 'STAKING'
            });

            if (existingRecord) {
                logger.info(`[Covenant] Signatures already exist for staking tx: ${stakingTxIdHex}, skipping creation`);
                return;
            }

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

            try {
                await CovenantSignature.create(newTxSignatures);
                logger.info(`[Covenant] Created pending signatures for staking tx: ${stakingTxIdHex}`);
            } catch (createError: any) {
                // Handle race conditions - another process might have created the record
                // between our check and the actual creation
                if (createError.code === 11000) { // MongoDB duplicate key error code
                    logger.info(`[Covenant] Duplicate entry detected for staking tx: ${stakingTxIdHex}, skipping creation`);
                    return; // Silently exit as this is an expected case in concurrent environments
                } else {
                    throw createError; // Re-throw other errors
                }
            }
        } catch (error) {
            logger.error(`[Covenant] Error creating pending signatures: ${error}`);
            throw error;
        }
    }

    // When a signature is received
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

    // When the delegation status changes
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

    // Get signature statistics
    async getSignatureStats(
        networkType: string,
        covenantBtcPkHex: string
    ): Promise<{
        totalSignatures: number;
        missedSignatures: number;
        signedSignatures: number;
        signatureRate: number;
    }> {
        try {
            const allTxs = await CovenantSignature.find({ networkType });
            let totalSignatures = 0;
            let missedSignatures = 0;
            let signedSignatures = 0;

            for (const tx of allTxs) {
                const memberSignatures = tx.signatures.filter(s => s.covenantBtcPkHex === covenantBtcPkHex);
                const signedCount = memberSignatures.filter(s => s.state === 'SIGNED').length;
                const missedCount = memberSignatures.filter(s => s.state === 'MISSED').length;
                
                signedSignatures += signedCount;
                missedSignatures += missedCount;
                totalSignatures += signedCount + missedCount; // Exclude Pending states
            }

            // If there are no missed signatures, it's 100%, otherwise signed/(signed+missed)
            const signatureRate = missedSignatures === 0 ? 100 : ((signedSignatures / totalSignatures) * 100);

            return {
                totalSignatures,
                missedSignatures,
                signedSignatures,
                signatureRate
            };
        } catch (error) {
            logger.error(`[Covenant] Error getting signature stats: ${error}`);
            throw error;
        }
    }
}