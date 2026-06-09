import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const staticDir = path.resolve(process.env.LUMIO_STATIC_DIR || path.join(rootDir, "dist"));
const configDir = path.resolve(process.env.LUMIO_CONFIG_DIR || path.join(rootDir, "config"));
const configPath = path.join(configDir, "lumio-config.json");
const port = Number(process.env.LUMIO_PORT || process.env.PORT || 3000);
const envJellyfinUrl = normalizeServerUrl(process.env.JELLYFIN_SERVER_URL || "");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

await mkdir(configDir, { recursive: true });

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(request, response, requestUrl);
      return;
    }

    await serveStatic(request, response, requestUrl);
  } catch (error) {
    const status = error.status || 500;
    sendJson(response, status, {
      error: status >= 500 ? "Lumio server error" : error.message,
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Lumio listening on http://0.0.0.0:${port}`);
});

async function handleApi(request, response, requestUrl) {
  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/config") {
    const jellyfinServerUrl = await getConfiguredServerUrl();
    sendJson(response, 200, {
      configured: Boolean(jellyfinServerUrl),
      jellyfinServerUrl,
    });
    return;
  }

  if (request.method === "PUT" && requestUrl.pathname === "/api/config") {
    const currentServerUrl = await getConfiguredServerUrl();
    const body = await readJsonBody(request);
    const nextServerUrl = normalizeServerUrl(body.jellyfinServerUrl);

    if (!nextServerUrl) {
      throw httpError(400, "Enter a valid Jellyfin URL, including http:// or https://.");
    }

    if (currentServerUrl) {
      const token = getLumioToken(request);
      const user = await getJellyfinUser(currentServerUrl, token);
      if (!user.Policy?.IsAdministrator) {
        throw httpError(403, "Only Jellyfin admins can change the server URL.");
      }
    }

    await saveConfig({ jellyfinServerUrl: nextServerUrl });
    sendJson(response, 200, {
      configured: true,
      jellyfinServerUrl: nextServerUrl,
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/jellyfin/login") {
    const serverUrl = await requireConfiguredServerUrl();
    const body = await readJsonBody(request);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password) {
      throw httpError(400, "Enter your Jellyfin username and password.");
    }

    const data = await jellyfinFetch(serverUrl, "/Users/AuthenticateByName", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Emby-Authorization": jellyfinAuthorizationHeader(),
      },
      body: JSON.stringify({ Username: username, Pw: password }),
    });

    sendJson(response, 200, {
      accessToken: data.AccessToken,
      user: sanitizeUser(data.User),
      jellyfinServerUrl: serverUrl,
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/jellyfin/me") {
    const serverUrl = await requireConfiguredServerUrl();
    const user = await getJellyfinUser(serverUrl, getLumioToken(request));
    sendJson(response, 200, {
      user: sanitizeUser(user),
      jellyfinServerUrl: serverUrl,
    });
    return;
  }

  throw httpError(404, "API route not found.");
}

async function serveStatic(request, response, requestUrl) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw httpError(405, "Method not allowed.");
  }

  const staticRoot = path.resolve(staticDir);
  const requestedPath = decodeURIComponent(requestUrl.pathname);
  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
  let filePath = path.resolve(staticRoot, relativePath);

  if (!filePath.startsWith(staticRoot)) {
    throw httpError(403, "Forbidden.");
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch {
    filePath = path.join(staticRoot, "index.html");
  }

  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": contentTypes[extension] || "application/octet-stream",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

async function readConfigFile() {
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    return {};
  }
}

async function getConfiguredServerUrl() {
  const config = await readConfigFile();
  return normalizeServerUrl(config.jellyfinServerUrl) || envJellyfinUrl;
}

async function requireConfiguredServerUrl() {
  const serverUrl = await getConfiguredServerUrl();
  if (!serverUrl) {
    throw httpError(409, "Jellyfin is not configured yet.");
  }
  return serverUrl;
}

async function saveConfig(config) {
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw httpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "Invalid JSON body.");
  }
}

async function getJellyfinUser(serverUrl, token) {
  if (!token) {
    throw httpError(401, "Missing Jellyfin session.");
  }

  return jellyfinFetch(serverUrl, "/Users/Me", {
    headers: {
      "X-Emby-Authorization": jellyfinAuthorizationHeader(token),
      "X-Emby-Token": token,
    },
  });
}

async function jellyfinFetch(serverUrl, route, options = {}) {
  let response;
  try {
    response = await fetch(`${serverUrl}${route}`, {
      ...options,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw httpError(502, "Could not reach the Jellyfin server.");
  }

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message = data.Message || data.error || `Jellyfin returned ${response.status}.`;
    throw httpError(response.status, message);
  }

  return data;
}

function getLumioToken(request) {
  const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer || request.headers["x-lumio-token"] || "";
}

function jellyfinAuthorizationHeader(token = "") {
  const values = [
    'MediaBrowser Client="Lumio"',
    'Device="Lumio Web"',
    'DeviceId="lumio-web"',
    'Version="0.1.0"',
  ];

  if (token) values.push(`Token="${token}"`);
  return values.join(", ");
}

function normalizeServerUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function sanitizeUser(user = {}) {
  return {
    id: user.Id,
    name: user.Name,
    isAdmin: Boolean(user.Policy?.IsAdministrator),
    primaryImageTag: user.PrimaryImageTag || "",
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
