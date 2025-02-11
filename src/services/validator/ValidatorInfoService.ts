import { ValidatorInfo } from '../../database/models/ValidatorInfo';
import { Network } from '../../types/finality';
import { Buffer } from 'buffer';
import { BabylonClient } from '../../clients/BabylonClient';
import axios from 'axios';
import { FinalityProviderService } from '../finality/FinalityProviderService';

export class ValidatorInfoService {
    private static instance: ValidatorInfoService | null = null;
    private readonly babylonClients: Map<Network, BabylonClient>;
    private updateInterval: number;
    private maxRetries: number;
    private retryDelay: number;

    private constructor() {
        this.babylonClients = new Map();
        // Default values - can be overridden via environment variables
        this.updateInterval = parseInt(process.env.VALIDATOR_UPDATE_INTERVAL_MS || '3600000'); // 1 hour default
        this.maxRetries = parseInt(process.env.VALIDATOR_UPDATE_MAX_RETRIES || '3');
        this.retryDelay = parseInt(process.env.VALIDATOR_UPDATE_RETRY_DELAY_MS || '5000'); // 5 seconds

        // Initialize clients for both networks
        try {
            this.babylonClients.set(Network.MAINNET, BabylonClient.getInstance(Network.MAINNET));
            console.log('[ValidatorInfo] Mainnet client initialized successfully');
        } catch (error) {
            console.warn('[ValidatorInfo] Mainnet is not configured, skipping');
        }

        try {
            this.babylonClients.set(Network.TESTNET, BabylonClient.getInstance(Network.TESTNET));
            console.log('[ValidatorInfo] Testnet client initialized successfully');
        } catch (error) {
            console.warn('[ValidatorInfo] Testnet is not configured, skipping');
        }

        if (this.babylonClients.size === 0) {
            throw new Error('[ValidatorInfo] No network configurations found. Please configure at least one network.');
        }

        // Start periodic updates only if not in test environment
        if (process.env.NODE_ENV !== 'test') {
            this.startPeriodicUpdates();
        }
    }

    public static getInstance(): ValidatorInfoService {
        if (!ValidatorInfoService.instance) {
            ValidatorInfoService.instance = new ValidatorInfoService();
        }
        return ValidatorInfoService.instance;
    }

    private async startPeriodicUpdates(): Promise<void> {
        // Initial update with retries
        await this.retryUpdate();

        // Schedule periodic updates
        setInterval(async () => {
            await this.retryUpdate();
        }, this.updateInterval);
    }

