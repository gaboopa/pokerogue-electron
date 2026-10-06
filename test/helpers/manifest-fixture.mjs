export function manifestFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    version: "0.1.3",
    sourceRevisions: { game: "game", assets: "assets", locales: "locales" },
    artifacts: [],
    ...overrides,
  };
}
