# Babylon Staker Indexer

A specialized indexer for tracking and analyzing Bitcoin transactions related to the Babylon Protocol staking system. This service monitors Bitcoin blocks for staking transactions, validates them according to protocol rules, and provides detailed analytics through a REST API.

## Features

- Real-time indexing of Babylon Protocol staking transactions
- Multi-phase staking support (Phase 1, 2, and 3)
- Comprehensive transaction validation based on protocol parameters (In development)
- REST API for querying staking data and analytics
- Support for tracking finality providers, validators and stakers
- Configurable indexing parameters via environment variables

## Prerequisites

- Node.js (v16 or higher)
- TypeScript
- MongoDB
- Bitcoin Node RPC access
- Babylon Chain (PoS) RPC/LCD access

## Installation

1. Clone the repository:
```bash
git clone https://github.com/hoodrunio/babylon-staker-indexer.git
cd babylon-staker-indexer
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit the `.env` file with your configuration:
- `BTC_RPC_URL`: Your Bitcoin node RPC URL
- `MONGODB_URI`: MongoDB connection string
- `PORT`: API server port (default: 3000)
- Other cap-specific configuration options

## Usage

1. Build the project:
```bash
npm run build
```

2. Set up the database:
```bash
npm run db:setup
```

3. Start the indexer:
```bash
npm start
```

For development:
```bash
npm run dev
```

## API Endpoints

### Finality Providers
- `GET /api/finality-providers`: List all finality providers
- `GET /api/finality-providers/top`: Get top finality providers
- `GET /api/finality-providers/:address`: Get specific finality provider stats

### Stakers
- `GET /api/stakers`: List all stakers
- `GET /api/stakers/top`: Get top stakers by stake amount

### Stats
- `GET /api/stats`: Get global stats
- `GET /api/versions/:version`: Get stats for a specific version
- `GET /api/phases`: Get all phase stats
- `GET /api/phases/:phase`: Get stats for a specific phase

## Configuration

### Phase Configuration
The indexer supports different phases of the Babylon Protocol:

- Phase 1: Initial staking phase
  - Start Height: 857910
  - Target Stake: 1000 BTC
  - Min Stake: 0.005 BTC
  - Max Stake: 0.05 BTC

- Phase 2: Intermediate phase
  - Start Height: 864790
  - End Height: 864799
  - Max Stake: 500 BTC

- Phase 3: Final phase
  - Start Height: 874088
  - End Height: 875087
  - Max Stake: 500 BTC

## Development

Run tests:
```bash
npm test
```

Run linting:
```bash
npm run lint
```

Type checking:
```bash
npm run typecheck
```


## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request
