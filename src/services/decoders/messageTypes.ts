/**
 * Constants for message types within transactions
 */
export const MESSAGE_TYPES = {
  // Babylon specific message types
  ADD_FINALITY_SIG: '/babylon.finality.v1.MsgAddFinalitySig',
  INJECTED_CHECKPOINT: '/babylon.checkpointing.v1.MsgInjectedCheckpoint',
  
  // CosmWasm message types
  EXECUTE_CONTRACT: '/cosmwasm.wasm.v1.MsgExecuteContract',
  INSTANTIATE_CONTRACT: '/cosmwasm.wasm.v1.MsgInstantiateContract',
  
  // Cosmos standard message types
  SEND: '/cosmos.bank.v1beta1.MsgSend',
  DELEGATE: '/cosmos.staking.v1beta1.MsgDelegate',
  UNDELEGATE: '/cosmos.staking.v1beta1.MsgUndelegate',
  BEGIN_REDELEGATE: '/cosmos.staking.v1beta1.MsgBeginRedelegate',
  
  // Other message types can be added here
};

/**
 * Reverse mapping for easier type checking
 */
export const MESSAGE_TYPE_NAMES: Record<string, keyof typeof MESSAGE_TYPES> = 
  Object.entries(MESSAGE_TYPES).reduce((acc, [key, value]) => {
    acc[value] = key as keyof typeof MESSAGE_TYPES;
    return acc;
  }, {} as Record<string, keyof typeof MESSAGE_TYPES>);