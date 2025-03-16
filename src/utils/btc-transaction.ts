import { Buffer } from 'buffer';
import { bech32m, bech32 } from 'bech32';
import { createHash } from 'crypto';
import { logger } from './logger';

/**
 * Prefix used to identify P2TR outputs
 * OP_1 (0x51) followed by 0x20 (32-byte push)
 */
const P2TR_PREFIX = Buffer.from([0x51, 0x20]);

/**
 * Prefix used to identify P2WPKH output
 * OP_0 (0x00) followed by 0x14 (20-byte push)
 */
const P2WPKH_PREFIX = Buffer.from([0x00, 0x14]);

/**
 * Prefix used to identify P2WSH output
 * OP_0 (0x00) followed by 0x20 (32-byte push)
 */
const P2WSH_PREFIX = Buffer.from([0x00, 0x20]);

/**
 * Prefix used to identify P2PKH output
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
 * Calculates RIPEMD160(SHA256(data))
 * @param data - Data to be hashed
 * @returns Hash result
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
        logger.error('Extract address error:', error);
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
            return encodeBech32('tb', pubKey, 1); // for witness_v1
        }

        // P2WPKH addresses
        if (isP2WPKHOutput(script)) {
            const pubKeyHash = script.slice(2);
            return encodeBech32('tb', pubKeyHash, 0); // for witness_v0
        }

        // P2WSH addresses
        if (isP2WSHOutput(script)) {
            const scriptHash = script.slice(2);
            return encodeBech32('tb', scriptHash, 0); // for witness_v0
        }

        // P2PKH addresses
        if (isP2PKHOutput(script)) {
            const pubKeyHash = extractPubKeyHashFromP2PKH(script);
            if (pubKeyHash) {
                // Use Base58Check encoding
                // Note: We need to implement Base58Check encoding
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
 * @param data - Public key or public key hash buffer
 * @param witnessVersion - Witness version (0 for P2WPKH, 1 for P2TR)
 * @returns Bech32/Bech32m encoded address
 */
function encodeBech32(hrp: string, data: Buffer, witnessVersion: number): string {
    try {
        const words = bech32m.toWords(Array.from(data));
        // Use bech32 for P2WPKH (v0), bech32m for P2TR (v1)
        if (witnessVersion === 0) {
            return bech32.encode(hrp, [witnessVersion, ...words]);
        } else {
            return bech32m.encode(hrp, [witnessVersion, ...words]);
        }
    } catch (error) {
        logger.error('Bech32 encoding error:', error);
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
 * Checks if it is an OP_RETURN output
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

            // Skip OP_RETURN outputs and only collect P2TR outputs
            if (!isOpReturnOutput(script) && isTaprootOutput(script)) {
                p2trOutputs.push({ index: i, value, script });
            }
        }

        if (p2trOutputs.length === 0) {
            throw new Error('No P2TR outputs found');
        }

        // If there are multiple P2TR outputs, first P2TR output is staking amount
        // If there is only one P2TR output, it is staking amount
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
 * Extracts public key hash from P2WPKH script
 * @param script - P2WPKH script buffer
 * @returns Public key hash buffer or null
 */
function extractPubKeyHashFromScript(script: Buffer): Buffer | null {
    // P2WPKH script format: OP_0 (0x00) + 0x14 (20-byte push) + 20-byte pubkey hash
    if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) {
        return script.slice(2); // Last 20 bytes are pubkey hash
    }
    return null;
}

/**
 * Checks if it is a P2WPKH script
 * @param script - Output script
 * @returns boolean
 */
function isP2WPKHOutput(script: Buffer): boolean {
    return script.length === 22 && // P2WPKH outputs are exactly 22 bytes
           script[0] === P2WPKH_PREFIX[0] && // OP_0
           script[1] === P2WPKH_PREFIX[1]; // 20-byte push
}

/**
 * Checks if it is a P2WSH script
 * @param script - Output script
 * @returns boolean
 */
function isP2WSHOutput(script: Buffer): boolean {
    return script.length === 34 && // P2WSH outputs are exactly 34 bytes
           script[0] === P2WSH_PREFIX[0] && // OP_0
           script[1] === P2WSH_PREFIX[1]; // 32-byte push
}

/**
 * Checks if it is a P2PKH script
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
 * Extracts public key hash from P2PKH script
 * @param script - P2PKH script buffer
 * @returns Public key hash buffer or null
 */
function extractPubKeyHashFromP2PKH(script: Buffer): Buffer | null {
    if (isP2PKHOutput(script)) {
        return script.slice(3, 23); // 20-byte public key hash
    }
    return null;
}

