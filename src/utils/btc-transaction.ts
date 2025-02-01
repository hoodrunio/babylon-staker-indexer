import { Buffer } from 'buffer';
import { bech32m, bech32 } from 'bech32';
import { createHash } from 'crypto';

/**
 * Prefix used to identify P2TR outputs
 * OP_1 (0x51) followed by 0x20 (32-byte push)
 */
const P2TR_PREFIX = Buffer.from([0x51, 0x20]);

/**
 * P2WPKH output'unu tanımlamak için kullanılan prefix
 * OP_0 (0x00) followed by 0x14 (20-byte push)
 */
const P2WPKH_PREFIX = Buffer.from([0x00, 0x14]);

/**
 * P2WSH output'unu tanımlamak için kullanılan prefix
 * OP_0 (0x00) followed by 0x20 (32-byte push)
 */
const P2WSH_PREFIX = Buffer.from([0x00, 0x20]);

/**
 * P2PKH output'unu tanımlamak için kullanılan prefix
 * OP_DUP (0x76) + OP_HASH160 (0xa9) + 0x14 (20-byte push)
 */
const P2PKH_PREFIX = Buffer.from([0x76, 0xa9, 0x14]);

interface RPCResponse {
    result?: {
        vout?: Array<{
            scriptPubKey: {
                address?: string;
            };
        }>;
    };
    error?: unknown;
}

/**
 * RIPEMD160(SHA256(data)) hesaplar
 * @param data - Hash'lenecek veri
 * @returns Hash sonucu
 */
function hash160(data: Buffer): Buffer {
    const sha256 = createHash('sha256').update(data).digest();
    return createHash('ripemd160').update(sha256).digest();
}

/**
 * Extracts input address
 * @param script - Input script
 * @returns Input address or null
 */
function extractInputAddress(script: Buffer): string | null {
    try {
        // Check for P2TR (Taproot) addresses
        if (isTaprootOutput(script)) {
            const pubKey = script.slice(2); // Skip first 2 bytes (OP_1 and 0x20)
            const address = encodeBech32('tb', pubKey, 1); // witness_v1 for Taproot
            return address;
        }

        // Return null for other script types
        return null;
    } catch (error) {
        console.error('Extract address error:', error);
        return null;
    }
}

/**
 * Extracts output address
 * @param script - Output script
 * @returns Output address or null
 */
