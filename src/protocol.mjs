import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, normalize, relative, resolve } from "node:path";
import { Readable } from "node:stream";

const MIME = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".webp", "image/webp"], [".svg", "image/svg+xml"], [".ttf", "font/ttf"],
  [".woff2", "font/woff2"], [".ogg", "audio/ogg"], [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"], [".webmanifest", "application/manifest+json"],
]);

export function resolveGameRequest(gameRoot, requestUrl) {
  const url = new URL(requestUrl);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const target = resolve(gameRoot, `.${normalize(pathname)}`);
  const rel = relative(resolve(gameRoot), target);
  if (rel.startsWith("..") || rel.includes(`..${process.platform === "win32" ? "\\" : "/"}`)) return null;
  if (!existsSync(target) || !statSync(target).isFile()) return null;
  return target;
}

export function registerGameProtocol(protocol, gameRoot) {
  protocol.handle("app", request => {
    if (new URL(request.url).host !== "game") return new Response("Not found", { status: 404 });
    const file = resolveGameRequest(gameRoot, request.url);
    if (!file) return new Response("Not found", { status: 404 });
    const body = Readable.toWeb(createReadStream(file));
    return new Response(body, {
      headers: {
        "content-type": MIME.get(extname(file).toLowerCase()) ?? "application/octet-stream",
        "content-security-policy": "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none';",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
