import { createHash } from 'crypto';

function readVarint(data: Buffer, offset: number): [number, number] {
    const val = data[offset];
    if (val < 0xfd) {
        return [val, offset + 1];
    } else if (val === 0xfd) {
        return [data.readUInt16LE(offset + 1), offset + 3];
    } else if (val === 0xfe) {
        return [data.readUInt32LE(offset + 1), offset + 5];
    } else {
        return [Number(data.readBigUInt64LE(offset + 1)), offset + 9];
    }
}

function serializeWithoutWitness(txBytes: Buffer): Buffer {
    const version = txBytes.subarray(0, 4);
    let pos = 6; // Skip marker and flag
    
    const [txInCount, newPos] = readVarint(txBytes, pos);
    pos = newPos;
    
    let result = Buffer.concat([
        version,
        Buffer.from([txInCount])
    ]);
    
    // Add inputs
    for (let i = 0; i < txInCount; i++) {
        result = Buffer.concat([result, txBytes.subarray(pos, pos + 36)]); // Txid + vout
        pos += 36;
        
        const [scriptLen, scriptPos] = readVarint(txBytes, pos);
        result = Buffer.concat([result, Buffer.from([scriptLen])]);
        pos = scriptPos;
        result = Buffer.concat([result, txBytes.subarray(pos, pos + scriptLen)]);
        pos += scriptLen;
        
        result = Buffer.concat([result, txBytes.subarray(pos, pos + 4)]); // Sequence
        pos += 4;
    }
    
    // Output count
    const outputCount = txBytes[pos];
    result = Buffer.concat([result, Buffer.from([outputCount])]);
    pos += 1;
    
    // Add outputs
    for (let i = 0; i < outputCount; i++) {
        result = Buffer.concat([result, txBytes.subarray(pos, pos + 8)]); // Value
        pos += 8;
        
        const scriptLen = txBytes[pos];
        result = Buffer.concat([result, Buffer.from([scriptLen])]);
        pos += 1;
        result = Buffer.concat([result, txBytes.subarray(pos, pos + scriptLen)]);
        pos += scriptLen;
    }
    
    // Locktime
    result = Buffer.concat([result, txBytes.subarray(-4)]);
    
    return result;
}

export function getTxHash(hexString: string, withWitness: boolean = false): string {
    const txBytes = Buffer.from(hexString, 'hex');
    
    // Check if segwit
    const isSegwit = txBytes.length > 4 && txBytes[4] === 0x00 && txBytes[5] === 0x01;
    
    let bytesToHash = txBytes;
    if (isSegwit && !withWitness) {
        bytesToHash = serializeWithoutWitness(txBytes);
    }
    
    // Double SHA256
    const hash1 = createHash('sha256').update(bytesToHash).digest();
    const hash2 = createHash('sha256').update(hash1).digest();
    
    return Buffer.from(hash2).reverse().toString('hex');
}