/**
 * Extracts previous output information of the input
 * @param buffer - Transaction buffer
 * @param offset - Buffer offset
 * @returns Previous output information and new offset
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
 * Extracts sender address from input script
 * @param buffer - Transaction buffer
 * @param offset - Buffer offset
 * @returns Sender address and new offset
 */
function extractSenderFromInput(buffer: Buffer, offset: number): { sender: string | null, newOffset: number } {
    try {
        // Read script length
        const scriptLength = readVarInt(buffer, offset);
        offset += getVarIntSize(scriptLength);

        if (scriptLength === 0) {
            return { sender: null, newOffset: offset };
        }

        // Input can be empty for witness script
        if (scriptLength > 0) {
            const script = buffer.slice(offset, offset + scriptLength);
            
            // Check witness data for P2WPKH input
            if (script.length === 0) {
                // Witness data is in the next section
                offset += scriptLength;
                return { sender: null, newOffset: offset };
            }

            // P2PKH input script format: <signature> <pubkey>
            if (script.length > 33) { // At least 33 bytes (compressed pubkey)
                const pubKeyStart = script.length - 33; // Last 33 bytes
                const pubKey = script.slice(pubKeyStart);
                
                // Create P2WPKH address from public key
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
        logger.warn('Error extracting sender from input:', error);
        return { sender: null, newOffset: offset };
    }
}

/**
 * Extracts input and output addresses from transaction hex
 * @param txHex - Raw transaction hex string
 * @param rpcUrl - Bitcoin RPC URL (optional)
 * @returns Input and output addresses
 */
export async function extractAddressesFromTransaction(
    txHex: string,
    rpcUrl?: string
): Promise<{ sender: string | null, outputs: string[] }> {
    if (!txHex || typeof txHex !== 'string') {
        throw new Error('Invalid transaction hex');
    }

    try {
        // logger.info('Parsing transaction hex:', txHex.substring(0, 100) + '...');
        const buffer = Buffer.from(txHex, 'hex');
        let offset = 4; // Skip version

        // Check for segwit
        const isSegwit = buffer[offset] === 0x00 && buffer[offset + 1] === 0x01;
        // logger.info('Is Segwit transaction:', isSegwit);
        if (isSegwit) {
            offset += 2;
        }

        let senderAddress: string | null = null;
        const outputAddresses: string[] = [];
        const p2trOutputs: Array<{ index: number, address: string }> = [];
        let prevOutput: { txid: string, vout: number } | null = null;

        // Parse inputs
        const inputCount = readVarInt(buffer, offset);
        // logger.info('Number of inputs:', inputCount);
        offset += getVarIntSize(inputCount);
        
        if (inputCount > 0) {
            // Get previous output information of the first input
            const { txid, vout, newOffset } = extractPrevOutput(buffer, offset);
            // logger.info('Previous output:', { txid, vout });
            prevOutput = { txid, vout };
            offset = newOffset;

            // Try to extract sender from input script
            const { sender, newOffset: newOffsetAfterScript } = extractSenderFromInput(buffer, offset);
            // logger.info('Extracted sender from input:', sender);
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
        //logger.info('Number of outputs:', outputCount);
        offset += getVarIntSize(outputCount);

        // Parse outputs
        for (let i = 0; i < outputCount; i++) {
            offset += 8; // Skip value

            const scriptLength = readVarInt(buffer, offset);
            offset += getVarIntSize(scriptLength);

            if (scriptLength > 0) {
                const script = buffer.slice(offset, offset + scriptLength);
                
                // Skip OP_RETURN outputs
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

        // Determine sender based on P2TR outputs
        if (!senderAddress && p2trOutputs.length >= 2) {
            // If there are two P2TR outputs and sender could not be found from input:
            // First output is for stake amount, second output is for change address (sender)
            senderAddress = p2trOutputs[1].address;
            // logger.info('Determined sender from P2TR change output:', senderAddress);
        }

        // If sender is still not found and RPC URL is available, try to find it from previous output
        if (!senderAddress && prevOutput && rpcUrl) {
            try {
                // logger.info('Fetching previous transaction:', prevOutput.txid);
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
                logger.warn('Failed to get previous transaction:', error);
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

    logger.info('Starting address extraction tests...\n');

    for (const testCase of testCases) {
        logger.info(`Test Case: ${testCase.description}`);
        logger.info('Transaction Hex:', testCase.txHex);
        
        const addresses = await extractAddressesFromTransaction(testCase.txHex, testCase.rpcUrl);
        logger.info('Sender Address:', addresses.sender);
        logger.info('-------------------\n');
    }
}

// Run test function
if (require.main === module) {
    testAddressExtraction().catch(logger.error);
}