function extractOutputAddress(script: Buffer): string | null {
    try {
        // Check for P2TR (Taproot) addresses
        if (isTaprootOutput(script)) {
            const pubKey = script.slice(2); // Skip first 2 bytes (OP_1 and 0x20)
            return encodeBech32('tb', pubKey, 1); // witness_v1 için
        }

        // P2WPKH adresleri için kontrol
        if (isP2WPKHOutput(script)) {
            const pubKeyHash = script.slice(2);
            return encodeBech32('tb', pubKeyHash, 0); // witness_v0 için
        }

        // P2WSH adresleri için kontrol
        if (isP2WSHOutput(script)) {
            const scriptHash = script.slice(2);
            return encodeBech32('tb', scriptHash, 0); // witness_v0 için
        }

        // P2PKH adresleri için kontrol
        if (isP2PKHOutput(script)) {
            const pubKeyHash = extractPubKeyHashFromP2PKH(script);
            if (pubKeyHash) {
                // Base58Check encoding kullan
                // Not: Base58Check encoding'i implement etmemiz gerekiyor
                // return encodeBase58Check(pubKeyHash);
            }
        }

        // Return null for other script types
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Encodes address in Bech32/Bech32m format
 * @param hrp - Human readable part ('tb' or 'bc')
 * @param data - Public key veya public key hash buffer'ı
 * @param witnessVersion - Witness version (0 for P2WPKH, 1 for P2TR)
 * @returns Bech32/Bech32m encoded address
 */
function encodeBech32(hrp: string, data: Buffer, witnessVersion: number): string {
    try {
        const words = bech32m.toWords(Array.from(data));
        // P2WPKH (v0) için bech32, P2TR (v1) için bech32m kullan
        if (witnessVersion === 0) {
            return bech32.encode(hrp, [witnessVersion, ...words]);
        } else {
            return bech32m.encode(hrp, [witnessVersion, ...words]);
        }
    } catch (error) {
        console.error('Bech32 encoding error:', error);
        throw new Error('Bech32 encoding failed: ' + (error as Error).message);
    }
}

/**
 * Validates if the output is a valid Taproot output
 * @param script - Output script
 * @returns boolean
 */
function isTaprootOutput(script: Buffer): boolean {
    return script.length === 34 && // P2TR outputs are exactly 34 bytes (2 bytes prefix + 32 bytes key)
           script[0] === P2TR_PREFIX[0] && // OP_1
           script[1] === P2TR_PREFIX[1] && // 32-byte push
           script.length === script[1] + 2; // Total length should match the push value + 2
}

/**
 * Validates if the transaction has a valid OP_RETURN output
 * @param outputs - Transaction outputs
 * @returns The OP_RETURN data if valid, null otherwise
 */
/* function validateOpReturn(outputs: Array<{ value: number, script: Buffer }>): Buffer | null {
    const opReturn = outputs.find(output => 
        output.script.length > 2 && 
        output.script[0] === 0x6a && // OP_RETURN
        output.script[1] === 0x47    // 71 bytes push
    );

    if (!opReturn) return null;

    const data = opReturn.script.slice(2);
    if (data.length !== 71) return null; // 71 bytes of data expected

    // Check Babylon tag
    const tag = data.slice(0, 4);
    if (tag.toString('hex') !== '62626e31') return null; // 'bbn1'

    return data;
} */

/**
 * OP_RETURN output mu kontrol eder
 * @param script - Output script
 * @returns boolean
 */
function isOpReturnOutput(script: Buffer): boolean {
    return script.length > 0 && script[0] === 0x6a; // OP_RETURN
}

/**
 * Extracts staking amount from BTC transaction hex
 * @param txHex - Raw BTC transaction hex string
 * @returns Staking amount in satoshis, or 0 if not found
 * @throws Error - If transaction hex is invalid or cannot be parsed
 */
export function extractAmountFromBTCTransaction(txHex: string): number {
    if (!txHex || typeof txHex !== 'string') {
        throw new Error('Invalid transaction hex: empty or not a string');
    }

    try {
        const buffer = Buffer.from(txHex, 'hex');
        if (buffer.length < 10) {
            throw new Error('Transaction hex too short');
        }

        let offset = 4; // Skip version

        // Check for segwit
        const isSegwit = buffer[offset] === 0x00 && buffer[offset + 1] === 0x01;
        if (isSegwit) {
            offset += 2;
        }

        // Skip inputs
        const inputCount = readVarInt(buffer, offset);
        offset += getVarIntSize(inputCount);
        for (let i = 0; i < inputCount; i++) {
            offset += 36; // Skip outpoint
            const scriptLength = readVarInt(buffer, offset);
            offset += getVarIntSize(scriptLength);
            offset += scriptLength;
            offset += 4; // Skip sequence
        }

        // Read outputs
        const outputCount = readVarInt(buffer, offset);
        offset += getVarIntSize(outputCount);

        const p2trOutputs: Array<{ index: number, value: number, script: Buffer }> = [];

        // Parse outputs
        for (let i = 0; i < outputCount; i++) {
            const lowBytes = buffer.readUInt32LE(offset);
            const highBytes = buffer.readUInt32LE(offset + 4);
            const value = lowBytes + highBytes * 0x100000000;
            offset += 8;
            
            const scriptLength = readVarInt(buffer, offset);
            offset += getVarIntSize(scriptLength);
            const script = buffer.slice(offset, offset + scriptLength);
            offset += scriptLength;

            // OP_RETURN output'larını atla ve sadece P2TR output'ları topla
            if (!isOpReturnOutput(script) && isTaprootOutput(script)) {
                p2trOutputs.push({ index: i, value, script });
            }
        }

        if (p2trOutputs.length === 0) {
            throw new Error('No P2TR outputs found');
        }

        // Birden fazla P2TR output varsa, ilk P2TR output staking amount'tır
        // Tek P2TR output varsa, o staking amount'tır
        return p2trOutputs[0].value;

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to parse BTC transaction: ${errorMessage}`);
    }
}

function readVarInt(buffer: Buffer, offset: number): number {
    const first = buffer.readUInt8(offset);
    if (first < 0xfd) return first;
    if (first === 0xfd) return buffer.readUInt16LE(offset + 1);
    if (first === 0xfe) return buffer.readUInt32LE(offset + 1);
    return Number(buffer.readBigUInt64LE(offset + 1));
}

function getVarIntSize(value: number): number {
    if (value < 0xfd) return 1;
    if (value <= 0xffff) return 3;
    if (value <= 0xffffffff) return 5;
    return 9;
}

/**
 * Extracts public key x-coordinate from P2TR script
 * @param script - P2TR script buffer
 * @returns Public key x-coordinate buffer or null
 */
function extractPubKeyXCoordFromScript(script: Buffer): Buffer | null {
    // P2TR script format: OP_1 (0x51) + 0x20 (32-byte push) + 32-byte pubkey x-coord
    if (script.length === 34 && script[0] === 0x51 && script[1] === 0x20) {
        return script.slice(2); // Last 32 bytes are pubkey x-coordinate
    }
    return null;
}

/**
 * P2WPKH script'inden public key hash'i çıkarır
 * @param script - P2WPKH script buffer'ı
 * @returns Public key hash buffer'ı veya null
 */
function extractPubKeyHashFromScript(script: Buffer): Buffer | null {
    // P2WPKH script formatı: OP_0 (0x00) + 0x14 (20-byte push) + 20-byte pubkey hash
    if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) {
        return script.slice(2); // Son 20 byte pubkey hash
    }
    return null;
}

/**
 * P2WPKH script mi kontrol eder
 * @param script - Output script
 * @returns boolean
 */
function isP2WPKHOutput(script: Buffer): boolean {
    return script.length === 22 && // P2WPKH outputs are exactly 22 bytes
           script[0] === P2WPKH_PREFIX[0] && // OP_0
           script[1] === P2WPKH_PREFIX[1]; // 20-byte push
}

/**
 * P2WSH script mi kontrol eder
 * @param script - Output script
 * @returns boolean
 */
function isP2WSHOutput(script: Buffer): boolean {
    return script.length === 34 && // P2WSH outputs are exactly 34 bytes
           script[0] === P2WSH_PREFIX[0] && // OP_0
           script[1] === P2WSH_PREFIX[1]; // 32-byte push
}

/**
 * P2PKH script mi kontrol eder
 * @param script - Output script
 * @returns boolean
 */
function isP2PKHOutput(script: Buffer): boolean {
    return script.length === 25 && // P2PKH outputs are exactly 25 bytes
           script[0] === P2PKH_PREFIX[0] && // OP_DUP
           script[1] === P2PKH_PREFIX[1] && // OP_HASH160
           script[2] === P2PKH_PREFIX[2] && // 20-byte push
           script[23] === 0x88 && // OP_EQUALVERIFY
           script[24] === 0xac;   // OP_CHECKSIG
}

/**
 * P2PKH script'inden public key hash'i çıkarır
 * @param script - P2PKH script buffer'ı
 * @returns Public key hash buffer'ı veya null
 */
function extractPubKeyHashFromP2PKH(script: Buffer): Buffer | null {
    if (isP2PKHOutput(script)) {
        return script.slice(3, 23); // 20-byte public key hash
    }
    return null;
}

/**
 * Input'un previous output bilgilerini çıkarır
 * @param buffer - Transaction buffer
 * @param offset - Buffer offset
 * @returns Previous output bilgileri ve yeni offset
 */
function extractPrevOutput(buffer: Buffer, offset: number): { txid: string, vout: number, newOffset: number } {
    // Previous transaction hash (32 bytes, little-endian)
    const txid = buffer.slice(offset, offset + 32).reverse().toString('hex');
    offset += 32;

    // Previous output index (4 bytes, little-endian)
    const vout = buffer.readUInt32LE(offset);
    offset += 4;

    return { txid, vout, newOffset: offset };
}

/**
 * Input script'inden sender adresini çıkarır
 * @param buffer - Transaction buffer
 * @param offset - Buffer offset
 * @returns Sender adresi ve yeni offset
 */
function extractSenderFromInput(buffer: Buffer, offset: number): { sender: string | null, newOffset: number } {
    try {
        // Script length'i oku
        const scriptLength = readVarInt(buffer, offset);
        offset += getVarIntSize(scriptLength);

        if (scriptLength === 0) {
            return { sender: null, newOffset: offset };
        }

        // Witness script için input boş olabilir
        if (scriptLength > 0) {
            const script = buffer.slice(offset, offset + scriptLength);
            
            // P2WPKH input için witness data'yı kontrol et
            if (script.length === 0) {
                // Witness data sonraki bölümde
                offset += scriptLength;
                return { sender: null, newOffset: offset };
            }

            // P2PKH input script formatı: <signature> <pubkey>
            if (script.length > 33) { // En az 33 byte (compressed pubkey)
                const pubKeyStart = script.length - 33; // Son 33 byte
                const pubKey = script.slice(pubKeyStart);
                
                // Public key'den P2WPKH adresi oluştur
                const pubKeyHash = hash160(pubKey);
                return {
                    sender: encodeBech32('tb', pubKeyHash, 0),
                    newOffset: offset + scriptLength
                };
            }
        }

        offset += scriptLength;
        return { sender: null, newOffset: offset };
    } catch (error) {
        console.warn('Error extracting sender from input:', error);
        return { sender: null, newOffset: offset };
    }
}

/**
 * Transaction hex'inden input ve output adresleri çıkarır
 * @param txHex - Raw transaction hex string
 * @param rpcUrl - Bitcoin RPC URL (optional)
 * @returns Input ve output adresleri
 */
export async function extractAddressesFromTransaction(
    txHex: string,
    rpcUrl?: string
): Promise<{ sender: string | null, outputs: string[] }> {
    if (!txHex || typeof txHex !== 'string') {
        throw new Error('Invalid transaction hex');
    }

    try {
        // console.log('Parsing transaction hex:', txHex.substring(0, 100) + '...');
        const buffer = Buffer.from(txHex, 'hex');
        let offset = 4; // Skip version

        // Check for segwit
        const isSegwit = buffer[offset] === 0x00 && buffer[offset + 1] === 0x01;
        // console.log('Is Segwit transaction:', isSegwit);
        if (isSegwit) {
            offset += 2;
        }

        let senderAddress: string | null = null;
        const outputAddresses: string[] = [];
        const p2trOutputs: Array<{ index: number, address: string }> = [];
        let prevOutput: { txid: string, vout: number } | null = null;

        // Parse inputs
        const inputCount = readVarInt(buffer, offset);
        // console.log('Number of inputs:', inputCount);
        offset += getVarIntSize(inputCount);
        
        if (inputCount > 0) {
            // İlk input'un previous output bilgilerini al
            const { txid, vout, newOffset } = extractPrevOutput(buffer, offset);
            // console.log('Previous output:', { txid, vout });
            prevOutput = { txid, vout };
            offset = newOffset;

            // Input script'inden sender'ı çıkarmayı dene
            const { sender, newOffset: newOffsetAfterScript } = extractSenderFromInput(buffer, offset);
            // console.log('Extracted sender from input:', sender);
            if (sender) {
                senderAddress = sender;
            }
            offset = newOffsetAfterScript;
            offset += 4; // Skip sequence
        }

        // Skip remaining inputs
        for (let i = 1; i < inputCount; i++) {
            offset += 36; // Skip outpoint
            const scriptLength = readVarInt(buffer, offset);
            offset += getVarIntSize(scriptLength);
            offset += scriptLength;
            offset += 4; // Skip sequence
        }

        // Read outputs
        const outputCount = readVarInt(buffer, offset);
        //console.log('Number of outputs:', outputCount);
        offset += getVarIntSize(outputCount);

        // Parse outputs
        for (let i = 0; i < outputCount; i++) {
            offset += 8; // Skip value

            const scriptLength = readVarInt(buffer, offset);
            offset += getVarIntSize(scriptLength);

            if (scriptLength > 0) {
                const script = buffer.slice(offset, offset + scriptLength);
                
                // OP_RETURN output'larını atla
                if (!isOpReturnOutput(script)) {
                    const address = extractOutputAddress(script);
                    if (address) {
                        outputAddresses.push(address);
                        if (isTaprootOutput(script)) {
                            p2trOutputs.push({ index: i, address });
                        }
                    }
                }
            }

            offset += scriptLength;
        }

        // P2TR output'larına göre sender'ı belirle
        if (!senderAddress && p2trOutputs.length >= 2) {
            // İki P2TR output varsa ve input'tan sender bulunamadıysa:
            // İlk output stake amount için, ikinci output change address'i (sender) için
            senderAddress = p2trOutputs[1].address;
            // console.log('Determined sender from P2TR change output:', senderAddress);
        }

        // Eğer hala sender bulunamadıysa ve RPC URL varsa, önceki output'tan bulmayı dene
        if (!senderAddress && prevOutput && rpcUrl) {
            try {
                // console.log('Fetching previous transaction:', prevOutput.txid);
                const response = await fetch(rpcUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 'btc-staker',
                        method: 'getrawtransaction',
                        params: [prevOutput.txid, true]
                    })
                });

                const data = await response.json() as RPCResponse;
                const address = data.result?.vout?.[prevOutput.vout]?.scriptPubKey.address;
                if (address) {
                    senderAddress = address;
                }
            } catch (error) {
                console.warn('Failed to get previous transaction:', error);
            }
        }

        return {
            sender: senderAddress,
            outputs: outputAddresses
        };
    } catch (error) {
        throw new Error(`Failed to extract addresses: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

// test function
export async function testAddressExtraction() {
    const testCases = [
        {
            description: "Real Babylon staking transaction",
            txHex: "0200000001d444bf4c6cec5e7da3f6842ba71b6ab5315dca8932dadfb3c9aff8898357d32c0100000000ffffffff0250c3000000000000225120514d4becc324582f00e3a2de4ac4a116b635068bf1ee3b2630520aa35f0a4c1fdf93000000000000160014fb8efbf2aa6c2771ce16dd6093f0333c721ffe3500000000",
            rpcUrl: "https://rpc.ankr.com/btc_signet"
        }
    ];

    console.log('Starting address extraction tests...\n');

    for (const testCase of testCases) {
        console.log(`Test Case: ${testCase.description}`);
        console.log('Transaction Hex:', testCase.txHex);
        
        const addresses = await extractAddressesFromTransaction(testCase.txHex, testCase.rpcUrl);
        console.log('Sender Address:', addresses.sender);
        console.log('-------------------\n');
    }
}

// Run test function
if (require.main === module) {
    testAddressExtraction().catch(console.error);
}