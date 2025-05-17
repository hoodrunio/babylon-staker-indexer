# BabylonClient Tek Ağlı Yapı için Güncelleme Listesi

Bu dosya, BabylonClient'ın yeni tek ağlı yapısı için güncellenmesi gereken tüm servisleri içerir.

## Güncelleme Kuralları
- Tüm `BabylonClient.getInstance(network)` çağrıları, parametre olmadan `BabylonClient.getInstance()` şeklinde güncellenmelidir
- `Network` parametresi alan servis constructor'ları ve getInstance() metodları güncellenmeli
- Çoklu ağ desteği veren servisler tek ağ kullanacak şekilde yeniden yapılandırılmalı
- getBabylonClient() metodlarını tek ağ modeline uyumlu hale getir

## Güncellenmesi Gereken Servisler

### 1. BlockTimeService
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/BlockTimeService.ts`
- Network parametresini kaldır ve instance yapısını güncelle

### 2. FinalityProviderService
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/finality/FinalityProviderService.ts`
- getInstance() ve tüm network parametrelerini kaldır

### 3. FinalityEpochService
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/finality/FinalityEpochService.ts`
- Tüm BabylonClient.getInstance(network) çağrılarını güncelle
- useNetwork parametresini kaldır

### 4. FinalityRewardsService
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/finality/FinalityRewardsService.ts`
- getInstance() ve tüm network parametrelerini kaldır

### 5. StakeholderRewardsService
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/finality/StakeholderRewardsService.ts`
- getInstance() ve tüm network parametrelerini kaldır

### 6. FinalitySSEManager
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/finality/FinalitySSEManager.ts`
- getInstance() ve tüm network parametrelerini kaldır, testnet/mainnet özel çağrıları düzelt

### 7. FinalityDelegationService
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/finality/FinalityDelegationService.ts`
- getInstance() ve tüm network parametrelerini kaldır

### 8. FinalitySignatureService
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/finality/FinalitySignatureService.ts`
- getInstance() ve tüm network parametrelerini kaldır

### 9. GovernanceIndexerService
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/governance/GovernanceIndexerService.ts`
- Çoklu ağlı yapıyı tek ağlı yapıya dönüştür

### 10. GovernanceEventHandler
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/governance/GovernanceEventHandler.ts`
- getInstance() ve tüm network parametrelerini kaldır

### 11. ParamsService
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/params.service.ts`
- getClient() metodunu güncelle, network parametrelerini kaldır

### 12. ValidatorInfoService
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/validator/ValidatorInfoService.ts`
- Çoklu ağlı yapıyı tek ağlı yapıya dönüştür
- getBabylonClient metodu güncelle

### 13. HistoricalSyncService
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/block-processor/sync/historicalSync.service.ts`
- Çoklu ağlı yapıyı tek ağlı yapıya dönüştür
- getBabylonClient metodu güncelle

### 14. FetcherService
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/block-processor/common/fetcher.service.ts`
- Çoklu ağlı yapıyı tek ağlı yapıya dönüştür

### 15. BlockProcessorService
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/block-processor/common/blockProcessor.service.ts`
- getInstance() ve tüm network parametrelerini kaldır

### 16. BlockProcessorInitializer
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/block-processor/integration/BlockProcessorInitializer.ts`
- getInstance() ve tüm network parametrelerini kaldır

### 17. BTCDelegationService
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/btc-delegations/BTCDelegationService.ts`
- getBabylonClient metodu güncelle
- Network parametrelerini kaldır

### 18. BTCTransactionCrawlerService
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/btc-delegations/BTCTransactionCrawlerService.ts`
- Çoklu ağlı yapıyı tek ağlı yapıya dönüştür

### 19. Checkpointing Servisleri
- BLSCheckpointFetcher.ts
- CheckpointStatusFetcher.ts
- CheckpointStatusHandler.ts
- BLSCheckpointService.ts
- Bu servislerin ValidatorInfoService'den aldığı getBabylonClient kullanımlarını düzelt

### 20. CosmWasm Servisleri
- state.service.ts
- indexer.service.ts 
- verifier.service.ts
- Tüm BabylonClient çağrılarını güncelle

### 21. FinalityWebSocketManager
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/services/finality/FinalityWebSocketManager.ts`
- getInstance() ve tüm network parametrelerini kaldır

### 22. Ana Uygulama
- Dosya: `/Users/errorist/Desktop/projects/babylon-staker-indexer/src/index.ts`
- BabylonClient çağrılarını güncelle

## İlerleme Durumu
- [x] BabylonClient güncellendi
- [ ] BlockTimeService
- [ ] FinalityProviderService
- [ ] FinalityEpochService
- [ ] FinalityRewardsService
- [ ] StakeholderRewardsService
- [ ] FinalitySSEManager
- [ ] FinalityDelegationService
- [ ] FinalitySignatureService
- [ ] GovernanceIndexerService
- [ ] GovernanceEventHandler
- [ ] ParamsService
- [ ] ValidatorInfoService
- [ ] HistoricalSyncService
- [ ] FetcherService
- [ ] BlockProcessorService
- [ ] BlockProcessorInitializer
- [ ] BTCDelegationService
- [ ] BTCTransactionCrawlerService
- [ ] Checkpointing Servisleri
- [ ] CosmWasm Servisleri
- [ ] FinalityWebSocketManager
- [ ] Ana Uygulama
