import { Buffer } from 'buffer';
import { logger } from './logger';
export const formatSatoshis = (satoshis: number): string => {
    return (satoshis / 100000000).toFixed(8);
};

export const calculatePowerPercentage = (power: string, totalPower: string): string => {
    if (!totalPower || totalPower === '0') return '0';
    
    const powerBigInt = BigInt(power);
    const totalPowerBigInt = BigInt(totalPower);
    
    const scaledPercentage = (powerBigInt * BigInt(10000)) / totalPowerBigInt;
    const actualPercentage = Number(scaledPercentage) / 100;        
    return actualPercentage.toFixed(2);
}

export const convertBase64AddressToHex = (base64Address: string): string => {
    try {
        const bytes = Buffer.from(base64Address, 'base64');
        return bytes.toString('hex').toUpperCase();
    } catch (error) {
        logger.error('[BLSCheckpoint] Error converting base64 address to hex:', error);
        throw error;
    }
}