import hashlib
from binascii import unhexlify

def read_varint(data, offset):
    """Read Variable Integer"""
    val = data[offset]
    if val < 0xfd:
        return val, offset + 1
    elif val == 0xfd:
        return int.from_bytes(data[offset+1:offset+3], 'little'), offset + 3
    elif val == 0xfe:
        return int.from_bytes(data[offset+1:offset+5], 'little'), offset + 5
    else:
        return int.from_bytes(data[offset+1:offset+9], 'little'), offset + 9

def serialize_without_witness(tx_bytes):
    """Remove witness data from segwit transaction"""
    version = tx_bytes[:4]
    
    # Skip marker and flag
    pos = 6
    # Read input count
    tx_in_count, pos = read_varint(tx_bytes, pos)
    
    result = bytearray(version)  # Version
    result.append(tx_in_count)   # Input count
    
    # Add inputs
    for _ in range(tx_in_count):
        # Txid (32) + vout (4)
        result.extend(tx_bytes[pos:pos+36])
        pos += 36
        
        # Script
        script_len, new_pos = read_varint(tx_bytes, pos)
        result.append(script_len)  # Script length
        pos = new_pos
        result.extend(tx_bytes[pos:pos+script_len])  # Script data
        pos += script_len
        
        # Sequence
        result.extend(tx_bytes[pos:pos+4])
        pos += 4
    
    # Output count
    output_count = tx_bytes[pos]
    result.append(output_count)
    pos += 1
    
    # Add outputs
    for _ in range(output_count):
        # Value (8 bytes)
        result.extend(tx_bytes[pos:pos+8])
        pos += 8
        
        # Script
        script_len = tx_bytes[pos]
        result.append(script_len)
        pos += 1
        result.extend(tx_bytes[pos:pos+script_len])
        pos += script_len
    
    # Locktime
    result.extend(tx_bytes[-4:])
    
    return result

def get_tx_hash(hex_string, with_witness=False):
    """Calculate transaction hash"""
    tx_bytes = unhexlify(hex_string)
    
    # Check if segwit
    is_segwit = len(tx_bytes) > 4 and tx_bytes[4] == 0x00 and tx_bytes[5] == 0x01
    
    if is_segwit and not with_witness:
        tx_bytes = serialize_without_witness(tx_bytes)
    
    # Double SHA256
    h1 = hashlib.sha256(tx_bytes).digest()
    h2 = hashlib.sha256(h1).digest()
    
    return h2[::-1].hex()

# Test
tx_hex = "0200000000010184f99538d8260d3ce851f4e8ef72e3ecf3ffaaa75c4aa992d810fd6f53e566880000000000ffffffff0140514b0000000000225120b3541b7599a2c287504e0ec325d29d24452026dcb4bd159bd0f00a0b3935dfa50c00004004499ffe590e9c34e9732abac754822724b4258da24701afe64d604ea38b69cc4729effb2f5fe01e8a04ffbf734e46e47355e457508dd09f4c1cac701e1adb8540c048fbfcb6a46defc04bde51b1d016a0b705e5ab864f1e9f9c0485fe79305278891a8d5efce173ccfc118be0d10e2b92804779fd1441ecf548fdf883fc100b2a004069758b73364a8b71c197dbac8390b9d97fda5c96a7e14e25da9032ef9f3bf0ef02b3ab4f442236cf8111bb16b7777d081809cd154ae415f8b2e3f16656ab44914051f854e756246f6390b5764b759f3ef064be8209cedf32580dd576288437327146f55e84f974aab45f22ffa735d928eadc128ef5b061110c8be746ab95e1539e40aaf76b479569902d5c8a35fe338f18bce720995572422c1956bc874533a97ba93fabf158b124d270beca8864b196ebef20c0af9205542889ef5b5898ffd88ca640fd19c69ae1a73f6bcb47da17285037a91118d97e181c26f8b161d82b1ddbe02ac6483ee9afea19c0306cdfc6f4f59447478f88f604498c93bc0a8839550258a84011d1ebc495637b33e3b734016ebde13aba9525d9f313aabeec9df6d982f133f14b18625312ab062a11b03df173ca14546adde8a5c98e9b1de7d2f98fabb572fdfd560120c39aac6e759d2e82d5350dfd69193ef227ea4f21ed2ada077283704aea6ebe2fad2023b29f89b45f4af41588dcaf0ca572ada32872a88224f311373917f1b37d08d1ac204b15848e495a3a62283daaadb3f458a00859fe48e321f0121ebabbdd6698f9faba208242640732773249312c47ca7bdb50ca79f15f2ecc32b9c83ceebba44fb74df7ba20cbdd028cfe32c1c1f2d84bfec71e19f92df509bba7b8ad31ca6c1a134fe09204ba20d3c79b99ac4d265c2f97ac11e3232c07a598b020cf56c6f055472c893c0967aeba20d45c70d28f169e1f0c7f4a78e2bc73497afe585b70aa897955989068f3350aaaba20de13fc96ea6899acbdc5db3afaa683f62fe35b60ff6eb723dad28a11d2b12f8cba20e36200aaa8dce9453567bba108bdc51f7f1174b97a65e4dc4402fc5de779d41cba20f178fcce82f95c524b53b077e6180bd2d779a9057fdff4255a0af95af918cee0ba569c61c150929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac05b9ecb560a91bf97976454326c38279278ade9da0e9edfa1fb7c8b79a2d9125f1d687f8380f68791557e10a293c34186848bda711a4f5444204f850ae7c74ce800000000"

print("TXID:", get_tx_hash(tx_hex, with_witness=False))
print("WTXID:", get_tx_hash(tx_hex, with_witness=True))