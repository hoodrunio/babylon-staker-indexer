export function parseOpReturn(hexData: string) {
  try {
    // Check prefix
    if (!hexData.startsWith('6a4762626e31')) {
      return null;
    }

    // Remove prefix
    const data = hexData.slice(10);

    // Parse version
    const version = parseInt(data.slice(2, 4), 16);
    if (![0, 1, 2].includes(version)) {
      return null;
    }

    return {
      version,
      staker_public_key: data.slice(4, 68),
      finality_provider: data.slice(68, 132),
      staking_time: parseInt(data.slice(132, 136), 16)
    };
  } catch (e) {
    console.error('Error parsing OP_RETURN:', e);
    return null;
  }
} 