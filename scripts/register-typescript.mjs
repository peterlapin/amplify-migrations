import { register } from 'node:module';

// Resolve the hook to a file URL before Node registers it in isolated workers.
// SWC's convenience preload passes a directory URL that its own resolver
// treats as a file when Node 24 registers the hook again in a test worker.
register(import.meta.resolve('@swc-node/register/esm'), import.meta.url);
