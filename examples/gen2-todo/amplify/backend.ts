import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineBackend } from '@aws-amplify/backend';
import { withMigrations } from '@lapinsoft/data-migrations-cdk';
import { RemovalPolicy } from 'aws-cdk-lib';
import { auth } from './auth/resource.js';
import { data } from './data/resource.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const backend = defineBackend({ auth, data });

withMigrations(backend, {
  migrationsDir: resolve(__dirname, 'migrations'),
  // For sandbox runs it's fine to let the internal state table disappear
  // when you `ampx sandbox delete`. Omit or flip to RETAIN for prod.
  stateTableRemovalPolicy: RemovalPolicy.DESTROY,
  runOnDeploy: 'pending',
});
