import { Request, Response } from 'express';
import { CovenantSignature } from '../../database/models/CovenantSignature';
import { logger } from '../../utils/logger';
import covenantMembers from '../../config/covenant-members.json';
import { Network } from '../../types/finality';

export class CovenantController {
    // Tüm covenant üyelerini getir
    public async getCovenantMembers(req: Request, res: Response) {
        try {
            const network = (req.query.network as string || 'testnet') === 'mainnet' ? Network.MAINNET : Network.TESTNET;
            const keyField = network === Network.MAINNET ? 'mainnetPublicKeys' : 'testnetPublicKeys';

            const members = covenantMembers.map(member => ({
                organization: member.organization,
                logoUrl: member.logoUrl,
                details: member.details,
                website: member.website,
                publicKeys: member[keyField]
            }));

            res.json({ success: true, data: members });
        } catch (error) {
            logger.error(`[Covenant] Error getting covenant members: ${error}`);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }

    // Belirli bir üyenin imza istatistiklerini getir
    public async getMemberStats(req: Request, res: Response) {
        try {
            const { publicKey } = req.params;
            const network = (req.query.network as string || 'testnet') === 'mainnet' ? Network.MAINNET : Network.TESTNET;
            const keyField = network === Network.MAINNET ? 'mainnetPublicKeys' : 'testnetPublicKeys';

            // Üye bilgilerini bul
            const member = covenantMembers.find(m => m[keyField]?.includes(publicKey));
            if (!member) {
                return res.status(404).json({
                    success: false,
                    error: 'Member not found'
                });
            }

            // İmza istatistiklerini hesapla
            const allTxs = await CovenantSignature.find({ networkType: network });
            let totalSignatures = 0;
            let missedSignatures = 0;
            let signedSignatures = 0;
            const recentTransactions: any[] = [];

            for (const tx of allTxs) {
                const memberSignatures = tx.signatures.filter(s => s.covenantBtcPkHex === publicKey);
                const signedCount = memberSignatures.filter(s => s.state === 'SIGNED').length;
                const missedCount = memberSignatures.filter(s => s.state === 'MISSED').length;
                
                signedSignatures += signedCount;
                missedSignatures += missedCount;
                totalSignatures += signedCount + missedCount; // Pending durumları hariç tut

                // Son aktiviteleri topla
                memberSignatures.forEach(sig => {
                    if (sig.state !== 'PENDING' && recentTransactions.length < 5) {
                        recentTransactions.push({
                            txHash: tx.stakingTxIdHex,
                            state: sig.state,
                            signedAt: sig.signedAt
                        });
                    }
                });
            }

            // Son aktiviteleri tarihe göre sırala
            recentTransactions.sort((a, b) => {
                if (!a.signedAt) return 1;
                if (!b.signedAt) return -1;
                return new Date(b.signedAt).getTime() - new Date(a.signedAt).getTime();
            });

            // Eğer missed imza yoksa %100, varsa signed/(signed+missed)
            const signatureRate = missedSignatures === 0 ? 100 : ((signedSignatures / totalSignatures) * 100);

            // Son imza ve kaçırma tarihlerini bul
            const lastSignedTx = recentTransactions.find(tx => tx.state === 'SIGNED');
            const lastMissedTx = recentTransactions.find(tx => tx.state === 'MISSED');

            res.json({
                success: true,
                data: {
                    member: {
                        organization: member.organization,
                        details: member.details,
                        website: member.website,
                        logoUrl: member.logoUrl,
                        publicKeys: member[keyField] || []
                    },
                    stats: {
                        publicKey,
                        totalSignatures,
                        signedSignatures,
                        missedSignatures,
                        signatureRate: Math.round(signatureRate * 100) / 100,
                        recentActivity: {
                            lastSignedAt: lastSignedTx?.signedAt || null,
                            lastMissedAt: lastMissedTx?.signedAt || null,
                            recentTransactions
                        }
                    },
                    network
                }
            });
        } catch (error) {
            logger.error(`[Covenant] Error getting member stats: ${error}`);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }

    // Belirli bir transaction için imza durumlarını getir
    public async getTransactionSignatures(req: Request, res: Response) {
        try {
            const { txHash } = req.params;
            const network = (req.query.network as string || 'testnet') === 'mainnet' ? Network.MAINNET : Network.TESTNET;

            const txSignatures = await CovenantSignature.findOne({
                stakingTxIdHex: txHash,
                networkType: network
            });

            if (!txSignatures) {
                return res.status(404).json({
                    success: false,
                    error: 'Transaction signatures not found'
                });
            }

            res.json({
                success: true,
                data: {
                    transactionHash: txHash,
                    totalSignatures: txSignatures.totalSignatures,
                    signedCount: txSignatures.signedCount,
                    missedCount: txSignatures.missedCount,
                    signatures: txSignatures.signatures,
                    network
                }
            });
        } catch (error) {
            logger.error(`[Covenant] Error getting transaction signatures: ${error}`);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }

    // Son N transaction'ın imza durumlarını getir
    public async getRecentTransactions(req: Request, res: Response) {
        try {
            const { limit = 10 } = req.query;
            const network = (req.query.network as string || 'testnet') === 'mainnet' ? Network.MAINNET : Network.TESTNET;
            const parsedLimit = Math.min(parseInt(limit as string) || 10, 100); // max 100 tx

            const recentTxs = await CovenantSignature.find({ networkType: network })
                .sort({ blockHeight: -1 })
                .limit(parsedLimit);

            const formattedTxs = recentTxs.map(tx => {
                const signedCount = tx.signedCount;
                const missedCount = tx.missedCount;
                const totalCount = signedCount + missedCount; // Pending hariç
                const signatureRate = missedCount === 0 ? 100 : (totalCount > 0 ? ((signedCount / totalCount) * 100) : 0);

                return {
                    transactionHash: tx.stakingTxIdHex,
                    blockHeight: tx.blockHeight,
                    totalSignatures: totalCount,
                    signedCount,
                    missedCount,
                    signatureRate
                };
            });

            res.json({
                success: true,
                data: formattedTxs
            });
        } catch (error) {
            logger.error(`[Covenant] Error getting recent transactions: ${error}`);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }

    // Özet istatistikleri getir
    public async getSummaryStats(req: Request, res: Response) {
        try {
            const network = (req.query.network as string || 'testnet') === 'mainnet' ? Network.MAINNET : Network.TESTNET;

            const allTxs = await CovenantSignature.find({ networkType: network });
            
            const stats = {
                totalTransactions: allTxs.length,
                totalSignatures: 0,
                totalSigned: 0,
                totalMissed: 0,
                memberStats: new Map()
            };

            // Her bir transaction için istatistikleri hesapla
            for (const tx of allTxs) {
                const signedCount = tx.signedCount;
                const missedCount = tx.missedCount;
                stats.totalSigned += signedCount;
                stats.totalMissed += missedCount;
                stats.totalSignatures += signedCount + missedCount; // Pending hariç

                // Üye bazlı istatistikleri hesapla
                for (const sig of tx.signatures) {
                    if (sig.state === 'PENDING') continue; // Pending durumları atla

                    const memberStats = stats.memberStats.get(sig.covenantBtcPkHex) || {
                        total: 0,
                        signed: 0,
                        missed: 0
                    };

                    if (sig.state === 'SIGNED') {
                        memberStats.total++;
                        memberStats.signed++;
                    } else if (sig.state === 'MISSED') {
                        memberStats.total++;
                        memberStats.missed++;
                    }

                    stats.memberStats.set(sig.covenantBtcPkHex, memberStats);
                }
            }

            // Üye istatistiklerini formatla
            const formattedMemberStats = Array.from(stats.memberStats.entries()).map(([key, value]) => ({
                publicKey: key,
                totalSignatures: value.total,
                signedCount: value.signed,
                missedCount: value.missed,
                signatureRate: value.missed === 0 ? 100 : (value.total > 0 ? ((value.signed / value.total) * 100) : 0)
            }));

            res.json({
                success: true,
                data: {
                    totalTransactions: stats.totalTransactions,
                    totalSignatures: stats.totalSignatures,
                    totalSigned: stats.totalSigned,
                    totalMissed: stats.totalMissed,
                    overallSignatureRate: stats.totalMissed === 0 ? 100 : 
                        (stats.totalSignatures > 0 ? ((stats.totalSigned / stats.totalSignatures) * 100) : 0),
                    memberStats: formattedMemberStats,
                    network
                }
            });
        } catch (error) {
            logger.error(`[Covenant] Error getting summary stats: ${error}`);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }
} 