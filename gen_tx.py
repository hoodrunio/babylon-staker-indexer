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
tx_hex = "02000000000101a147cecd6b42e4551135f6f090275bdf237865f6553cacfecc17a85c2169df0a0100000000fdffffff0350c300000000000022512072f3dad8a31edf97f8e5b1be6c591b9d05b65cedafebebbb1f502e91d67c60b30000000000000000496a4762627434000a22b39ff38d1751e7143d739e97a649384392026dbc52a26e162e4068f592eaf63c13dc5a671879f7af243e0a8d23aedf2e907d4bfef8936174fc91cd439a08fa002b9a01000000000022512067a787a7ddff57816c3d8344f5c9434ee8793d45ba9c224968847954d16c1abb01403e57ddb68265224582ad0213e50fcc5ded7867bb508b2b1735f84d9eea9e640eb4343f6b6587de42a0bb95718adc67318189141bf2bef0ebd6556c646006a8429e030300"

print("TXID:", get_tx_hash(tx_hex, with_witness=False))
print("WTXID:", get_tx_hash(tx_hex, with_witness=True))