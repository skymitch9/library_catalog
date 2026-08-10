/**
 * Claude-backed research.
 *
 * The one place in this repo that spends money, kept in its own package so that
 * is obvious from an import line. Everything it returns is a *proposal*; nothing
 * here writes to the catalog.
 */

export * from './client.js';
export * from './details.js';
