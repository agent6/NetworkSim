import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("../dist/index.html", import.meta.url));
const port = Number(process.env.NETWORKSIM_PREVIEW_PORT || 4173);
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  if (pathname !== "/" && pathname !== "/index.html") {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
    return;
  }
  try {
    const html = await readFile(target);
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(html);
  } catch {
    response.writeHead(503, { "Content-Type": "text/plain" });
    response.end("Run npm run build first.");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`NetworkSim local QA preview: http://127.0.0.1:${port}`),
);
