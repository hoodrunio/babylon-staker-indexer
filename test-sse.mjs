import EventSource from 'eventsource';

// FP BTC Public Key to be tested
const FP_BTC_PK = "69a101ca6c4425380783e7a39e688376ba1e0c33d0dcfd87f4a1010d04cfabb9";

// Create SSE connection
const sse = new EventSource(`http://localhost:3000/api/finality/signatures/${FP_BTC_PK}/stream`);

// Data received on initial connection
sse.addEventListener('initial', (event) => {
    console.log('\n[Initial Data]');
    console.log(JSON.parse(event.data));
});

// Each new block update
sse.addEventListener('update', (event) => {
    console.log('\n[Update]');
    console.log(JSON.parse(event.data));
});

// When connection is opened
sse.onopen = () => {
    console.log('[Connected] SSE connection established');
};

// In case of error
sse.onerror = (error) => {
    console.error('[Error]', error);
};

console.log('Listening for SSE events... Press Ctrl+C to exit');