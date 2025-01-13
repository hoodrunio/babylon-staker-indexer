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
tx_hex = "02000000014cb756e376211c10974ca25e4c3dcb38f23393fc43be95ea8327c0daed3dd6020200000000ffffffff0250c300000000000022512068727016856bfb00977b23a173b2ce286cf5c55efa8be14a9471efef691e0c3c040904000000000022512036fe4de8a958477a93b0b7157de88f0d7615f924ebcdfebdec584b9d690c9fe200000000"

print("TXID:", get_tx_hash(tx_hex, with_witness=False))
print("WTXID:", get_tx_hash(tx_hex, with_witness=True))