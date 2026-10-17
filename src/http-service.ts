import type { Device } from "./model.ts";

export interface HTTPRequestOptions {
  port?:number;
  secure?:boolean;
  method?: "GET" | "HEAD" | "PUT" | "PATCH" | "POST" | "DELETE";
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
}
export type HTTPAuthenticator = (
  list: string,
  username: string,
  password: string,
) => {
  accepted: boolean;
  unavailable?: boolean;
  privilege?: number;
};

export function basicAuthorization(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return `Basic ${btoa(Array.from(bytes, (value) => String.fromCharCode(value)).join(""))}`;
}
function credentials(
  headers: unknown,
): { username: string; password: string } | undefined {
  if (!headers || typeof headers !== "object") return;
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === "authorization",
  );
  if (typeof entry?.[1] !== "string" || entry[1].length > 8192) return;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(entry[1]);
  if (!match) return;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0)),
    );
    const colon = decoded.indexOf(":");
    if (colon < 0) return;
    return {
      username: decoded.slice(0, colon),
      password: decoded.slice(colon + 1),
    };
  } catch {
    return;
  }
}
const mime: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
};
function contentType(path: string): string {
  return (
    mime[path.split(".").at(-1)?.toLowerCase() || ""] ||
    "text/plain; charset=utf-8"
  );
}

/** Original teaching HTTP service. Authentication and files exist only in the lab. */
export function handleHTTPRequest(
  device: Device,
  payload: any,
  authenticate?: HTTPAuthenticator,
): Record<string, any> {
  const service = device.config.services.http || {};
  const method = String(payload?.method || "GET").toUpperCase();
  const respond = (
    statusCode: number,
    content: string,
    type = "text/html; charset=utf-8",
    extra: Record<string, string> = {},
  ) => ({
    statusCode,
    content: method === "HEAD" ? "" : content,
    headers: {
      "Content-Type": type,
      "Content-Length": String(new TextEncoder().encode(content).byteLength),
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
  if (payload?.secure ? !service.secureEnabled : !service.enabled)
    return respond(503, "<h1>503 — Service unavailable</h1>");
  if (!["GET", "HEAD"].includes(method))
    return respond(405, "<h1>405 — Method not allowed</h1>", undefined, {
      Allow: "GET, HEAD",
    });
  const mode = service.authentication || "none";
  if (mode !== "none") {
    const supplied = credentials(payload?.headers);
    let accepted = false;
    if (supplied) {
      if (mode === "local") {
        const user = Object.hasOwn(
          device.config.features.users || {},
          supplied.username,
        )
          ? device.config.features.users[supplied.username]
          : undefined;
        const expected = user?.secret ?? user?.password;
        accepted =
          typeof expected === "string" &&
          expected.length > 0 &&
          supplied.password === expected;
      } else if (mode === "enable") {
        const expected =
          device.config.features.enableSecret ??
          device.config.features.enablePassword;
        accepted =
          typeof expected === "string" &&
          expected.length > 0 &&
          supplied.password === expected;
      } else if (mode === "aaa") {
        const result = authenticate?.(
          service.authenticationList || "default",
          supplied.username,
          supplied.password,
        );
        if (!result || result.unavailable)
          return respond(
            503,
            "<h1>503 — Authentication service unavailable</h1>",
          );
        accepted = result.accepted;
      }
    }
    if (!accepted) {
      const realm = String(service.realm || device.config.hostname)
        .replace(/["\\\r\n]/g, "")
        .slice(0, 128);
      return respond(401, "<h1>401 — Authentication required</h1>", undefined, {
        "WWW-Authenticate": `Basic realm="${realm}", charset="UTF-8"`,
      });
    }
  }
  let path: string;
  try {
    path = decodeURIComponent(String(payload?.path || "/").split("?")[0]);
  } catch {
    return respond(400, "<h1>400 — Invalid path</h1>");
  }
  if (
    !path.startsWith("/") ||
    /[\u0000-\u001f\\]/.test(path) ||
    path.split("/").includes("..")
  )
    return respond(403, "<h1>403 — Path not permitted</h1>");
  path = path.replace(/\/{2,}/g, "/");
  const files = service.files || {};
  let content: unknown = Object.hasOwn(files, path) ? files[path] : undefined;
  if (content === undefined && service.basePath) {
    const base = String(service.basePath)
      .replace(/^(?:flash|bootflash):\/?/, "")
      .replace(/^\/+|\/+$/g, "");
    if (base.split("/").includes("..") || /[\u0000-\u001f\\]/.test(base))
      return respond(403, "<h1>403 — Invalid file base path</h1>");
    const filename = [base, path === "/" ? "index.html" : path.slice(1)]
      .filter(Boolean)
      .join("/");
    const stored = device.config.features.files || {};
    if (Object.hasOwn(stored, filename)) content = stored[filename];
  }
  if (
    content === undefined &&
    !service.basePath &&
    (path === "/" || path === "/index.html")
  )
    content = service.content ?? "<h1>Network server</h1>";
  if (typeof content !== "string")
    return respond(404, "<h1>404 — Not found</h1>");
  return respond(
    200,
    content,
    path === "/" ? "text/html; charset=utf-8" : contentType(path),
  );
}
