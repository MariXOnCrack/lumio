import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const staticDir = path.resolve(process.env.LUMIO_STATIC_DIR || path.join(rootDir, "dist"));
const configDir = path.resolve(process.env.LUMIO_CONFIG_DIR || path.join(rootDir, "config"));
const configPath = path.join(configDir, "lumio-config.json");
const port = Number(process.env.LUMIO_PORT || process.env.PORT || 3000);
const envJellyfinUrl = normalizeServerUrl(process.env.JELLYFIN_SERVER_URL || "");
const itemFields = [
  "BackdropImageTags",
  "CommunityRating",
  "DateCreated",
  "Genres",
  "ImageTags",
  "MediaSources",
  "OfficialRating",
  "Overview",
  "People",
  "PrimaryImageAspectRatio",
  "ProductionYear",
  "RunTimeTicks",
  "SeriesName",
  "UserData",
].join(",");

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
      user: sanitizeUser(data.User, data.AccessToken),
      jellyfinServerUrl: serverUrl,
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/jellyfin/me") {
    const serverUrl = await requireConfiguredServerUrl();
    const token = getLumioToken(request, requestUrl);
    const user = await getJellyfinUser(serverUrl, token);
    sendJson(response, 200, {
      user: sanitizeUser(user, token),
      jellyfinServerUrl: serverUrl,
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/jellyfin/home") {
    const serverUrl = await requireConfiguredServerUrl();
    const token = getLumioToken(request, requestUrl);
    const user = await getJellyfinUser(serverUrl, token);
    const library = await getJellyfinHome(serverUrl, user.Id, token);
    sendJson(response, 200, library);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/jellyfin/library") {
    const serverUrl = await requireConfiguredServerUrl();
    const token = getLumioToken(request, requestUrl);
    const user = await getJellyfinUser(serverUrl, token);
    const library = await getJellyfinLibrary(serverUrl, user.Id, token);
    sendJson(response, 200, library);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/jellyfin/search") {
    const serverUrl = await requireConfiguredServerUrl();
    const token = getLumioToken(request, requestUrl);
    const user = await getJellyfinUser(serverUrl, token);
    const query = String(requestUrl.searchParams.get("q") || "").trim();

    if (!query) {
      sendJson(response, 200, { items: [] });
      return;
    }

    const data = await jellyfinFetch(serverUrl, jellyfinRoute("/Items", {
      UserId: user.Id,
      Recursive: "true",
      SearchTerm: query,
      IncludeItemTypes: "Movie,Series,Episode",
      Fields: itemFields,
      ImageTypeLimit: "1",
      Limit: "60",
    }), { headers: jellyfinHeaders(token) });

    sendJson(response, 200, { items: getItemsArray(data).map((item) => mapJellyfinItem(item, token)) });
    return;
  }

  const itemMatch = requestUrl.pathname.match(/^\/api\/jellyfin\/items\/([^/]+)$/);
  if (request.method === "GET" && itemMatch) {
    const serverUrl = await requireConfiguredServerUrl();
    const token = getLumioToken(request, requestUrl);
    const user = await getJellyfinUser(serverUrl, token);
    const itemId = decodeURIComponent(itemMatch[1]);
    const item = await jellyfinFetch(serverUrl, jellyfinRoute(`/Items/${encodeURIComponent(itemId)}`, {
      UserId: user.Id,
      Fields: itemFields,
    }), { headers: jellyfinHeaders(token) });
    const episodes = item.Type === "Series" ? await getJellyfinEpisodes(serverUrl, user.Id, item.Id, token) : [];

    sendJson(response, 200, {
      item: mapJellyfinItem(item, token, episodes),
      episodes,
    });
    return;
  }

  const imageMatch = requestUrl.pathname.match(/^\/api\/jellyfin\/image\/(user|item)\/([^/]+)\/(Primary|Backdrop)(?:\/(\d+))?$/);
  if (request.method === "GET" && imageMatch) {
    await proxyJellyfinImage(request, response, requestUrl, imageMatch);
    return;
  }

  const streamMatch = requestUrl.pathname.match(/^\/api\/jellyfin\/stream\/([^/]+)$/);
  if (request.method === "GET" && streamMatch) {
    await proxyJellyfinStream(request, response, requestUrl, decodeURIComponent(streamMatch[1]));
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

async function getJellyfinHome(serverUrl, userId, token) {
  const headers = jellyfinHeaders(token);
  const [allResult, latestResult, resumeResult] = await Promise.allSettled([
    jellyfinFetch(serverUrl, jellyfinRoute("/Items", {
      UserId: userId,
      Recursive: "true",
      IncludeItemTypes: "Movie,Series",
      SortBy: "SortName",
      Fields: itemFields,
      ImageTypeLimit: "1",
      Limit: "80",
    }), { headers }),
    jellyfinFetch(serverUrl, jellyfinRoute("/Items", {
      UserId: userId,
      Recursive: "true",
      IncludeItemTypes: "Movie,Series",
      SortBy: "DateCreated",
      SortOrder: "Descending",
      Fields: itemFields,
      ImageTypeLimit: "1",
      Limit: "10",
    }), { headers }),
    jellyfinFetch(serverUrl, jellyfinRoute("/UserItems/Resume", {
      UserId: userId,
      MediaTypes: "Video",
      IncludeItemTypes: "Movie,Episode",
      Fields: itemFields,
      ImageTypeLimit: "1",
      Limit: "24",
    }), { headers }),
  ]);

  const allItems = resultItems(allResult).map((item) => mapJellyfinItem(item, token));
  const latestItems = resultItems(latestResult).map((item) => mapJellyfinItem(item, token));
  const resumeItems = resultItems(resumeResult).map((item) => mapJellyfinItem(item, token));
  const mergedItems = mergeItems([...latestItems, ...resumeItems, ...allItems]);
  const movies = mergedItems.filter((item) => item.type === "Movie");
  const series = mergedItems.filter((item) => item.type === "Series");
  const genres = [...new Set(mergedItems.flatMap((item) => item.genres || []))].sort();
  const rows = [
    { title: "Continue Watching", items: resumeItems },
    { title: "Latest", items: latestItems },
    { title: "Movies", items: movies },
    { title: "Series", items: series },
  ].filter((row) => row.items.length > 0);

  return {
    items: mergedItems,
    rows,
    genres,
  };
}

async function getJellyfinLibrary(serverUrl, userId, token) {
  const headers = jellyfinHeaders(token);
  const viewsData = await jellyfinFetch(serverUrl, `/Users/${encodeURIComponent(userId)}/Views`, { headers });
  const views = getItemsArray(viewsData)
    .filter((view) => view.Id && view.Name)
    .filter((view) => !["livetv", "music", "musicvideos", "playlists", "boxsets", "books"].includes(String(view.CollectionType || "").toLowerCase()));

  const categories = await Promise.all(views.map(async (view) => {
    const data = await jellyfinFetch(serverUrl, jellyfinRoute("/Items", {
      UserId: userId,
      ParentId: view.Id,
      Recursive: "true",
      IncludeItemTypes: "Movie,Series",
      SortBy: "SortName",
      Fields: itemFields,
      ImageTypeLimit: "1",
      Limit: "200",
    }), { headers });

    return {
      id: view.Id,
      name: view.Name,
      collectionType: view.CollectionType || "",
      items: getItemsArray(data).map((item) => mapJellyfinItem(item, token)),
    };
  }));

  const visibleCategories = categories.filter((category) => category.items.length > 0);
  const items = mergeItems(visibleCategories.flatMap((category) => category.items));

  return {
    categories: visibleCategories,
    items,
  };
}

async function getJellyfinEpisodes(serverUrl, userId, seriesId, token) {
  const data = await jellyfinFetch(serverUrl, jellyfinRoute(`/Shows/${encodeURIComponent(seriesId)}/Episodes`, {
    UserId: userId,
    Fields: itemFields,
    ImageTypeLimit: "1",
  }), { headers: jellyfinHeaders(token) });

  return getItemsArray(data).map((item, index) => mapJellyfinItem(item, token, [], index));
}

async function proxyJellyfinImage(request, response, requestUrl, match) {
  const serverUrl = await requireConfiguredServerUrl();
  const [, kind, id, imageType, index = "0"] = match;
  const token = getLumioToken(request, requestUrl);
  const itemImageRoute = imageType === "Backdrop"
    ? `/Items/${encodeURIComponent(decodeURIComponent(id))}/Images/${imageType}/${index}`
    : `/Items/${encodeURIComponent(decodeURIComponent(id))}/Images/${imageType}`;
  const route = kind === "user"
    ? jellyfinRoute(`/Users/${encodeURIComponent(decodeURIComponent(id))}/Images/${imageType}`, {
      tag: requestUrl.searchParams.get("tag") || "",
      maxWidth: requestUrl.searchParams.get("w") || "600",
      quality: requestUrl.searchParams.get("quality") || "90",
    })
    : jellyfinRoute(itemImageRoute, {
      tag: requestUrl.searchParams.get("tag") || "",
      fillWidth: requestUrl.searchParams.get("w") || "",
      fillHeight: requestUrl.searchParams.get("h") || "",
      quality: requestUrl.searchParams.get("quality") || "90",
    });

  await proxyJellyfinBinary(response, `${serverUrl}${route}`, {
    headers: jellyfinHeaders(token),
  });
}

async function proxyJellyfinStream(request, response, requestUrl, itemId) {
  const serverUrl = await requireConfiguredServerUrl();
  const token = getLumioToken(request, requestUrl);
  const route = jellyfinRoute(`/Videos/${encodeURIComponent(itemId)}/stream`, {
    static: "true",
  });
  const headers = jellyfinHeaders(token);

  if (request.headers.range) {
    headers.Range = request.headers.range;
  }

  await proxyJellyfinBinary(response, `${serverUrl}${route}`, { headers });
}

async function proxyJellyfinBinary(response, url, options) {
  let upstream;
  try {
    upstream = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw httpError(502, "Could not reach the Jellyfin server.");
  }

  const headers = {};
  for (const header of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"]) {
    const value = upstream.headers.get(header);
    if (value) headers[header] = value;
  }

  response.writeHead(upstream.status, headers);
  if (!upstream.body) {
    response.end();
    return;
  }

  Readable.fromWeb(upstream.body).pipe(response);
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

function getLumioToken(request, requestUrl = null) {
  const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer || request.headers["x-lumio-token"] || requestUrl?.searchParams?.get("token") || "";
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

function jellyfinHeaders(token = "") {
  return {
    "X-Emby-Authorization": jellyfinAuthorizationHeader(token),
    ...(token ? { "X-Emby-Token": token } : {}),
  };
}

function jellyfinRoute(route, query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }

  return `${route}${params.size ? `?${params.toString()}` : ""}`;
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

function sanitizeUser(user = {}, token = "") {
  return {
    id: user.Id,
    name: user.Name,
    isAdmin: Boolean(user.Policy?.IsAdministrator),
    primaryImageTag: user.PrimaryImageTag || "",
    profileImage: user.PrimaryImageTag ? imageProxyUrl("user", user.Id, "Primary", token, { tag: user.PrimaryImageTag, w: 240 }) : "",
  };
}

function resultItems(result) {
  return result.status === "fulfilled" ? getItemsArray(result.value) : [];
}

function getItemsArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.Items)) return data.Items;
  return [];
}

function mergeItems(items) {
  const seen = new Map();
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.set(item.id, item);
  }
  return [...seen.values()];
}

