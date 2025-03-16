/**
 * Transaction içindeki mesaj tipleri için sabitler
 */
export const MESSAGE_TYPES = {
  // Babylon specifik mesaj tipleri
  ADD_FINALITY_SIG: '/babylon.finality.v1.MsgAddFinalitySig',
  INJECTED_CHECKPOINT: '/babylon.checkpointing.v1.MsgInjectedCheckpoint',
  
  // CosmWasm mesaj tipleri
  EXECUTE_CONTRACT: '/cosmwasm.wasm.v1.MsgExecuteContract',
  INSTANTIATE_CONTRACT: '/cosmwasm.wasm.v1.MsgInstantiateContract',
  
  // Cosmos standart mesaj tipleri
  SEND: '/cosmos.bank.v1beta1.MsgSend',
  DELEGATE: '/cosmos.staking.v1beta1.MsgDelegate',
  UNDELEGATE: '/cosmos.staking.v1beta1.MsgUndelegate',
  BEGIN_REDELEGATE: '/cosmos.staking.v1beta1.MsgBeginRedelegate',
  
  // Diğer mesaj tipleri buraya eklenebilir
};

/**
 * Daha kolay tip kontrolü için reverse mapping
 */
export const MESSAGE_TYPE_NAMES: Record<string, keyof typeof MESSAGE_TYPES> = 
  Object.entries(MESSAGE_TYPES).reduce((acc, [key, value]) => {
    acc[value] = key as keyof typeof MESSAGE_TYPES;
    return acc;
  }, {} as Record<string, keyof typeof MESSAGE_TYPES>); 