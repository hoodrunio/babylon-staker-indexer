import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// Extend Winston logger type
interface ExtendedLogger extends winston.Logger {
    logError: (error: any, context?: string, additionalData?: Record<string, any>) => void;
}

// Metadata cleaning and formatting function
const cleanMetadata = (obj: any, visited = new WeakSet()): any => {
    // Handle null, undefined, or primitive values
    if (obj === undefined || obj === null) {
        return obj;
    }
    
    if (typeof obj !== 'object') {
        return obj;
    }
    
    // Detect circular references
    if (visited.has(obj)) {
        return '[Circular Reference]';
    }
    
    // Add current object to visited set
    visited.add(obj);

    // Special formatting for subscription messages
    if (obj.jsonrpc === '2.0' && obj.id && obj.result !== undefined) {
        return `${obj.id}`;
    }

    // If all keys are numeric and sequential, join as string
    const keys = Object.keys(obj);
    const isSequential = keys.length > 0 && keys.every((key, index) => Number(key) === index);
    if (isSequential && keys.length > 0 && typeof obj[0] === 'string') {
        return keys.map(k => obj[k]).join('');
    }

    // Clean empty objects
    if (Object.keys(obj).length === 0) {
        return undefined;
    }

    // Clean entire object recursively
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
        try {
            const cleanedValue = cleanMetadata(value, visited);
            if (cleanedValue !== undefined) {
                cleaned[key] = cleanedValue;
            }
        } catch (err) {
            // If there's an error processing a property, skip it but don't crash
            cleaned[key] = '[Error processing value]';
        }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

// Type guard for checking if object is an Error
function isError(obj: any): obj is Error {
    return obj instanceof Error;
}

// Message formatting function
const formatMessage = (message: any, metadata: Record<string, any>): string => {
    // Check if message is undefined or null
    if (message === undefined || message === null) {
        return String(message || '');
    }
    
    // If message is an Error object, extract the error details
    if (isError(message)) {
        return `${message.name}: ${message.message}${message.stack ? `\n${message.stack}` : ''}`;
    }
    
    // Handle string messages
    if (typeof message === 'string') {
        // Special formatting for subscription messages
        if (message.includes('subscription confirmed')) {
            const subscriptionId = cleanMetadata(metadata, new WeakSet());
            return typeof subscriptionId === 'string' ? `Subscription confirmed: ${subscriptionId}` : message;
        }
        return message;
    }
    
    // Check if the message is an error-like object with message property
    if (typeof message === 'object' && 'message' in message) {
        const errMsg = (message as {message: string}).message;
        return `Error: ${errMsg}`;
    }
    
    // If message is an object, convert to string
    if (typeof message === 'object') {
        try {
            return JSON.stringify(message);
        } catch (e) {
            return String(message);
        }
    }
    
    return String(message);
};

// Improve error handling in the printf format
const enhancedPrintFormat = (info: any) => {
    // Debug logger format information if needed
    // console.log('INFO OBJECT:', JSON.stringify(info));
    
    const { level, message, timestamp, stack, error, ...metadata } = info;
    
    // Ensure level is a string
    const safeLevel = typeof level === 'string' ? level.toUpperCase().padEnd(7) : 'INFO   ';
    // Ensure timestamp exists
    const safeTimestamp = timestamp || new Date().toISOString();
    
    // Handle error objects directly
    let safeMessage: any = '';
    let errorStack = stack;
    
    if (isError(error)) {
        // Prioritize Error objects passed directly
        safeMessage = `${error.name}: ${error.message}`;
        errorStack = errorStack || error.stack;
    } else if (isError(message)) {
        // Handle when message is an Error object
        safeMessage = `${message.name}: ${message.message}`;
        errorStack = errorStack || message.stack;
    } else if (typeof message === 'object' && message !== null && 'message' in message) {
        // Handle error-like objects
        safeMessage = `Error: ${(message as {message: string}).message}`;
        errorStack = errorStack || (message as any).stack;
    } else {
        // Default case for regular messages
        safeMessage = message;
    }
    
    // Main message format - Ensure timestamp and level are always included
    let log = `${safeTimestamp} ${safeLevel}: ${formatMessage(safeMessage, metadata)}`;
    
    // Metadata exists, clean and add
    const { ...restMetadata } = metadata || {};
    const cleanedMetadata = cleanMetadata(restMetadata, new WeakSet());
    if (cleanedMetadata && Object.keys(cleanedMetadata).length > 0) {
        log += `\n${JSON.stringify(cleanedMetadata, null, 2)}`;
    }
    
    // Stack trace exists, add
    if (errorStack) {
        log += `\n${errorStack}`;
    }
    
    return log;
};

// Create a simple format override to help debug the logger
// const debugFormat = winston.format.printf(info => {
//     return `DEBUGFORMAT ${new Date().toISOString()} [${info.level.toUpperCase()}]: ${info.message}`;
// });

// Create custom format with enhanced error handling
const customFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf(enhancedPrintFormat)
);

