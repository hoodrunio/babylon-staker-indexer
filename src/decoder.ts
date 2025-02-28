import { Tx } from './generated/proto/cosmos/tx/v1beta1/tx';
import { Any } from './generated/proto/google/protobuf/any';
import { MsgAddFinalitySig } from './generated/proto/babylon/finality/v1/tx';
import { MsgExecuteContract } from './generated/proto/cosmwasm/wasm/v1/tx';

// Cosmos SDK tipleri için
import * as cosmjsTypes from 'cosmjs-types';
// Özellikle MsgSend gibi yaygın tipleri direkt import edelim
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx';
import { 
  MsgDelegate, 
  MsgUndelegate, 
  MsgBeginRedelegate 
} from 'cosmjs-types/cosmos/staking/v1beta1/tx';
import { MsgWithdrawDelegatorReward } from 'cosmjs-types/cosmos/distribution/v1beta1/tx';

// BTC Staking mesajları
import { 
  MsgCreateFinalityProvider,
  MsgEditFinalityProvider,
  MsgCreateBTCDelegation,
  MsgAddBTCDelegationInclusionProof,
  MsgAddCovenantSigs,
  MsgBTCUndelegate,
  MsgSelectiveSlashingEvidence
} from './generated/proto/babylon/btcstaking/v1/tx';

// Finality mesajları
import {
  MsgCommitPubRandList,
  MsgUnjailFinalityProvider,
  MsgEquivocationEvidence 
} from './generated/proto/babylon/finality/v1/tx';

// Epoching mesajları
import {
  MsgWrappedDelegate,
  MsgWrappedUndelegate,
  MsgWrappedBeginRedelegate,
  MsgWrappedCancelUnbondingDelegation,
  MsgWrappedEditValidator
} from './generated/proto/babylon/epoching/v1/tx';

// Checkpointing mesajları
import { MsgWrappedCreateValidator } from './generated/proto/babylon/checkpointing/v1/tx';

/**
 * Buffer nesnelerini hexadecimal stringlere dönüştüren yardımcı fonksiyon
 */
export function bufferToHex(buffer: Uint8Array | Buffer | null | undefined): string {
  if (!buffer) return '';
  return Buffer.from(buffer).toString('hex');
}

/**
 * Objeler içindeki tüm Buffer değerlerini hex stringlere dönüştürür
 */
export function convertBuffersToHex(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (Buffer.isBuffer(obj) || (obj && obj.type === 'Buffer' && Array.isArray(obj.data))) {
    return bufferToHex(Buffer.isBuffer(obj) ? obj : Buffer.from(obj.data));
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => convertBuffersToHex(item));
  }
  
  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = convertBuffersToHex(obj[key]);
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * RPC'den gelen base64 formatındaki transaction'ı decode eder
 */
export function decodeTx(txBase64: string) {
  // Base64'ten binary'e dönüştür
  const txBytes = Buffer.from(txBase64, 'base64');
  
  // TX'i decode et
  const tx = Tx.decode(txBytes);
  
  // Mesajları decode et
  const messages = tx.body?.messages.map(msg => decodeMessage(msg)) || [];
  
  // Buffer nesnelerini hex stringlere dönüştür
  return convertBuffersToHex({
    tx,
    messages
  });
}

/**
 * Transaction içindeki mesajı tipine göre decode eder
 */
