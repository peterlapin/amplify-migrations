import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Logger } from "pino";
import type {
  ItemOf,
  MigrationContext,
  ModelName,
  ScanOpts,
  SchemaShape,
  TransactOp,
} from "../types.js";
import { buildUpdateExpression } from "./updateExpression.js";

export interface ContextDeps<S extends SchemaShape> {
  ddb: DynamoDBDocumentClient;
  tables: Readonly<Record<ModelName<S>, string>>;
  logger: Logger;
  abortSignal?: AbortSignal;
}

export function createContext<S extends SchemaShape>(deps: ContextDeps<S>): MigrationContext<S> {
  const { ddb, tables, logger, abortSignal } = deps;

  // Build the options object once; with exactOptionalPropertyTypes we must omit
  // the property entirely rather than pass `undefined` when no signal is set.
  const sendOpts: { abortSignal?: AbortSignal } = abortSignal ? { abortSignal } : {};

  const tableFor = (model: string): string => {
    const t = (tables as Record<string, string>)[model];
    if (!t) throw new Error(`No table mapping for model "${model}"`);
    return t;
  };

  return {
    tables,
    raw: ddb,
    logger,
    ...(abortSignal ? { abortSignal } : {}),

    async get(model, key) {
      const out = await ddb.send(
        new GetCommand({ TableName: tableFor(model as string), Key: key }),
        sendOpts,
      );
      return out.Item as ItemOf<S, typeof model> | undefined;
    },

    async put(model, item) {
      await ddb.send(
        new PutCommand({ TableName: tableFor(model as string), Item: item }),
        sendOpts,
      );
    },

    async update(model, key, patch) {
      const built = buildUpdateExpression(patch);
      if (!built) return; // no-op on empty patch
      await ddb.send(
        new UpdateCommand({
          TableName: tableFor(model as string),
          Key: key,
          ...built,
        }),
        sendOpts,
      );
    },

    async delete(model, key) {
      await ddb.send(
        new DeleteCommand({ TableName: tableFor(model as string), Key: key }),
        sendOpts,
      );
    },

    async *scan(model, opts: ScanOpts = {}) {
      let ExclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const out = await ddb.send(
          new ScanCommand({
            TableName: tableFor(model as string),
            FilterExpression: opts.filterExpression,
            ExpressionAttributeNames: opts.expressionAttributeNames,
            ExpressionAttributeValues: opts.expressionAttributeValues,
            Limit: opts.limit,
            ExclusiveStartKey,
          }),
          sendOpts,
        );
        for (const item of out.Items ?? []) {
          yield item as ItemOf<S, typeof model>;
        }
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
    },

    async transact(ops: TransactOp[]) {
      if (ops.length === 0) return;
      if (ops.length > 100) {
        throw new Error(
          `transact: ${ops.length} ops exceeds DynamoDB TransactWriteItems limit of 100`,
        );
      }
      const TransactItems = [] as unknown[];
      for (const op of ops) {
        const TableName = tableFor(op.model);
        if (op.type === "put") {
          TransactItems.push({
            Put: {
              TableName,
              Item: op.item,
              ...(op.condition ? { ConditionExpression: op.condition } : {}),
            },
          });
        } else if (op.type === "delete") {
          TransactItems.push({
            Delete: {
              TableName,
              Key: op.key,
              ...(op.condition ? { ConditionExpression: op.condition } : {}),
            },
          });
        } else {
          const built = buildUpdateExpression(op.patch);
          if (!built) {
            throw new Error(
              `transact: update op for "${op.model}" has an empty patch. Remove the op or provide fields to change.`,
            );
          }
          TransactItems.push({ Update: { TableName, Key: op.key, ...built } });
        }
      }
      await ddb.send(new TransactWriteCommand({ TransactItems } as never), sendOpts);
    },
  };
}