// Colored console format for development with enhanced error handling
// const consoleFormat = winston.format.combine(
//     winston.format.timestamp({
//         format: 'YYYY-MM-DD HH:mm:ss.SSS'
//     }),
//     winston.format.errors({ stack: true }),
//     winston.format.splat(),
//     winston.format.colorize({ all: true }),
//     winston.format.printf(enhancedPrintFormat)
// );

// Define custom levels and colors
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    trace: 6
};

// Custom colors
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    verbose: 'cyan',
    debug: 'blue',
    trace: 'gray'
};

// Set Winston color scheme
winston.addColors(colors);

// Create logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    levels,
    defaultMeta: { 
        service: 'babylon-staker-indexer',
        environment: process.env.NODE_ENV || 'development'
    },
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss.SSS'
        }),
        winston.format.errors({ stack: true })
    ),
    transports: [
        // Write to stdout/stderr with appropriate format based on environment
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss.SSS'
                }),
                winston.format.colorize({ all: true }),
                winston.format.printf(info => {
                    const { level, message, timestamp } = info;
                    return `${timestamp} ${level.padEnd(7)}: ${message}`;
                })
            ),
            handleExceptions: true,
            handleRejections: true
        }),
        
        // Rotating file transport for errors
        new DailyRotateFile({
            filename: 'logs/error-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxFiles: '14d',
            maxSize: '20m',
            zippedArchive: true,
            format: customFormat,
            // Add error handling for the transport
            handleExceptions: true,
            handleRejections: true
        }),
        
        // Rotating file transport for all logs
        new DailyRotateFile({
            filename: 'logs/combined-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxFiles: '14d',
            maxSize: '20m',
            zippedArchive: true,
            format: customFormat
        })
    ],
    // Add global error handling
    exitOnError: false // Do not exit on handled exceptions
}) as ExtendedLogger;

// Uncaught exception and unhandled rejection handlers
logger.exceptions.handle(
    new DailyRotateFile({
        filename: 'logs/exceptions-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxFiles: '14d',
        maxSize: '20m',
        zippedArchive: true,
        format: customFormat
    })
);

logger.rejections.handle(
    new DailyRotateFile({
        filename: 'logs/rejections-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxFiles: '14d',
        maxSize: '20m',
        zippedArchive: true,
        format: customFormat
    })
);

// Enhanced error logging helper
const logError = (error: any, context: string = '', additionalData: Record<string, any> = {}) => {
    // Determine error information
    let errorMessage: string;
    let errorStack: string | undefined;
    let errorName: string = 'Error';
    
    if (isError(error)) {
        errorName = error.name;
        errorMessage = error.message;
        errorStack = error.stack;
    } else if (typeof error === 'object' && error && 'message' in error) {
        errorName = (error as any).name || 'Error';
        errorMessage = String((error as any).message);
        errorStack = (error as any).stack;
    } else if (typeof error === 'string') {
        errorMessage = error;
    } else {
        try {
            errorMessage = JSON.stringify(error);
        } catch (e) {
            errorMessage = String(error);
        }
    }

    // Build a more comprehensive error object
    const errorData = {
        error_name: errorName,
        error_message: errorMessage,
        context,
        ...additionalData
    };
    
    // Log error with full context
    logger.error(`${context ? context + ': ' : ''}${errorName}: ${errorMessage}`, {
        error: errorData,
        stack: errorStack
    });
};

// Add logError to the logger
logger.logError = logError;

export { logger, ExtendedLogger }; 