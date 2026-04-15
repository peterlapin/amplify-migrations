import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * amplify_outputs.json is extensible via `backend.addOutput()`. We write
 * migration metadata under `custom.amplifyMigrations`.
 */
const OutputsSchema = z
  .object({
    auth: z
      .object({
        aws_region: z.string().optional(),
      })
      .passthrough()
      .optional(),
    data: z
      .object({
        aws_region: z.string().optional(),
        url: z.string().optional(),
      })
      .passthrough()
      .optional(),
    custom: z
      .object({
        amplifyMigrations: z
          .object({
            stateTable: z.string(),
            tables: z.record(z.string()).optional(),
            version: z.string().optional(),
          })
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type AmplifyOutputs = z.infer<typeof OutputsSchema>;

export async function readAmplifyOutputs(path: string): Promise<AmplifyOutputs> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  return OutputsSchema.parse(parsed);
}
