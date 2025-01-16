import compression from 'compression';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';

dotenv.config();

// CORS middleware
const getAllowedOrigins = () => {
  if (process.env.NODE_ENV === 'production') {
    return process.env.ALLOWED_ORIGINS?.split(',') || [];
  }
  return '*';
};

export const corsMiddleware = cors({
  origin: getAllowedOrigins(),
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'Origin'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
});

// Compression middleware
export const compressionMiddleware = compression();

// Rate limiting middleware
export const rateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 200 // limit each IP to 100 requests per windowMs
});

// Pagination middleware
export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  order?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  metadata: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
  timestamp: number;
}

export const paginationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const sortBy = (req.query.sortBy as string) || 'totalStake';
  const order = ((req.query.order as string)?.toLowerCase() === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';
  const skip = (page - 1) * limit;

  req.pagination = {
    page,
    limit,
    sortBy,
    order,
    skip
  };

  next();
};

// Helper function to format paginated response
export const formatPaginatedResponse = <T>(
  data: T[],
  totalItems: number,
  page: number,
  limit: number
): PaginatedResponse<T> => {
  return {
    data,
    metadata: {
      currentPage: page,
      totalPages: Math.ceil(totalItems / limit),
      totalItems,
      itemsPerPage: limit
    },
    timestamp: Date.now()
  };
};