function mapJellyfinItem(item = {}, token = "", episodes = [], index = 0) {
  const type = mapItemType(item.Type);
  const backdropTag = item.BackdropImageTags?.[0] || "";
  const primaryTag = item.ImageTags?.Primary || "";
  const fallbackImage = "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=1400&h=780&q=82";
  const backdrop = backdropTag
    ? imageProxyUrl("item", item.Id, "Backdrop", token, { tag: backdropTag, w: 1400, h: 780, index: 0 })
    : primaryTag
      ? imageProxyUrl("item", item.Id, "Primary", token, { tag: primaryTag, w: 1400, h: 780 })
      : fallbackImage;
  const poster = primaryTag
    ? imageProxyUrl("item", item.Id, "Primary", token, { tag: primaryTag, w: 600, h: 900 })
    : backdrop;
  const duration = formatTicks(item.RunTimeTicks, type === "Series" ? "Series" : "Movie");
  const progress = Math.round(item.UserData?.PlayedPercentage || 0);

  return {
    id: item.Id,
    title: item.Name || item.SeriesName || "Untitled",
    type,
    jellyfinType: item.Type || "",
    source: "jellyfin",
    year: item.ProductionYear || "",
    maturity: item.OfficialRating || "NR",
    duration,
    rating: Number(item.CommunityRating || 0).toFixed(1).replace(/\.0$/, "") || "0",
    progress,
    genres: item.Genres?.length ? item.Genres : [type],
    hero: backdrop,
    poster,
    backdrop,
    description: item.Overview || "No overview is available for this Jellyfin title yet.",
    cast: (item.People || []).slice(0, 5).map((person) => person.Name),
    episodes,
    streamUrl: item.Type === "Movie" || item.Type === "Episode" ? `/api/jellyfin/stream/${encodeURIComponent(item.Id)}?token=${encodeURIComponent(token)}` : "",
    episodeNumber: item.IndexNumber || index + 1,
    seasonNumber: item.ParentIndexNumber || "",
    runtime: duration,
  };
}

function mapItemType(type = "") {
  if (type === "Movie") return "Movie";
  if (type === "Series") return "Series";
  if (type === "Episode") return "Episode";
  return type || "Title";
}

function formatTicks(ticks, fallbackType = "Title") {
  const seconds = Math.round(Number(ticks || 0) / 10000000);
  if (!seconds) return fallbackType === "Series" ? "Series" : "Video";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function imageProxyUrl(kind, id, type, token, options = {}) {
  const params = new URLSearchParams();
  params.set("token", token);
  if (options.tag) params.set("tag", options.tag);
  if (options.w) params.set("w", options.w);
  if (options.h) params.set("h", options.h);
  const index = options.index ?? 0;

  return `/api/jellyfin/image/${kind}/${encodeURIComponent(id)}/${type}${type === "Backdrop" ? `/${index}` : ""}?${params.toString()}`;
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