    private async retryUpdate(): Promise<void> {
        let retryCount = 0;
        let success = false;

        while (!success && retryCount < this.maxRetries) {
            try {
                await this.updateAllValidators();
                success = true;
                if (retryCount > 0) {
                    console.log(`[ValidatorInfo] Successfully updated after ${retryCount + 1} attempts`);
                }
            } catch (error) {
                retryCount++;
                console.error(`[ValidatorInfo] Update attempt ${retryCount}/${this.maxRetries} failed:`, error);
                
                if (retryCount < this.maxRetries) {
                    console.log(`[ValidatorInfo] Retrying in ${this.retryDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                }
            }
        }

        if (!success) {
            console.error(`[ValidatorInfo] Failed to update validators after ${this.maxRetries} attempts`);
        }
    }

    private async updateAllValidators(): Promise<void> {
        try {
            // Update for all configured networks
            const updatePromises = Array.from(this.babylonClients.entries()).map(
                ([network, _]) => this.fetchAndUpdateValidators(network)
            );
            await Promise.all(updatePromises);
        } catch (error) {
            console.error('[ValidatorInfo] Error updating all validators:', error);
        }
    }

    private async fetchAndUpdateValidators(network: Network): Promise<void> {
        try {
            const client = this.babylonClients.get(network);
            if (!client) {
                console.warn(`[ValidatorInfo] No client configured for ${network}, skipping update`);
                return;
            }

            const baseUrl = client.getBaseUrl();
            console.log(`[ValidatorInfo] Fetching validators from ${network} using base URL: ${baseUrl}`);

            // Fetch validators from Tendermint API
            const tmResponse = await axios.get(`${client.getRpcUrl()}/validators?page=1&per_page=500`);
            const tmValidators = tmResponse.data.result.validators;
            console.log(`[ValidatorInfo] Found ${tmValidators.length} validators from Tendermint API`);

            // Create a map of tendermint validators by address
            const tmValidatorMap = new Map();
            for (const validator of tmValidators) {
                // Store both uppercase and original format
                tmValidatorMap.set(validator.address.toUpperCase(), validator);
                tmValidatorMap.set(validator.address, validator);
            }

            // Fetch all active validators from App API
            const cosmosResponse = await axios.get(`${baseUrl}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=500`);
            const cosmosValidators = cosmosResponse.data.validators;
            console.log(`[ValidatorInfo] Found ${cosmosValidators.length} validators from Cosmos API`);

            // Process each validator
            let updateCount = 0;
            let activeValidatorsWithPower = 0;
            for (const validator of cosmosValidators) {
                try {
                    // Get consensus key and convert to hex address
                    const consensusHexAddress = this.getConsensusHexAddress(validator.consensus_pubkey.key);

                    // Check if this validator exists in tendermint validators
                    let tmValidator = tmValidatorMap.get(consensusHexAddress);

                    // If not found, try with uppercase
                    if (!tmValidator) {
                        tmValidator = tmValidatorMap.get(consensusHexAddress.toUpperCase());
                    }

                    const votingPower = tmValidator ? tmValidator.voting_power : '0';

                    if (tmValidator) {
                        activeValidatorsWithPower++;
                    }

                    // Update validator info
                    await ValidatorInfo.findOneAndUpdate(
                        {
                            consensus_hex_address: consensusHexAddress,
                            network
                        },
                        {
                            hex_address: consensusHexAddress,
                            consensus_pubkey: validator.consensus_pubkey.key,
                            valoper_address: validator.operator_address,
                            moniker: validator.description.moniker,
                            website: validator.description.website,
                            details: validator.description.details,
                            active: validator.status === 'BOND_STATUS_BONDED',
                            voting_power: votingPower,
                            last_seen: new Date()
                        },
                        { upsert: true, new: true }
                    );

                    // After updating validator info, try to match with finality providers
                    await this.matchValidatorWithFinalityProviders(validator, network);

                    updateCount++;
                } catch (error: any) {
                    console.error(`[ValidatorInfo] Error processing validator:`, {
                        moniker: validator.description?.moniker,
                        error: error.message || String(error)
                    });
                }
            }

            console.log(`[ValidatorInfo] Update summary for ${network}:`, {
                total_validators: cosmosValidators.length,
                updated_count: updateCount,
                active_validators_with_power: activeValidatorsWithPower,
                total_tendermint_validators: tmValidators.length
            });
        } catch (error) {
            console.error(`[ValidatorInfo] Error fetching validators for ${network}:`, error);
            throw error;
        }
    }

    private getConsensusHexAddress(consensusPubkey: string): string {
        try {
            // Decode base64 pubkey
            const pubkeyBytes = Buffer.from(consensusPubkey, 'base64');
            
            // Take SHA256 of the pubkey and then first 20 bytes
            const crypto = require('crypto');
            const hash = crypto.createHash('sha256').update(pubkeyBytes).digest();
            const hexAddress = hash.slice(0, 20).toString('hex').toUpperCase();

            // Validate hex address format
            if (!/^[0-9A-F]{40}$/.test(hexAddress)) {
                throw new Error(`Invalid hex address format: ${hexAddress}`);
            }

            return hexAddress;
        } catch (error) {
            console.error('[ValidatorInfo] Error converting consensus pubkey to hex address:', error);
            throw error;
        }
    }

    public async updateValidatorInfo(validatorData: any, network: Network): Promise<void> {
        try {
            const consensusHexAddress = this.getConsensusHexAddress(validatorData.consensus_pubkey);

            await ValidatorInfo.findOneAndUpdate(
                {
                    consensus_hex_address: consensusHexAddress,
                    network
                },
                {
                    hex_address: validatorData.hex_address,
                    consensus_pubkey: validatorData.consensus_pubkey,
                    valoper_address: validatorData.operator_address,
                    moniker: validatorData.description.moniker,
                    website: validatorData.description.website,
                    details: validatorData.description.details,
                    active: validatorData.status === 'BOND_STATUS_BONDED',
                    voting_power: validatorData.voting_power || '0',
                    last_seen: new Date()
                },
                { upsert: true, new: true }
            );
        } catch (error) {
            console.error('[ValidatorInfo] Error updating validator info:', error);
            throw error;
        }
    }

    public async getValidatorByHexAddress(hexAddress: string, network: Network): Promise<any> {
        try {
            return await ValidatorInfo.findOne({
                hex_address: hexAddress,
                network
            });
        } catch (error) {
            console.error('[ValidatorInfo] Error getting validator by hex address:', error);
            throw error;
        }
    }

    public async getValidatorByConsensusAddress(consensusHexAddress: string, network: Network): Promise<any> {
        try {
            return await ValidatorInfo.findOne({
                consensus_hex_address: consensusHexAddress,
                network
            });
        } catch (error) {
            console.error('[ValidatorInfo] Error getting validator by consensus address:', error);
            throw error;
        }
    }

    public getBabylonClient(network: Network): BabylonClient | undefined {
        return this.babylonClients.get(network);
    }

    private async matchValidatorWithFinalityProviders(validator: any, network: Network): Promise<void> {
        try {
            // Get all active finality providers
            const finalityProviderService = FinalityProviderService.getInstance();
            const providers = await finalityProviderService.getAllFinalityProviders(network);

            let matched = false;
            let matchedBy = null;
            let matchedProviderPk = null;

            for (const provider of providers) {
                // Try matching by moniker
                if (validator.description?.moniker && provider.description?.moniker && 
                    validator.description.moniker.toLowerCase() === provider.description.moniker.toLowerCase()) {
                    matched = true;
                    matchedBy = 'moniker';
                    matchedProviderPk = provider.btc_pk;
                    break;
                }

                // Try matching by website
                if (validator.description?.website && provider.description?.website && 
                    validator.description.website.toLowerCase() === provider.description.website.toLowerCase()) {
                    matched = true;
                    matchedBy = 'website';
                    matchedProviderPk = provider.btc_pk;
                    break;
                }

                // Try matching by identity
                if (validator.description?.identity && provider.description?.identity && 
                    validator.description.identity.toLowerCase() === provider.description.identity.toLowerCase()) {
                    matched = true;
                    matchedBy = 'identity';
                    matchedProviderPk = provider.btc_pk;
                    break;
                }

                // Try matching by security contact
                if (validator.description?.security_contact && provider.description?.details && 
                    validator.description.security_contact.toLowerCase() === provider.description.details.toLowerCase()) {
                    matched = true;
                    matchedBy = 'security_contact';
                    matchedProviderPk = provider.btc_pk;
                    break;
                }
            }

            // Update validator info with match results
            await ValidatorInfo.findOneAndUpdate(
                {
                    consensus_hex_address: this.getConsensusHexAddress(validator.consensus_pubkey.key),
                    network
                },
                {
                    $set: {
                        is_finality_provider: matched,
                        finality_provider_btc_pk_hex: matchedProviderPk,
                        matched_by: matchedBy
                    }
                }
            );
        } catch (error) {
            console.error('[ValidatorInfo] Error matching validator with finality providers:', error);
        }
    }
} 