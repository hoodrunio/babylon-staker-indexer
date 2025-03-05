import axios from 'axios';
import { decodeTx } from '../decoders';

// RPC endpoint (kullanıcı tarafından değiştirilebilir)
const DEFAULT_RPC_ENDPOINT = 'https://babylon-testnet-rpc-pruned-1.nodes.guru';

/**
 * Belirli bir blok yüksekliğindeki tüm işlemleri getirir
 * @param height Blok yüksekliği
 * @param rpcEndpoint İsteğe bağlı RPC endpoint
 * @returns İşlem listesi veya hata durumunda null
 */
async function getTxsByHeight(height: number, rpcEndpoint: string = DEFAULT_RPC_ENDPOINT): Promise<any[] | null> {
  try {
    console.log(`${height} blok yüksekliğindeki işlemler getiriliyor...`);
    
    // tx_search kullanarak blok yüksekliğine göre işlemleri getir
    const response = await axios.get(`${rpcEndpoint}/tx_search?query="tx.height=${height}"&prove=false&page=1&per_page=100`);
    
    if (response.data?.result?.txs && response.data.result.txs.length > 0) {
      const txs = response.data.result.txs;
      console.log(`${txs.length} işlem bulundu.`);
      
      // İşlemleri hash ve tx bilgisiyle döndür
      return txs.map((tx: any) => ({
        height: parseInt(tx.height, 10),
        hash: tx.hash,
        tx: tx.tx
      }));
    } else {
      console.log('Bu blokta işlem bulunamadı.');
      return [];
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`İşlemler getirilirken hata oluştu: ${errorMessage}`);
    return null;
  }
}

/**
 * Hash değeri ile bir işlemi getirir
 * @param hash İşlem hash'i
 * @param rpcEndpoint İsteğe bağlı RPC endpoint
 * @returns İşlem verisi veya hata durumunda null
 */
async function getTxByHash(hash: string, rpcEndpoint: string = DEFAULT_RPC_ENDPOINT): Promise<any | null> {
  try {
    console.log(`${hash} hash'li işlem getiriliyor...`);
    
    const response = await axios.get(`${rpcEndpoint}/tx?hash=0x${hash}`);
    
    if (response.data?.result?.tx) {
      console.log('İşlem başarıyla getirildi.');
      return {
        height: response.data.result.height,
        hash: hash,
        tx: response.data.result.tx
      };
    } else {
      console.log('İşlem bulunamadı.');
      return null;
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`İşlem getirilirken hata oluştu: ${errorMessage}`);
    return null;
  }
}

/**
 * Belirli bir blok yüksekliğindeki tüm işlemleri getirir ve decode eder
 * @param height Blok yüksekliği
 * @param rpcEndpoint İsteğe bağlı RPC endpoint
 * @returns Decode edilmiş işlem listesi
 */
async function decodeBlockTransactions(height: number, rpcEndpoint: string = DEFAULT_RPC_ENDPOINT): Promise<any[]> {
  const txs = await getTxsByHeight(height, rpcEndpoint);
  
  if (!txs || txs.length === 0) {
    return [];
  }
  
  console.log(`${txs.length} işlem çözülüyor...`);
  
  const decodedTxs = [];
  
  for (const tx of txs) {
    try {
      const decoded = decodeTx(tx.tx);
      decodedTxs.push({
        height: tx.height,
        hash: tx.hash,
        decoded
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${tx.hash} hash'li işlem decode edilirken hata oluştu: ${errorMessage}`);
      
      decodedTxs.push({
        height: tx.height,
        hash: tx.hash,
        error: `Decode hatası: ${errorMessage}`
      });
    }
  }
  
  return decodedTxs;
}

/**
 * Hash değeri ile bir işlemi getirir ve decode eder
 * @param hash İşlem hash'i
 * @param rpcEndpoint İsteğe bağlı RPC endpoint
 * @returns Decode edilmiş işlem
 */
async function decodeTxByHash(hash: string, rpcEndpoint: string = DEFAULT_RPC_ENDPOINT): Promise<any | null> {
  const tx = await getTxByHash(hash, rpcEndpoint);
  
  if (!tx) {
    return null;
  }
  
  try {
    const decoded = decodeTx(tx.tx);
    return {
      height: tx.height,
      hash: tx.hash,
      decoded
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`İşlem decode edilirken hata oluştu: ${errorMessage}`);
    
    return {
      height: tx.height,
      hash: tx.hash,
      error: `Decode hatası: ${errorMessage}`
    };
  }
}

/**
 * Ana fonksiyon - argümanları değerlendirerek işlemleri getirir
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Kullanım:');
    console.log('  npm run get-tx -- --height <blok_yüksekliği>');
    console.log('  npm run get-tx -- --hash <işlem_hash>');
    return;
  }
  
  const option = args[0];
  const value = args[1];
  
  let result = null;
  
  if (option === '--height' && value) {
    const height = parseInt(value, 10);
    
    if (isNaN(height)) {
      console.error('Geçersiz blok yüksekliği.');
      return;
    }
    
    result = await decodeBlockTransactions(height);
  } else if (option === '--hash' && value) {
    // Hash değeri 0x ile başlıyorsa temizle
    const hash = value.startsWith('0x') ? value.substring(2) : value;
    result = await decodeTxByHash(hash);
  } else {
    console.error('Geçersiz argümanlar.');
    console.log('Kullanım:');
    console.log('  npm run get-tx -- --height <blok_yüksekliği>');
    console.log('  npm run get-tx -- --hash <işlem_hash>');
    return;
  }
  
  // Sonuçları göster
  console.log(JSON.stringify(result, null, 2));
}

// Uygulamayı başlat
main().catch(error => {
  console.error('Beklenmeyen bir hata oluştu:', error);
  process.exit(1);
}); 