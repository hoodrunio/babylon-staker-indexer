const HEX_PREFIX = '5120';
const HEX_PREFIX_LENGTH = 68;

export default (output: any): boolean => {
  const script = output.scriptPubKey?.hex;
  const type = output.scriptPubKey?.type;

  return (script && script.startsWith(HEX_PREFIX) && script.length === HEX_PREFIX_LENGTH) || (type === 'witness_v1_taproot');
}
