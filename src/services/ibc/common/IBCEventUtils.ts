import { logger } from '../../../utils/logger';

/**
 * Common utilities for IBC event processing
 * Eliminates code duplication across IBC services
 */
export class IBCEventUtils {
    /**
     * Extract event attributes from an IBC event
     * Converts array of key/value attributes to a record for easier access
     * @param event IBC event object
     * @returns Record of attribute key-value pairs
     */
    public static extractEventAttributes(event: any): Record<string, string> {
        const attributes: Record<string, string> = {};
        
        if (!event?.attributes || !Array.isArray(event.attributes)) {
            return attributes;
        }
        
        for (const attr of event.attributes) {
            if (attr?.key && attr?.value !== undefined) {
                attributes[attr.key] = attr.value;
            }
        }
        
        return attributes;
    }
    
    /**
     * Validate required attributes for an event
     * @param attributes Event attributes
     * @param requiredKeys Required attribute keys
     * @param eventType Event type for logging
     * @returns true if all required attributes are present
     */
    public static validateRequiredAttributes(
        attributes: Record<string, string>,
        requiredKeys: string[],
        eventType: string
    ): boolean {
        const missingKeys = requiredKeys.filter(key => !attributes[key]);
        
        if (missingKeys.length > 0) {
            logger.warn(`[IBCEventUtils] Missing required attributes for ${eventType}: ${missingKeys.join(', ')}`);
            return false;
        }
        
        return true;
    }
    
    /**
     * Log event processing start
     * @param serviceName Name of the service processing the event
     * @param eventType Type of the event
     * @param txHash Transaction hash
     */
    public static logEventStart(serviceName: string, eventType: string, txHash: string): void {
        logger.debug(`[${serviceName}] Processing ${eventType} event in tx ${txHash}`);
    }
    
    /**
     * Log event processing success
     * @param serviceName Name of the service
     * @param eventType Type of the event
     * @param description Success description
     * @param height Block height
     */
    public static logEventSuccess(
        serviceName: string, 
        eventType: string, 
        description: string,
        height?: number
    ): void {
        const heightInfo = height ? ` at height ${height}` : '';
        logger.info(`[${serviceName}] ${description}${heightInfo}`);
    }
    
    /**
     * Log event processing error
     * @param serviceName Name of the service
     * @param eventType Type of the event
     * @param error Error that occurred
     */
    public static logEventError(serviceName: string, eventType: string, error: unknown): void {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`[${serviceName}] Error processing ${eventType}: ${errorMessage}`);
    }
    
    /**
     * Check if an event is of a specific type
     * @param event Event object
     * @param eventTypes Array of event types to check
     * @returns true if event type matches any of the provided types
     */
    public static isEventType(event: any, eventTypes: string[]): boolean {
        return event?.type && eventTypes.includes(event.type);
    }
} 