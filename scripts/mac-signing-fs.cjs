// The signing scanner opens thousands of game assets concurrently.
require("graceful-fs").gracefulify(require("node:fs"));
