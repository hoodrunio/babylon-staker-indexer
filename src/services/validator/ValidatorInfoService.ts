import { ValidatorInfo } from '../../database/models/ValidatorInfo';
import { Network } from '../../types/finality';
import { Buffer } from 'buffer';
import { BabylonClient } from '../../clients/BabylonClient';
import axios from 'axios';
import { FinalityProviderService } from '../finality/FinalityProviderService';
import { logger } from '../../utils/logger';
import { bech32 } from 'bech32';
import { getKeybaseLogo } from '../../utils/keybase';
import mongoose from 'mongoose';

export class ValidatorInfoService {
    private static instance: ValidatorInfoService | null = null;
    private babylonClient: BabylonClient;
    private updateInterval: number;
    private maxRetries: number;
    private retryDelay: number;
    private isInitialized: boolean = false;
    private updatePromise: Promise<void> | null = null;

    private constructor() {
        // Default values - can be overridden via environment variables
        this.updateInterval = parseInt(process.env.VALIDATOR_UPDATE_INTERVAL_MS || '3600000'); // 1 hour default
        this.maxRetries = parseInt(process.env.VALIDATOR_UPDATE_MAX_RETRIES || '3');
        this.retryDelay = parseInt(process.env.VALIDATOR_UPDATE_RETRY_DELAY_MS || '5000'); // 5 seconds

        // Initialize the client with environment-based configuration
        this.babylonClient = BabylonClient.getInstance();
        const network = this.babylonClient.getNetwork();
        logger.info(`[ValidatorInfo] ${network} client initialized successfully from environment configuration`);

        if (!this.babylonClient) {
            throw new Error('[ValidatorInfo] BabylonClient initialization failed. Please check your network configuration.');
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
        try {
            // Initial update with retries
            await this.retryUpdate();
            this.isInitialized = true;

            // Schedule periodic updates
            setInterval(() => {
                // Store the update promise
                this.updatePromise = this.retryUpdate().catch((error: Error) => {
                    logger.error('[ValidatorInfo] Periodic update failed:', error);
                });
            }, this.updateInterval);
        } catch (error) {
            logger.error('[ValidatorInfo] Initial update failed:', error);
            throw error;
        }
    }

    private async retryUpdate(): Promise<void> {
        let retryCount = 0;
        let success = false;

        while (!success && retryCount < this.maxRetries) {
            try {
                await this.updateAllValidators();
                success = true;
                if (retryCount > 0) {
                    logger.info(`[ValidatorInfo] Successfully updated after ${retryCount + 1} attempts`);
                }
            } catch (error) {
                retryCount++;
                logger.error(`[ValidatorInfo] Update attempt ${retryCount}/${this.maxRetries} failed:`, error);
                
                if (retryCount < this.maxRetries) {
                    logger.info(`[ValidatorInfo] Retrying in ${this.retryDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                }
            }
        }

        if (!success) {
            logger.error(`[ValidatorInfo] Failed to update validators after ${this.maxRetries} attempts`);
        }
    }

    private async updateAllValidators(): Promise<void> {
        try {
            // Update for current network
            await this.fetchAndUpdateValidators();
        } catch (error) {
            logger.error('[ValidatorInfo] Error updating validators:', error);
        }
    }

    private async fetchAndUpdateValidators(): Promise<void> {
        try {
            const network = this.babylonClient.getNetwork();
            const baseUrl = this.babylonClient.getBaseUrl();
            logger.info(`[ValidatorInfo] Fetching validators from ${network} using base URL: ${baseUrl}`);

            // Fetch validators from Tendermint API
            const tmResponse = await axios.get(`${this.babylonClient.getRpcUrl()}/validators?page=1&per_page=500`);
            const tmValidators = tmResponse.data.result.validators;
            logger.info(`[ValidatorInfo] Found ${tmValidators.length} validators from Tendermint API`);

            // Create a map of tendermint validators by address
            const tmValidatorMap = new Map();
            for (const validator of tmValidators) {
                // Store both uppercase and original format
                tmValidatorMap.set(validator.address.toUpperCase(), validator);
                tmValidatorMap.set(validator.address, validator);
            }

            // Fetch all active validators from App API
            const cosmosResponse = await axios.get(`${baseUrl}/cosmos/staking/v1beta1/validators?pagination.limit=500`);
            const cosmosValidators = cosmosResponse.data.validators;
            logger.info(`[ValidatorInfo] Found ${cosmosValidators.length} validators from Cosmos API`);

            // Process each validator
            let updateCount = 0;
            let activeValidatorsWithPower = 0;
            for (const validator of cosmosValidators) {
                try {
                    // Get consensus key and convert to hex address and valcons address
                    const consensusHexAddress = this.getConsensusHexAddress(validator.consensus_pubkey.key);
                    const valconsAddress = this.getValconsAddress(validator.consensus_pubkey.key, network);
                    const accountAddress = this.getAccountAddressFromValoper(validator.operator_address);

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
                            valcons_address: valconsAddress,
                            network
                        },
                        {
                            hex_address: consensusHexAddress,
                            valcons_address: valconsAddress,
                            consensus_pubkey: validator.consensus_pubkey.key,
                            valoper_address: validator.operator_address,
                            account_address: accountAddress,
                            moniker: validator.description.moniker,
                            identity: validator.description.identity,
                            logo_url: await getKeybaseLogo(validator.description.identity),
                            website: validator.description.website,
                            details: validator.description.details,
                            active: validator.status === 'BOND_STATUS_BONDED',
                            voting_power: votingPower,
                            last_seen: new Date()
                        },
                        { upsert: true, new: true }
                    );

                    // After updating validator info, try to match with finality providers
                    await this.matchValidatorWithFinalityProviders(validator);

                    updateCount++;
                } catch (error: any) {
                    logger.error(`[ValidatorInfo] Error processing validator:`, {
                        moniker: validator.description?.moniker,
                        error: error.message || String(error)
                    });
                }
            }

            const networkName = this.babylonClient.getNetwork();
            logger.info(`[ValidatorInfo] Update summary: total_validators: ${cosmosValidators.length}, updated_count: ${updateCount}, active_validators_with_power: ${activeValidatorsWithPower}, total_tendermint_validators: ${tmValidators.length}`);
        } catch (error) {
            logger.error('[ValidatorInfo] Error fetching validators:', error);
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
            logger.error('[ValidatorInfo] Error converting consensus pubkey to hex address:', error);
            throw error;
        }
    }

    private getValconsAddress(consensusPubkey: string, network: Network): string {
        try {
            const hexAddress = this.getConsensusHexAddress(consensusPubkey);
            const prefix = 'bbnvalcons';
            
            // Convert hex to Buffer
            const addressBytes = Buffer.from(hexAddress, 'hex');
            
            // Bech32 encode
            const words = bech32.toWords(Buffer.from(addressBytes));
            const valconsAddress = bech32.encode(prefix, words);

            return valconsAddress;
        } catch (error) {
            logger.error('[ValidatorInfo] Error converting to valcons address:', error);
            throw error;
        }
    }

    public async updateValidatorInfo(validatorData: any, network: Network): Promise<void> {
        try {
            const consensusHexAddress = this.getConsensusHexAddress(validatorData.consensus_pubkey);
            const valconsAddress = this.getValconsAddress(validatorData.consensus_pubkey, network);
            const logoUrl = await getKeybaseLogo(validatorData.description.identity);

            await ValidatorInfo.findOneAndUpdate(
                {
                    valcons_address: valconsAddress,
                    network
                },
                {
                    hex_address: consensusHexAddress,
                    valcons_address: valconsAddress,
                    consensus_pubkey: validatorData.consensus_pubkey,
                    valoper_address: validatorData.operator_address,
                    moniker: validatorData.description.moniker,
                    identity: validatorData.description.identity,
                    logo_url: logoUrl,
                    website: validatorData.description.website,
                    details: validatorData.description.details,
                    active: validatorData.status === 'BOND_STATUS_BONDED',
                    voting_power: validatorData.voting_power || '0',
                    last_seen: new Date()
                },
                { upsert: true, new: true }
            );
        } catch (error) {
            logger.error('[ValidatorInfo] Error updating validator info:', error);
            throw error;
        }
    }

    public async getValidatorByHexAddress(hexAddress: string): Promise<any> {
        try {
            const network = this.babylonClient.getNetwork();
            return await ValidatorInfo.findOne({
                hex_address: hexAddress,
                network
            });
        } catch (error) {
            logger.error('[ValidatorInfo] Error getting validator by hex address:', error);
            throw error;
        }
    }

    public async getValidatorByConsensusAddress(valconsAddress: string): Promise<any> {
        try {
            const network = this.babylonClient.getNetwork();
            return await ValidatorInfo.findOne({
                valcons_address: valconsAddress,
                network
            });
        } catch (error) {
            logger.error('[ValidatorInfo] Error getting validator by consensus address:', error);
            throw error;
        }
    }

    public async getValidatorByValoperAddress(valoperAddress: string): Promise<any> {
        try {
            const network = this.babylonClient.getNetwork();
            return await ValidatorInfo.findOne({
                valoper_address: valoperAddress,
                network
            });
        } catch (error) {
            logger.error('[ValidatorInfo] Error getting validator by valoper address:', error);
            throw error;
        }
    }

    public async getValidatorByAccountAddress(accountAddress: string, network: Network): Promise<any> {
        try {
            return await ValidatorInfo.findOne({
                account_address: accountAddress,
                network
            });
        } catch (error) {
            logger.error('[ValidatorInfo] Error getting validator by account address:', error);
            throw error;
        }
    }

    public getBabylonClient(): BabylonClient {
        return this.babylonClient;
    }

    private async matchValidatorWithFinalityProviders(validator: any): Promise<void> {
        try {
            // Get all active finality providers
            const finalityProviderService = FinalityProviderService.getInstance();
            const network = this.babylonClient.getNetwork();
            const providers = await finalityProviderService.getAllFinalityProviders();

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

            const valconsAddress = this.getValconsAddress(validator.consensus_pubkey.key, network);

            // Update validator info with match results
            await ValidatorInfo.findOneAndUpdate(
                {
                    valcons_address: valconsAddress,
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
            logger.error('[ValidatorInfo] Error matching validator with finality providers:', error);
        }
    }

    public async waitForInitialization(): Promise<void> {
        if (this.isInitialized) return;
        
        // Wait for up to 30 seconds
        for (let i = 0; i < 30; i++) {
            if (this.isInitialized) return;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error('ValidatorInfo service initialization timeout');
    }

    public async waitForNextUpdate(): Promise<void> {
        if (this.updatePromise) {
            await this.updatePromise;
        }
    }

    public async getAllValidators(
        network: Network, 
        showInactive: boolean = false,
        page: number = 1,
        limit: number = 100
    ): Promise<{ validators: any[], total: number }> {
        try {
            const query: any = { 
                network,
                active: !showInactive
            };

            // Limit control
            const validLimit = Math.min(Math.max(1, limit), 100);
            const skip = (Math.max(1, page) - 1) * validLimit;

            // Get total record count
            const total = await ValidatorInfo.countDocuments(query);

            // Get validators
            const validators = await ValidatorInfo.find(query)
                .sort({ voting_power: -1, moniker: 1 })
                .skip(skip)
                .limit(validLimit)
                .lean();

            return {
                validators,
                total
            };
        } catch (error) {
            logger.error('[ValidatorInfo] Error getting all validators:', error);
            throw error;
        }
    }

    private getAccountAddressFromValoper(valoperAddress: string): string {
        try {
            // Decode the valoper address
            const decoded = bech32.decode(valoperAddress);
            // Re-encode with 'bbn' prefix
            return bech32.encode('bbn', decoded.words);
        } catch (error) {
            logger.error('[ValidatorInfo] Error converting valoper to account address:', error);
            throw error;
        }
    }

    public async getValidatorById(id: string, network?: Network): Promise<any> {
        try {
            if (!mongoose.Types.ObjectId.isValid(id)) {
                throw new Error('Invalid validator ID format');
            }
            
            const query: any = { _id: id };
            
            // Add network filter if provided
            if (network) {
                query.network = network;
            }
            
            return await ValidatorInfo.findOne(query);
        } catch (error) {
            logger.error('[ValidatorInfo] Error getting validator by ID:', error);
            throw error;
        }
    }
} 