function decodeMessage(msg: Any) {
  try {
    // Babylon özel mesajları
    switch (msg.typeUrl) {
      // Finality mesajları
      case '/babylon.finality.v1.MsgAddFinalitySig':
        return {
          type: msg.typeUrl,
          content: MsgAddFinalitySig.decode(msg.value)
        };
        
      case '/babylon.finality.v1.MsgCommitPubRandList':
        return {
          type: msg.typeUrl,
          content: MsgCommitPubRandList.decode(msg.value)
        };
        
      case '/babylon.finality.v1.MsgUnjailFinalityProvider':
        return {
          type: msg.typeUrl,
          content: MsgUnjailFinalityProvider.decode(msg.value)
        };
        
      case '/babylon.finality.v1.MsgEquivocationEvidence':
        return {
          type: msg.typeUrl,
          content: MsgEquivocationEvidence.decode(msg.value)
        };

      // BTC Staking mesajları
      case '/babylon.btcstaking.v1.MsgCreateFinalityProvider':
        return {
          type: msg.typeUrl,
          content: MsgCreateFinalityProvider.decode(msg.value)
        };
        
      case '/babylon.btcstaking.v1.MsgEditFinalityProvider':
        return {
          type: msg.typeUrl,
          content: MsgEditFinalityProvider.decode(msg.value)
        };
        
      case '/babylon.btcstaking.v1.MsgCreateBTCDelegation':
        return {
          type: msg.typeUrl,
          content: MsgCreateBTCDelegation.decode(msg.value)
        };
        
      case '/babylon.btcstaking.v1.MsgAddBTCDelegationInclusionProof':
        return {
          type: msg.typeUrl,
          content: MsgAddBTCDelegationInclusionProof.decode(msg.value)
        };
        
      case '/babylon.btcstaking.v1.MsgAddCovenantSigs':
        return {
          type: msg.typeUrl,
          content: MsgAddCovenantSigs.decode(msg.value)
        };
        
      case '/babylon.btcstaking.v1.MsgBTCUndelegate':
        return {
          type: msg.typeUrl,
          content: MsgBTCUndelegate.decode(msg.value)
        };
        
      case '/babylon.btcstaking.v1.MsgSelectiveSlashingEvidence':
        return {
          type: msg.typeUrl,
          content: MsgSelectiveSlashingEvidence.decode(msg.value)
        };

      // Epoching mesajları
      case '/babylon.epoching.v1.MsgWrappedDelegate':
        return {
          type: msg.typeUrl,
          content: MsgWrappedDelegate.decode(msg.value)
        };
        
      case '/babylon.epoching.v1.MsgWrappedUndelegate':
        return {
          type: msg.typeUrl,
          content: MsgWrappedUndelegate.decode(msg.value)
        };
        
      case '/babylon.epoching.v1.MsgWrappedBeginRedelegate':
        return {
          type: msg.typeUrl,
          content: MsgWrappedBeginRedelegate.decode(msg.value)
        };
        
      case '/babylon.epoching.v1.MsgWrappedCancelUnbondingDelegation':
        return {
          type: msg.typeUrl,
          content: MsgWrappedCancelUnbondingDelegation.decode(msg.value)
        };
        
      case '/babylon.epoching.v1.MsgWrappedEditValidator':
        return {
          type: msg.typeUrl,
          content: MsgWrappedEditValidator.decode(msg.value)
        };
        
      // Checkpointing mesajları
      case '/babylon.checkpointing.v1.MsgWrappedCreateValidator':
        return {
          type: msg.typeUrl,
          content: MsgWrappedCreateValidator.decode(msg.value)
        };

      // CosmWasm mesajları
      case '/cosmwasm.wasm.v1.MsgExecuteContract':
        const contractMsg = MsgExecuteContract.decode(msg.value);
        // Contract mesajını da parse et
        if (contractMsg.msg) {
          try {
            const jsonMsg = JSON.parse(new TextDecoder().decode(contractMsg.msg));
            return {
              type: msg.typeUrl,
              content: {
                ...contractMsg,
                decodedMsg: jsonMsg
              }
            };
          } catch {
            return {
              type: msg.typeUrl,
              content: contractMsg
            };
          }
        }
        return {
          type: msg.typeUrl,
          content: contractMsg
        };
    }
    
    // Cosmos SDK mesajları için dinamik çözümleme deneyin
    if (msg.typeUrl.startsWith('/cosmos.')) {
      return decodeCosmosSdkMessage(msg);
    }
    
    // Diğer mesaj türleri için JSON parse etmeyi dene
    return {
      type: msg.typeUrl,
      content: tryParseRawMessage(msg.value)
    };
  } catch (error) {
    // Hata durumunda en azından tip ve ham veriyi döndür
    return {
      type: msg.typeUrl,
      rawValue: bufferToHex(msg.value),
      error: `Decode hatası: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Cosmos SDK mesajlarını dinamik olarak decode eder
 */
function decodeCosmosSdkMessage(msg: Any) {
  try {
    // Önce en yaygın mesaj tiplerini kontrol et
    switch (msg.typeUrl) {
      case '/cosmos.bank.v1beta1.MsgSend':
        return {
          type: msg.typeUrl,
          content: MsgSend.decode(msg.value)
        };
      case '/cosmos.staking.v1beta1.MsgDelegate':
        return {
          type: msg.typeUrl,
          content: MsgDelegate.decode(msg.value)
        };
      case '/cosmos.staking.v1beta1.MsgUndelegate':
        return {
          type: msg.typeUrl,
          content: MsgUndelegate.decode(msg.value)
        };
      case '/cosmos.staking.v1beta1.MsgBeginRedelegate':
        return {
          type: msg.typeUrl,
          content: MsgBeginRedelegate.decode(msg.value)
        };
      case '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward':
        return {
          type: msg.typeUrl,
          content: MsgWithdrawDelegatorReward.decode(msg.value)
        };
    }

    // Dinamik yol çözümlemesi ile diğer tipleri dene
    // Type URL'yi parçala: /cosmos.bank.v1beta1.MsgSend -> cosmos.bank.v1beta1.MsgSend
    const typeName = msg.typeUrl.substring(1);
    
    // Yolları nokta ile ayır 
    const parts = typeName.split('.');
    
    // cosmjs-types içinde modülleri bulmaya çalış
    try {
      // Modül yolunu oluştur: örneğin 'cosmos/bank/v1beta1/tx'
      // Not: cosmjs-types'ın yapısı böyle çalışıyor
      const namespace = parts.slice(0, -1).join('/');
      const msgType = parts[parts.length - 1];
      
      // Dinamik olarak modülü import etmeye çalış
      // Not: Bu yaklaşım run-time'da require kullanır
      const protoModule = require(`cosmjs-types/${namespace}/tx`);
      
      if (protoModule && protoModule[msgType]) {
        return {
          type: msg.typeUrl,
          content: protoModule[msgType].decode(msg.value)
        };
      }
    } catch (importError) {
      console.warn(`Cosmos modülü import edilemedi: ${typeName}`, importError);
    }
    
    // Fallback - JSON parse etmeyi dene
    return {
      type: msg.typeUrl,
      content: tryParseRawMessage(msg.value)
    };
  } catch (error) {
    console.warn(`Cosmos mesajı decode edilemedi: ${msg.typeUrl}`, error);
    // Fallback - JSON parse etmeyi dene
    return {
      type: msg.typeUrl,
      content: tryParseRawMessage(msg.value)
    };
  }
}

/**
 * Raw message verisini JSON olarak parse etmeyi dener
 */
function tryParseRawMessage(value: Uint8Array) {
  try {
    // Önce string olarak decode et
    const text = new TextDecoder().decode(value);
    // JSON parse etmeyi dene
    return JSON.parse(text);
  } catch {
    // JSON olarak parse edilemiyorsa hex olarak döndür
    return {
      rawValue: bufferToHex(value)
    };
  }
} 