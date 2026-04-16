// Frozen schema snapshot captured at the moment this migration was created.
// Do not rely on `../data/resource.ts` — it evolves; this file must not.
export type Schema = {
  models: {
    Todo: { identifier: readonly ['id'] };
  };
};
