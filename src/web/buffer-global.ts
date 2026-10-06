/* The services use Node's Buffer; the phone gets the same class from the 'buffer' package. */
import { Buffer } from 'buffer'

;(globalThis as { Buffer?: unknown }).Buffer ??= Buffer
