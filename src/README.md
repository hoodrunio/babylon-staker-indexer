# Babylon Transaction Batch Processing

This module is a system developed to fetch and process transactions in the Babylon blockchain in batches. Instead of fetching individual transactions, it significantly improves performance by processing all transactions per block at once.

## Overview

The system consists of the following main components:

1. **Transaction Decoder**: Decodes transactions in Base64 format
2. **Message Decoder**: Decodes messages within a transaction according to their type
3. **Batch Processor**: Processes all transactions in a block in batches

## File Structure

```
src/
├── decoders/
│   ├── index.ts            # main export file
│   ├── transaction.ts      # Transaction decoder
│   ├── messageTypes.ts     # message types constants
│   └── messageDecoders.ts  # message decoders
├── utils/
│   └── base64.ts           # Base64 util
├── batchProcessor.ts       # Batch processing logic
├── test-decoder.ts         # Test file
└── integration-example.ts  # integration example
```

## Usage

### Basic example

```typescript
import { processBlockTransactions } from './batchProcessor';
import axios from 'axios';

// API client
const client = axios.create({
  baseURL: 'https://babylon-testnet-rpc.polkachu.com',
});

// Process transactions in a specific block
async function processBlock(height: number) {
  const transactions = await processBlockTransactions(client, height, 200);
  console.log(`${transactions.length} transactions processed`);
  
  // Process transactions
  for (const tx of transactions) {
    console.log(`Transaction: ${tx.hash}, Success: ${tx.success}`);
    
    // Process messages
    for (const msg of tx.messages) {
      console.log(`Message Type: ${msg.typeUrl}`);
      // Use message content
      // ...
    }
    
    // Process events
    const events = tx.events;
    // ...
  }
}

// Example
processBlock(386101).catch(console.error);
```

### Configuration

Batch processing can be configured as follows:

```typescript
// Configuration
const config = {
  useBatchProcessing: true,   // Use batch processing
  batchSize: 200,             // Maximum number of transactions per block
  maxRetries: 3               // Number of retries in case of error
};
```

### Existing Application Integration

To integrate with your existing application:

1. Add and compile proto files to your project
2. Integrate decoder modules and batch processing logic
3. Replace your existing transaction fetching code with the new batch processing code or support both

For more information, see the `integration-example.ts` file.

## Testing

For testing, run the following command:

```bash
ts-node src/test-decoder.ts
```

This will verify that the system is working correctly by processing both a single transaction and all transactions in a block.

## Performance

Batch processing is much more efficient than using getTxSearch individually. Example performance comparison:

- **Old Method**: One request per TX (~1 second / TX)
- **New Method**: One request per block (~1-2 seconds for 200 TX)

## Contributing

1. Update the `messageTypes.ts` and `messageDecoders.ts` files to add more message types
2. Create a pull request after testing