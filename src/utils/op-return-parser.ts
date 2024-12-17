export function parseOpReturn(hexData: string) {
  try {
    // Check OP_RETURN and data length markers (0x6a 0x47)
    if (!hexData.startsWith('6a47')) {
      return null;
    }

    // Check Babylon prefix (bbn1)
    if (hexData.slice(4, 12).toLowerCase() !== '62626e31') {
      return null;
    }

    // Remove OP_RETURN, length marker and prefix
    const data = hexData.slice(12);

    // Parse version - only accept version 0 as per official spec
    const version = parseInt(data.slice(0, 2), 16);
    if (version !== 0) {
      return null;
    }

    return {
      version,
      staker_public_key: data.slice(2, 66),
      finality_provider: data.slice(66, 130),
      staking_time: parseInt(data.slice(130, 134), 16)
    };
  } catch (e) {
    console.error('Error parsing OP_RETURN:', e);
    return null;
  }
} 