export const formatSatoshis = (satoshis: number): string => {
    return (satoshis / 100000000).toFixed(8);
};