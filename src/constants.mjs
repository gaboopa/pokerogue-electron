export const PRODUCT_NAME = "PokeRogue Offline";
export const APP_ORIGIN = "app://game";
export const AUTOMATIC_BACKUPS_KEPT = 5;
export const BACKUP_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export const UPDATE_REPOSITORY = process.env.POKEROGUE_UPDATE_REPOSITORY ?? "gaboopa/pokerogue-electron";
export const ALLOWED_UPDATE_HOSTS = new Set([
  "api.github.com",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
