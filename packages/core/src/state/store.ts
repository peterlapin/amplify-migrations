import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { MigrationRecord } from "../types.js";

const LOCK_NAME = "__lock__";

export interface LockHandle {
  holder: string;
  expiresAt: number;
}

/**
 * Persists migration history + advisory run-lock in a single DynamoDB table
 * whose primary key is `name` (string). This table is declared as an Amplify
 * model (`AmplifyMigration`) by the user or by the CDK construct.
 */
export class StateStore {
  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async acquireLock(holder: string, ttlSeconds: number): Promise<LockHandle> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttlSeconds;
    try {
      await this.ddb.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { name: LOCK_NAME, holder, expiresAt },
          ConditionExpression:
            "attribute_not_exists(#n) OR #e < :now",
          ExpressionAttributeNames: { "#n": "name", "#e": "expiresAt" },
          ExpressionAttributeValues: { ":now": now },
        }),
      );
      return { holder, expiresAt };
    } catch (err) {
      if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
        throw new Error(
          `Could not acquire migration lock on "${this.tableName}". Another run is in progress.`,
        );
      }
      throw err;
    }
  }

  async releaseLock(holder: string): Promise<void> {
    try {
      await this.ddb.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { name: LOCK_NAME },
          ConditionExpression: "#h = :h",
          ExpressionAttributeNames: { "#h": "holder" },
          ExpressionAttributeValues: { ":h": holder },
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
      // Someone else owns the lock now (ours expired). Leave it.
    }
  }

  async renewLock(holder: string, ttlSeconds: number): Promise<void> {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { name: LOCK_NAME },
        UpdateExpression: "SET #e = :e",
        ConditionExpression: "#h = :h",
        ExpressionAttributeNames: { "#e": "expiresAt", "#h": "holder" },
        ExpressionAttributeValues: { ":e": expiresAt, ":h": holder },
      }),
    );
  }

  /**
   * Returns the ordered list of migrations that are currently "applied" —
   * i.e. the last recorded direction per name is "up". Down migrations
   * cancel out prior ups.
   */
  async listApplied(): Promise<MigrationRecord[]> {
    const items: MigrationRecord[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const out = await this.ddb.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: "#n <> :lock",
          ExpressionAttributeNames: { "#n": "name" },
          ExpressionAttributeValues: { ":lock": LOCK_NAME },
          ExclusiveStartKey,
        }),
      );
      for (const it of out.Items ?? []) items.push(it as MigrationRecord);
      ExclusiveStartKey = out.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    // Collapse history: keep only migrations whose latest record is "up"
    const latest = new Map<string, MigrationRecord>();
    for (const r of items) {
      const mname = r.migrationName ?? r.name;
      const prev = latest.get(mname);
      if (!prev || prev.appliedAt < r.appliedAt) latest.set(mname, { ...r, migrationName: mname });
    }
    const applied: MigrationRecord[] = [];
    for (const r of latest.values()) if (r.direction === "up") applied.push(r);
    applied.sort((a, b) => (a.migrationName ?? a.name).localeCompare(b.migrationName ?? b.name));
    return applied;
  }

  async nextBatch(): Promise<number> {
    const items = await this.listApplied();
    let max = 0;
    for (const r of items) if (r.batch > max) max = r.batch;
    return max + 1;
  }

  async record(record: MigrationRecord): Promise<void> {
    // Each apply is a distinct item keyed by `<name>#<direction>#<appliedAt>`
    // so we preserve history even after down/up cycles.
    const key = `${record.name}#${record.direction}#${record.appliedAt}`;
    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { ...record, name: key, migrationName: record.name },
        ConditionExpression: "attribute_not_exists(#n)",
        ExpressionAttributeNames: { "#n": "name" },
      }),
    );
  }

  async historyFor(name: string): Promise<MigrationRecord[]> {
    // Fallback to scan with filter — keeps the state table schema single-key
    // and avoids requiring a GSI for the lib to work out-of-the-box.
    const out = await this.ddb.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "migrationName = :mn",
        ExpressionAttributeValues: { ":mn": name },
      }),
    );
    return ((out.Items ?? []) as MigrationRecord[]).sort((a, b) =>
      a.appliedAt.localeCompare(b.appliedAt),
    );
  }

  // Exposed so callers can choose between scan (default) and query if they
  // add a GSI on migrationName.
  async queryByMigrationName(name: string, gsiName: string): Promise<MigrationRecord[]> {
    const out = await this.ddb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: gsiName,
        KeyConditionExpression: "migrationName = :mn",
        ExpressionAttributeValues: { ":mn": name },
      }),
    );
    return (out.Items ?? []) as MigrationRecord[];
  }
}
