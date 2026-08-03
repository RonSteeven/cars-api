import { AppError } from '../shared/errors.js';

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;

/** Narrows an unknown `catch` binding to something with a readable message. */
export const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(typeof value === 'string' ? value : String(value));
