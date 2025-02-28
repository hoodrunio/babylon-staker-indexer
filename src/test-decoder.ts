/**
 * Transaction decoder test dosyası
 * 
 * Bu dosya, oluşturduğumuz decoder'ın çalıştığını test etmek için kullanılır.
 * Node ile doğrudan çalıştırılabilir: 
 * ts-node src/test-decoder.ts
 */

import axios from 'axios';
import { decodeTx } from './decoders';
import { processBlockTransactions } from './batchProcessor';

// Babylon node URL
const BABYLON_NODE_URL = 'https://babylon-testnet-rpc.polkachu.com';

/**
 * Örnek bir TX'i test et
 */
async function testSingleTx() {
  try {
    // Örnek bir TX hash
    const txHash = '2EF7DAE83E9D4CBA60CB97DAE770334C34025BC3BFAD3C81DE2BBA2F07676CC0';
    
    // TX bilgilerini getir
    const response = await axios.get(`${BABYLON_NODE_URL}/tx?hash=0x${txHash}`);
    const txData = response.data;
    
    if (!txData || !txData.result || !txData.result.tx) {
      console.error('TX verisi bulunamadı');
      return;
    }
    
    // TX'i decode et
    const txBase64 = txData.result.tx;
    const decodedTx = decodeTx(txBase64);
    
    console.log('Decoded TX:', JSON.stringify(decodedTx, null, 2));
    console.log('Messages:', decodedTx.messages.length);
    decodedTx.messages.forEach((msg, i) => {
      console.log(`Message ${i+1} Type:`, msg.typeUrl);
      console.log(`Message ${i+1} Content:`, JSON.stringify(msg.content, null, 2));
      console.log('---');
    });
  } catch (error) {
    console.error('Test hatası:', error);
  }
}

/**
 * Bir bloktaki tüm TX'leri test et
 */
async function testBlockTxs() {
  try {
    // Test için bir blok yüksekliği
    const blockHeight = 386101;
    
    // Axios istemcisi
    const BABYLON_NODE_URL = 'https://babylon-testnet-api-pruned-1.nodes.guru';
    
    const client = axios.create({
      baseURL: BABYLON_NODE_URL,
    });
    
    // Bloktaki TX'leri işle
    const processedTxs = await processBlockTransactions(client, blockHeight);
    
    console.log(`${processedTxs.length} işlem işlendi`);
    console.log('İlk 2 işlem özeti:');
    
    // İlk birkaç işlemi göster
    processedTxs.slice(0, 2).forEach((tx, i) => {
      console.log(`TX ${i+1} Hash:`, tx.hash);
      console.log(`TX ${i+1} Success:`, tx.success);
      console.log(`TX ${i+1} Messages:`, tx.messages.length);
      console.log('---');
    });
    
    // Özet istatistikler
    const successCount = processedTxs.filter(tx => tx.success).length;
    const failedCount = processedTxs.filter(tx => !tx.success).length;
    
    console.log('Özet:');
    console.log('Toplam İşlem:', processedTxs.length);
    console.log('Başarılı İşlem:', successCount);
    console.log('Başarısız İşlem:', failedCount);
  } catch (error) {
    console.error('Blok test hatası:', error);
  }
}

// Testleri çalıştır
async function runTests() {
  console.log('Single TX Test:');
  await testSingleTx();
  
  console.log('\n\nBlock TXs Test:');
  await testBlockTxs();
}

// Test fonksiyonunu çalıştır
runTests().catch(console.error); 