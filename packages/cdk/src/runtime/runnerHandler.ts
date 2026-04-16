import { Runner } from '@amplify-migrations/core';

interface CfnCustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  PhysicalResourceId?: string;
  LogicalResourceId?: string;
  ResourceProperties?: Record<string, unknown>;
}

interface CfnCustomResourceResponse {
  PhysicalResourceId: string;
  Data?: Record<string, unknown>;
}

/**
 * Lambda entrypoint invoked by the CustomResource on every Amplify deploy.
 * Reads configuration from env vars set by `withMigrations()`.
 *
 * Important: the handler branches on `RequestType` so that stack teardown
 * (Delete) does NOT attempt to execute migrations against tables that may
 * already be gone.
 */
export const handler = async (
  event: CfnCustomResourceEvent,
): Promise<CfnCustomResourceResponse> => {
  const physicalId = event.PhysicalResourceId ?? 'amplify-migrations';

  if (event.RequestType === 'Delete') {
    return { PhysicalResourceId: physicalId, Data: { skipped: 'delete' } };
  }

  const mode = process.env.AM_RUN_MODE ?? 'pending';
  const migrationsDir = process.env.AM_MIGRATIONS_DIR ?? '/var/task/migrations';
  const stateTable = process.env.AM_STATE_TABLE;
  const tables = JSON.parse(process.env.AM_TABLES_JSON ?? '{}') as Record<string, string>;
  if (!stateTable) throw new Error('AM_STATE_TABLE is required');

  if (mode === 'off') {
    return { PhysicalResourceId: physicalId, Data: { skipped: 'off' } };
  }

  const checksumPolicy = (process.env.AM_CHECKSUM_POLICY ?? 'off') as 'off' | 'warn' | 'strict';
  const runner = await Runner.create({ migrationsDir, stateTable, tables, checksumPolicy });
  const res = await runner.up();
  return {
    PhysicalResourceId: physicalId,
    Data: { appliedCount: res.applied.length },
  };
};
