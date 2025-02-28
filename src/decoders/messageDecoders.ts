import { Any } from '../generated/proto/google/protobuf/any';
import { MsgAddFinalitySig } from '../generated/proto/babylon/finality/v1/tx';
import { MsgExecuteContract, MsgInstantiateContract } from '../generated/proto/cosmwasm/wasm/v1/tx';
import { MsgSend } from '../generated/proto/cosmos/bank/v1beta1/tx';
import { MsgDelegate, MsgUndelegate, MsgBeginRedelegate } from '../generated/proto/cosmos/staking/v1beta1/tx';
import { MESSAGE_TYPES } from './messageTypes';
import { base64ToJson } from '../utils/base64';

// Genişletilmiş tip tanımlamaları
interface DecodedMsgExecuteContract extends MsgExecuteContract {
  decodedMsg?: any;
}

interface DecodedMsgInstantiateContract extends MsgInstantiateContract {
  decodedMsg?: any;
}

/**
 * Any tipindeki mesajı içeriğine göre decode eder
 * @param anyMsg Any tipindeki mesaj
 * @returns Decode edilmiş mesaj ve tipi
 */
export function decodeAnyMessage(anyMsg: Any): {
  typeUrl: string;
  content: any;
  rawValue?: Uint8Array;
} {
  const { typeUrl, value } = anyMsg;
  
  try {
    // Mesaj içeriğini tipine göre decode et
    const decodedContent = decodeMessage(typeUrl, value);
    
    return {
      typeUrl,
      content: decodedContent
    };
  } catch (error: unknown) {
    console.warn(`Mesaj tipi decode edilemedi: ${typeUrl}`, error);
    // Decode edilemeyen mesajları da eklemek için:
    return {
      typeUrl,
      content: null,
      rawValue: value
    };
  }
}

/**
 * Belirli bir mesaj tipini decode eder
 * @param typeUrl Mesaj tipi URL'si 
 * @param value Binary mesaj içeriği
 * @returns Decode edilmiş mesaj
 */
export function decodeMessage(typeUrl: string, value: Uint8Array): any {
  switch (typeUrl) {
    // Babylon mesaj tipleri
    case MESSAGE_TYPES.ADD_FINALITY_SIG:
      return MsgAddFinalitySig.decode(value);
    
    // CosmWasm mesaj tipleri  
    case MESSAGE_TYPES.EXECUTE_CONTRACT: {
      const msg = MsgExecuteContract.decode(value) as DecodedMsgExecuteContract;
      // CosmWasm için JSON mesajlarını da parse et
      if (msg.msg && msg.msg.length > 0) {
        try {
          const textDecoder = new TextDecoder();
          const jsonStr = textDecoder.decode(msg.msg);
          msg.decodedMsg = JSON.parse(jsonStr);
        } catch (error: unknown) {
          console.warn('Contract mesajı JSON parse edilemedi', error);
        }
      }
      return msg;
    }
      
    case MESSAGE_TYPES.INSTANTIATE_CONTRACT: {
      const msg = MsgInstantiateContract.decode(value) as DecodedMsgInstantiateContract;
      // CosmWasm için JSON mesajlarını da parse et
      if (msg.msg && msg.msg.length > 0) {
        try {
          const textDecoder = new TextDecoder();
          const jsonStr = textDecoder.decode(msg.msg);
          msg.decodedMsg = JSON.parse(jsonStr);
        } catch (error: unknown) {
          console.warn('Contract mesajı JSON parse edilemedi', error);
        }
      }
      return msg;
    }
    
    // Cosmos standart mesaj tipleri
    case MESSAGE_TYPES.SEND:
      return MsgSend.decode(value);
      
    case MESSAGE_TYPES.DELEGATE:
      return MsgDelegate.decode(value);
      
    case MESSAGE_TYPES.UNDELEGATE:
      return MsgUndelegate.decode(value);
      
    case MESSAGE_TYPES.BEGIN_REDELEGATE:
      return MsgBeginRedelegate.decode(value);
    
    // Bilinmeyen mesaj tipleri
    default:
      // Bilinmeyen mesaj tiplerini genel olarak JSON formatına dönüştürmeyi dene
      try {
        const textDecoder = new TextDecoder();
        const jsonStr = textDecoder.decode(value);
        return JSON.parse(jsonStr);
      } catch {
        throw new Error(`Bilinmeyen mesaj tipi: ${typeUrl}`);
      }
  }
} 