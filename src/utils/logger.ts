import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// Metadata cleaning and formatting function
const cleanMetadata = (obj: any): any => {
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }

    // Special formatting for subscription messages
    if (obj.jsonrpc === '2.0' && obj.id && obj.result !== undefined) {
        return `${obj.id}`;
    }

    // If all keys are numeric and sequential, join as string
    const keys = Object.keys(obj);
    const isSequential = keys.every((key, index) => Number(key) === index);
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
        const cleanedValue = cleanMetadata(value);
        if (cleanedValue !== undefined) {
            cleaned[key] = cleanedValue;
        }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

// Message formatting function
const formatMessage = (message: string, metadata: Record<string, any>): string => {
    // Special formatting for subscription messages
    if (message.includes('subscription confirmed')) {
        const subscriptionId = cleanMetadata(metadata);
        return typeof subscriptionId === 'string' ? `Subscription confirmed: ${subscriptionId}` : message;
    }
    return message;
};

// Create custom format
const customFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf(({ level, message, timestamp, stack, ...metadata }) => {
        // Main message format
        let log = `${timestamp} ${level.toUpperCase().padEnd(7)}: ${formatMessage(message as string, metadata)}`;
        
        // Metadata exists, clean and add
        const { service, environment, ...restMetadata } = metadata;
        const cleanedMetadata = cleanMetadata(restMetadata);
        if (cleanedMetadata && Object.keys(cleanedMetadata).length > 0) {
            log += `\n${JSON.stringify(cleanedMetadata, null, 2)}`;
        }
        
        // Stack trace exists, add
        if (stack) {
            log += `\n${stack}`;
        }
        
        return log;
    })
);

// Colored console format for development
const consoleFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ level, message, timestamp, stack, ...metadata }) => {
        // Main message format
        let log = `${timestamp} ${level.padEnd(7)}: ${formatMessage(message as string, metadata)}`;
        
        // Metadata exists, clean and add
        const { service, environment, ...restMetadata } = metadata;
        const cleanedMetadata = cleanMetadata(restMetadata);
        if (cleanedMetadata && Object.keys(cleanedMetadata).length > 0) {
            log += `\n${JSON.stringify(cleanedMetadata, null, 2)}`;
        }
        
        // Stack trace exists, add
        if (stack) {
            log += `\n${stack}`;
        }
        
        return log;
    })
);

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
        environment: process.env.NODE_ENV 
    },
    transports: [
        // Rotating file transport for errors
        new DailyRotateFile({
            filename: 'logs/error-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxFiles: '14d',
            maxSize: '20m',
            zippedArchive: true,
            format: customFormat
        }),
        
        // Rotating file transport for all logs
        new DailyRotateFile({
            filename: 'logs/combined-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxFiles: '14d',
            maxSize: '20m',
            zippedArchive: true,
            format: customFormat
        }),

        // Write to stdout/stderr with appropriate format based on environment
        new winston.transports.Console({
            format: process.env.NODE_ENV === 'production' ? customFormat : consoleFormat,
            handleExceptions: true,
            handleRejections: true
        })
    ]
});

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

export { logger }; 