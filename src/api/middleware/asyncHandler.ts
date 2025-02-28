import { Request, Response, NextFunction } from 'express';

/**
 * Async handler wrapper for express route handlers
 * Eliminates the need for try/catch blocks in route handlers
 * @param fn Express route handler function
 */
export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
}; 