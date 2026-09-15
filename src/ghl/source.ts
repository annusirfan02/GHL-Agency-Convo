/**
 * Pre-configured GHL API client for the SOURCE subaccount (Agency 1).
 */
import { config } from '../config';
import { createGhlClient } from './client';

// Export the raw client so csvExporter can use it directly
export const sourceClient = createGhlClient(config.source.accessToken);
