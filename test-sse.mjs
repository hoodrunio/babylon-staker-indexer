import EventSource from 'eventsource';

// Test edilecek FP BTC Public Key
const FP_BTC_PK = "69a101ca6c4425380783e7a39e688376ba1e0c33d0dcfd87f4a1010d04cfabb9";

// SSE bağlantısını oluştur
const sse = new EventSource(`http://localhost:3000/api/finality/signatures/${FP_BTC_PK}/stream`);

// İlk bağlantıda gelen veri
sse.addEventListener('initial', (event) => {
    console.log('\n[Initial Data]');
    console.log(JSON.parse(event.data));
});

// Her yeni blok güncellemesi
sse.addEventListener('update', (event) => {
    console.log('\n[Update]');
    console.log(JSON.parse(event.data));
});

// Bağlantı açıldığında
sse.onopen = () => {
    console.log('[Connected] SSE connection established');
};

// Hata durumunda
sse.onerror = (error) => {
    console.error('[Error]', error);
};

console.log('Listening for SSE events... Press Ctrl+C to exit'); 