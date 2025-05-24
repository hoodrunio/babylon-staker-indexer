/**
 * Token Domain Model
 * Encapsulates all token-related information and behavior
 */

export interface TokenMetadata {
    readonly originalDenom: string;
    readonly baseDenom: string;
    readonly symbol: string;
    readonly decimals: number;
    readonly coingeckoId?: string;
    readonly description?: string;
    readonly isStable?: boolean;
}

export interface TokenPrice {
    readonly price: number;
    readonly lastUpdated: Date;
    readonly source: 'coingecko' | 'hardcoded' | 'fallback';
}

/**
 * Token Value Object
 * Immutable representation of a token with its complete information
 */
export class Token {
    private readonly _metadata: TokenMetadata;
    private readonly _price: TokenPrice | null;

    constructor(metadata: TokenMetadata, price: TokenPrice | null = null) {
        this._metadata = { ...metadata }; // Deep copy for immutability
        this._price = price ? { ...price } : null;
    }

    // Metadata getters
    get originalDenom(): string { return this._metadata.originalDenom; }
    get baseDenom(): string { return this._metadata.baseDenom; }
    get symbol(): string { return this._metadata.symbol; }
    get decimals(): number { return this._metadata.decimals; }
    get coingeckoId(): string | undefined { return this._metadata.coingeckoId; }
    get description(): string | undefined { return this._metadata.description; }
    get isStable(): boolean { return this._metadata.isStable || false; }

    // Price getters
    get price(): number { return this._price?.price || 0; }
    get priceLastUpdated(): Date | null { return this._price?.lastUpdated || null; }
    get priceSource(): string | null { return this._price?.source || null; }
    get hasPrice(): boolean { return this._price !== null && this._price.price > 0; }

    /**
     * Convert token amount to main unit (from smallest unit)
     */
    toMainUnit(amount: string | number): number {
        const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
        return numAmount / Math.pow(10, this.decimals);
    }

    /**
     * Convert token amount to USD value
     */
    toUsdValue(amount: string | number): number {
        if (!this.hasPrice) return 0;
        const mainUnitAmount = this.toMainUnit(amount);
        return mainUnitAmount * this.price;
    }

    /**
     * Format token amount for display
     */
    formatAmount(amount: string | number): string {
        const mainUnitAmount = this.toMainUnit(amount);
        return `${this.formatNumber(mainUnitAmount)} ${this.symbol}`;
    }

    /**
     * Format USD value for display
     */
    formatUsdValue(amount: string | number): string {
        const usdValue = this.toUsdValue(amount);
        return `$${this.formatNumber(usdValue, 2)}`;
    }

    /**
     * Create a new Token instance with updated price
     */
    withPrice(price: TokenPrice): Token {
        return new Token(this._metadata, price);
    }

    /**
     * Create a new Token instance with updated metadata
     */
    withMetadata(metadata: Partial<TokenMetadata>): Token {
        return new Token(
            { ...this._metadata, ...metadata },
            this._price
        );
    }

    /**
     * Check if price needs refresh (older than TTL)
     */
    isPriceStale(ttlMinutes: number = 5): boolean {
        if (!this._price) return true;
        const ageMinutes = (Date.now() - this._price.lastUpdated.getTime()) / (1000 * 60);
        return ageMinutes > ttlMinutes;
    }

    /**
     * Get display information for UI
     */
    getDisplayInfo(amount: string | number): {
        symbol: string;
        formattedAmount: string;
        usdValue: number;
        formattedUsdValue: string;
        hasPrice: boolean;
        priceAge?: string;
    } {
        return {
            symbol: this.symbol,
            formattedAmount: this.formatAmount(amount),
            usdValue: this.toUsdValue(amount),
            formattedUsdValue: this.formatUsdValue(amount),
            hasPrice: this.hasPrice,
            priceAge: this._price ? this.getAgeString() : undefined
        };
    }

    /**
     * Serialize to JSON for API responses
     */
    toJSON(): {
        metadata: TokenMetadata;
        price: TokenPrice | null;
        hasPrice: boolean;
    } {
        return {
            metadata: this._metadata,
            price: this._price,
            hasPrice: this.hasPrice
        };
    }

    private formatNumber(value: number, decimals: number = 6): string {
        if (value === 0) return '0';
        if (value < 0.01) return value.toExponential(2);
        return value.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: decimals
        });
    }

    private getAgeString(): string {
        if (!this._price) return 'No price';
        const ageMinutes = (Date.now() - this._price.lastUpdated.getTime()) / (1000 * 60);
        if (ageMinutes < 1) return 'Just now';
        if (ageMinutes < 60) return `${Math.floor(ageMinutes)}m ago`;
        const ageHours = ageMinutes / 60;
        if (ageHours < 24) return `${Math.floor(ageHours)}h ago`;
        const ageDays = ageHours / 24;
        return `${Math.floor(ageDays)}d ago`;
    }
}

/**
 * Token Amount Value Object
 * Represents a specific amount of a token
 */
export class TokenAmount {
    private readonly _token: Token;
    private readonly _amount: number;

    constructor(token: Token, amount: string | number) {
        this._token = token;
        this._amount = typeof amount === 'string' ? parseFloat(amount) : amount;
    }

    get token(): Token { return this._token; }
    get amount(): number { return this._amount; }
    get mainUnitAmount(): number { return this._token.toMainUnit(this._amount); }
    get usdValue(): number { return this._token.toUsdValue(this._amount); }

    /**
     * Add another TokenAmount (must be same token)
     */
    add(other: TokenAmount): TokenAmount {
        if (other._token.baseDenom !== this._token.baseDenom) {
            throw new Error('Cannot add amounts of different tokens');
        }
        return new TokenAmount(this._token, this._amount + other._amount);
    }

    /**
     * Format for display
     */
    format(): string {
        return this._token.formatAmount(this._amount);
    }

    /**
     * Format USD value for display
     */
    formatUsd(): string {
        return this._token.formatUsdValue(this._amount);
    }
} 