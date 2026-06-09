import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Bookmark,
  Captions,
  Check,
  ChevronLeft,
  Clapperboard,
  Compass,
  Film,
  Gauge,
  Home,
  Info,
  KeyRound,
  Library as LibraryIcon,
  Loader2,
  LogOut,
  Maximize2,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  Search,
  Server,
  Settings,
  Shield,
  Sparkles,
  Star,
  Tv,
  User,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { genres, getTitle, media, rows } from "@/data/media";
import { cn } from "@/lib/utils";
import lumioIcon from "../lumio_icon_transparent.png";

const navItems = [
  { label: "Home", path: "/", icon: Home },
  { label: "Library", path: "/library", icon: LibraryIcon },
  { label: "Discover", path: "/discover", icon: Sparkles },
  { label: "Browse", path: "/browse", icon: Compass },
  { label: "Series", path: "/browse?type=Series", icon: Tv },
  { label: "My List", path: "/my-list", icon: Bookmark },
];

const adminNavItem = { label: "Jellyfin", path: "/admin", icon: Server };
const sessionStorageKey = "lumio-jellyfin-session";

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { "X-Lumio-Token": options.token, Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Lumio request failed.");
  }

  return data;
}

function readStoredSession() {
  try {
    return JSON.parse(window.localStorage.getItem(sessionStorageKey) || "null");
  } catch {
    return null;
  }
}

function writeStoredSession(session) {
  if (session) {
    window.localStorage.setItem(sessionStorageKey, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(sessionStorageKey);
  }
}

function getInitials(name = "User") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
}

function normalizeInputUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function App() {
  const [savedIds, setSavedIds] = useState(() => new Set(["midnight-signal", "deep-orbit"]));
  const [config, setConfig] = useState({ configured: false, jellyfinServerUrl: "" });
  const [session, setSession] = useState(() => readStoredSession());
  const [bootState, setBootState] = useState({ loading: true, error: "" });
  const [library, setLibrary] = useState({ loading: false, error: "", items: [], rows: [], genres: [] });

  const toggleSaved = (id) => {
    setSavedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const activeItems = library.items.length > 0 ? library.items : media;
  const saved = useMemo(() => activeItems.filter((item) => savedIds.has(item.id)), [activeItems, savedIds]);
  const isAdmin = Boolean(session?.user?.isAdmin);
  const appState = { savedIds, saved, toggleSaved, config, session, library };

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const nextConfig = await apiRequest("/api/config");
        if (!active) return;
        setConfig(nextConfig);

        const storedSession = readStoredSession();
        if (nextConfig.configured && storedSession?.accessToken) {
          try {
            const me = await apiRequest("/api/jellyfin/me", { token: storedSession.accessToken });
            const nextSession = { ...storedSession, user: me.user };
            if (!active) return;
            setSession(nextSession);
            writeStoredSession(nextSession);
          } catch {
            if (!active) return;
            setSession(null);
            writeStoredSession(null);
          }
        }

        if (active) setBootState({ loading: false, error: "" });
      } catch (error) {
        if (active) setBootState({ loading: false, error: error.message });
      }
    }

    boot();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadLibrary() {
      if (!session?.accessToken) return;

      setLibrary((current) => ({ ...current, loading: true, error: "" }));

      try {
        const data = await apiRequest("/api/jellyfin/home", { token: session.accessToken });
        if (!active) return;
        setLibrary({
          loading: false,
          error: "",
          items: data.items || [],
          rows: data.rows || [],
          genres: data.genres || [],
        });
      } catch (error) {
        if (!active) return;
        setLibrary((current) => ({ ...current, loading: false, error: error.message }));
      }
    }

    loadLibrary();

    return () => {
      active = false;
    };
  }, [session?.accessToken]);

  const handleLogin = (nextSession) => {
    setSession(nextSession);
    writeStoredSession(nextSession);
  };

  const handleLogout = () => {
    setSession(null);
    setLibrary({ loading: false, error: "", items: [], rows: [], genres: [] });
    writeStoredSession(null);
  };

  if (bootState.loading) {
    return <ConnectionFrame title="Starting Lumio" description="Checking Jellyfin connection settings." loading />;
  }

  if (bootState.error) {
    return <ConnectionFrame title="Lumio server is unavailable" description={bootState.error} />;
  }

  if (!config.configured) {
    return <SetupPage onConfigured={setConfig} />;
  }

  if (!session) {
    return <LoginPage config={config} onLogin={handleLogin} />;
  }

  return (
    <Routes>
      <Route element={<Shell config={config} session={session} onLogout={handleLogout} />}>
        <Route index element={<HomePage {...appState} />} />
        <Route path="library" element={<LibraryPage {...appState} />} />
        <Route path="discover" element={<DiscoverPage {...appState} />} />
        <Route path="browse" element={<BrowsePage {...appState} />} />
        <Route path="search" element={<SearchPage {...appState} />} />
        <Route path="my-list" element={<MyListPage {...appState} />} />
        <Route path="admin" element={isAdmin ? <AdminPage config={config} session={session} onConfigSaved={setConfig} /> : <Navigate to="/" replace />} />
        <Route path="title/:id" element={<TitlePage {...appState} />} />
      </Route>
      <Route path="watch/:id" element={<WatchPage library={library} session={session} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Shell({ config, session, onLogout }) {
  const visibleNavItems = session?.user?.isAdmin ? [...navItems, adminNavItem] : navItems;

  return (
    <div className="min-h-screen bg-background">
      <aside className="sidebar-shell fixed inset-y-0 left-0 z-30 hidden flex-col border-r bg-sidebar py-5 lg:flex">
        <Brand />
        <nav className="mt-8 grid flex-1 content-start gap-1">
          {visibleNavItems.map((item) => (
            <NavLink key={item.label} item={item} />
          ))}
        </nav>
        <SidebarAccount config={config} session={session} onLogout={onLogout} />
      </aside>

      <div className="lg:pl-[76px]">
        <Topbar config={config} session={session} onLogout={onLogout} />
        <main className="px-3 pb-24 pt-4 sm:px-4 lg:px-6 lg:pb-10 2xl:px-8">
          <Outlet />
        </main>
      </div>

      <MobileNav items={visibleNavItems} />
    </div>
  );
}

function Brand() {
  return (
    <Link className="sidebar-brand flex w-full items-center justify-center" to="/" aria-label="Lumio home">
      <span className="grid size-10 place-items-center overflow-hidden">
        <img className="size-full scale-150 object-contain" src={lumioIcon} alt="" />
      </span>
    </Link>
  );
}

function SidebarAccount({ config, session, onLogout }) {
  return (
    <div className="sidebar-account border-t pt-4">
      <ProfileMenu config={config} session={session} triggerClassName="h-14 w-full justify-start gap-3 px-2" showName onLogout={onLogout} />
    </div>
  );
}

function ProfileMenu({ config, session, triggerClassName, showName = false, onLogout }) {
  const userName = session?.user?.name || "Jellyfin User";
  const isAdmin = Boolean(session?.user?.isAdmin);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "gap-3 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring",
            triggerClassName,
          )}
        >
          <Avatar className="sidebar-avatar size-9">
            <AvatarImage src={session?.user?.profileImage || ""} />
            <AvatarFallback>{getInitials(userName)}</AvatarFallback>
          </Avatar>
          {showName && (
            <span className="sidebar-profile-text min-w-0 text-left">
              <span className="block truncate text-sm font-bold">{userName}</span>
              <span className="block truncate text-xs text-muted-foreground">{isAdmin ? "Jellyfin admin" : "Jellyfin user"}</span>
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate">{userName}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">{config.jellyfinServerUrl}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <User className="size-4" />
          Account
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem asChild>
            <Link to="/admin">
              <Server className="size-4" />
              Jellyfin settings
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavLink({ item }) {
  const location = useLocation();
  const Icon = item.icon;
  const fullPath = location.pathname + location.search;
  let active = false;

  if (item.path === "/") {
    active = location.pathname === "/";
  } else if (item.path.includes("?")) {
    active = fullPath === item.path;
  } else if (item.path === "/browse") {
    active = location.pathname === "/browse" && location.search !== "?type=Series";
  } else {
    active = location.pathname === item.path;
  }

  return (
    <Link
      to={item.path}
      className={cn(
        "sidebar-nav-link flex h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      <Icon className="size-4" />
      <span className="sidebar-label">{item.label}</span>
    </Link>
  );
}

function Topbar({ config, session, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  useEffect(() => {
    if (location.pathname === "/search") {
      const params = new URLSearchParams(location.search);
      setQuery(params.get("q") || "");
    }
  }, [location.pathname, location.search]);

  const submit = (event) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  const updateQuery = (value) => {
    setQuery(value);

    const trimmed = value.trim();
    if (trimmed) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}`, { replace: location.pathname === "/search" });
    } else if (location.pathname === "/search") {
      navigate("/search", { replace: true });
    }
  };

  const searchInput = (
    <>
      <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-white/58" />
      <Input
        value={query}
        onChange={(event) => updateQuery(event.target.value)}
        className="search-glass-input h-11 pl-10"
        placeholder="Search movies, series, genres, cast"
        type="search"
        autoFocus={mobileSearchOpen}
      />
    </>
  );

  return (
    <header className="sticky top-0 z-20 px-3 py-3 sm:px-4 lg:px-6 2xl:px-8">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 lg:grid-cols-[1fr_minmax(360px,720px)_1fr]">
        <div className="flex items-center justify-start lg:hidden">
          <Brand />
        </div>
        <form onSubmit={submit} className="relative hidden lg:col-start-2 lg:block">
          {searchInput}
        </form>
        <div className="hidden lg:col-start-3 lg:block" />
        <div className="col-start-3 flex justify-end lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            className={cn("size-11 rounded-full hover:bg-white/10", mobileSearchOpen && "bg-white/10")}
            onClick={() => setMobileSearchOpen((open) => !open)}
            aria-label="Search"
          >
            <Search className="size-5" />
          </Button>
        </div>
        <div className="col-start-4 flex justify-end lg:hidden">
          <ProfileMenu config={config} session={session} triggerClassName="h-11 px-1" onLogout={onLogout} />
        </div>
        {mobileSearchOpen && (
          <form
            onSubmit={submit}
            className="animate-reveal-up relative col-span-4 mt-1 lg:hidden"
          >
            {searchInput}
          </form>
        )}
      </div>
    </header>
  );
}

function MobileNav({ items = navItems }) {
  return (
    <nav className="fixed bottom-3 left-3 right-3 z-40 grid rounded-lg border bg-card p-1 shadow-2xl lg:hidden" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            to={item.path}
            className="grid h-12 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={item.label}
          >
            <Icon className="size-5" />
          </Link>
        );
      })}
    </nav>
  );
}

function ConnectionFrame({ title, description, children, loading = false }) {
  return (
    <main className="connection-screen min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center">
        <div className="mb-8 flex justify-center">
          <span className="grid size-12 place-items-center overflow-hidden">
            <img className="size-full scale-150 object-contain" src={lumioIcon} alt="" />
          </span>
        </div>
        <section className="connection-panel animate-reveal-up">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-primary">
              {loading ? <Loader2 className="size-5 animate-spin" /> : <Server className="size-5" />}
            </span>
            <div className="min-w-0">
              <h1 className="animate-text-load text-2xl font-black">{title}</h1>
              <p className="animate-text-load mt-2 text-sm leading-6 text-muted-foreground" style={{ animationDelay: "90ms" }}>
                {description}
              </p>
            </div>
          </div>
          {children && <div className="mt-6">{children}</div>}
        </section>
      </div>
    </main>
  );
}

function SetupPage({ onConfigured }) {
  const [serverUrl, setServerUrl] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSaving(true);

    try {
      const config = await apiRequest("/api/config", {
        method: "PUT",
        body: JSON.stringify({ jellyfinServerUrl: normalizeInputUrl(serverUrl) }),
      });
      onConfigured(config);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConnectionFrame
      title="Connect Jellyfin"
      description="Set the Jellyfin server URL Lumio should use. After this, only Jellyfin admins can change it from the Lumio admin panel."
    >
      <form className="grid gap-4" onSubmit={submit}>
        <label className="grid gap-2 text-sm font-bold">
          Jellyfin server URL
          <Input
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="http://jellyfin:8096"
            type="url"
            required
          />
        </label>
        {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Server />}
          Save server
        </Button>
      </form>
    </ConnectionFrame>
  );
}

function LoginPage({ config, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setLoggingIn(true);

    try {
      const session = await apiRequest("/api/jellyfin/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      onLogin(session);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <ConnectionFrame title="Sign in with Jellyfin" description={`Connected to ${config.jellyfinServerUrl}. Use your Jellyfin user account to enter Lumio.`}>
      <form className="grid gap-4" onSubmit={submit}>
        <label className="grid gap-2 text-sm font-bold">
          Username
          <Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
        </label>
        <label className="grid gap-2 text-sm font-bold">
          Password
          <Input value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" type="password" required />
        </label>
        {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
        <Button type="submit" disabled={loggingIn}>
          {loggingIn ? <Loader2 className="animate-spin" /> : <KeyRound />}
          Sign in
        </Button>
      </form>
    </ConnectionFrame>
  );
}

function AdminPage({ config, session, onConfigSaved }) {
  const [serverUrl, setServerUrl] = useState(config.jellyfinServerUrl);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setStatus("");
    setError("");
    setSaving(true);

    try {
      const nextConfig = await apiRequest("/api/config", {
        method: "PUT",
        token: session.accessToken,
        body: JSON.stringify({ jellyfinServerUrl: normalizeInputUrl(serverUrl) }),
      });
      onConfigSaved(nextConfig);
      setServerUrl(nextConfig.jellyfinServerUrl);
      setStatus("Jellyfin server URL saved.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Admin"
        title="Jellyfin Connection"
        description="Only Jellyfin admins can change the server Lumio uses for user login."
      />
      <section className="admin-panel mt-6 max-w-2xl animate-reveal-up">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-primary">
            <Shield className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-black">Server URL</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Docker installs can also set this initially with <span className="font-mono text-foreground">JELLYFIN_SERVER_URL</span>.
            </p>
          </div>
        </div>
        <form className="mt-6 grid gap-4" onSubmit={submit}>
          <label className="grid gap-2 text-sm font-bold">
            Jellyfin server URL
            <Input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} type="url" required />
          </label>
          {status && <p className="text-sm font-semibold text-primary">{status}</p>}
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          <div>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Server />}
              Save Jellyfin URL
            </Button>
          </div>
        </form>
      </section>
    </PageFrame>
  );
}

function HomePage({ savedIds, toggleSaved, library }) {
  const itemRows = getLibraryRows(library);
  const items = getLibraryItems(library);

  return (
    <PageFrame>
      {library?.loading && <LibraryNotice message="Loading your Jellyfin library..." />}
      {library?.error && <LibraryNotice message={library.error} />}
      {items.length > 0 ? (
        <HeroCarousel items={items} savedIds={savedIds} toggleSaved={toggleSaved} />
      ) : !library?.loading ? (
        <EmptyState title="No Jellyfin titles found" />
      ) : null}
      <GenrePills genresData={getLibraryGenres(library)} />
      <div className="mt-6 grid gap-7 sm:mt-8 sm:gap-8">
        {itemRows.map((row) => (
          <MediaRow
            key={row.title}
            title={row.title}
            items={row.items}
            savedIds={savedIds}
            toggleSaved={toggleSaved}
          />
        ))}
      </div>
    </PageFrame>
  );
}

function LibraryNotice({ message }) {
  return (
    <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
      {message}
    </div>
  );
}

function PageFrame({ children }) {
  return <div className="w-full overflow-hidden">{children}</div>;
}

function getLibraryItems(library) {
  return library ? library.items || [] : media;
}

function getLibraryRows(library) {
  return library ? library.rows || [] : rows;
}

function getLibraryGenres(library) {
  return library ? library.genres || [] : genres;
}

function getLibraryTitle(id, library) {
  return getLibraryItems(library).find((item) => item.id === id) || getTitle(id);
}

function MediaImage({ src, alt = "", className, imageClassName, loading = "lazy" }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      <Skeleton className={cn("absolute inset-0 transition-opacity duration-300", loaded && "opacity-0")} />
      <img
        className={cn("size-full object-cover opacity-0 transition duration-500", loaded && "opacity-100", imageClassName)}
        src={src}
        alt={alt}
        loading={loading}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

function HeroCarousel({ items = media, savedIds, toggleSaved }) {
  const heroItems = (items.length ? items : media).slice(0, 5);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = heroItems[activeIndex] || media[0];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActiveIndex((current) => (current + 1) % heroItems.length);
    }, 8000);

    return () => window.clearTimeout(timer);
  }, [activeIndex, heroItems.length]);

  return (
    <section className="group/hero relative -mx-3 min-h-[400px] overflow-hidden sm:-mx-4 sm:min-h-[450px] lg:-mx-6 lg:min-h-[510px] 2xl:-mx-8">
      <MediaImage src={active.hero} className="absolute -inset-x-8 -bottom-14 -top-10" imageClassName="object-center" loading="eager" />
      <div className="media-mask-wide absolute -inset-x-8 -bottom-14 -top-10" />

      <div className="relative flex min-h-[400px] px-5 py-6 sm:min-h-[450px] sm:px-8 sm:py-8 lg:min-h-[510px] lg:px-10 lg:py-10 2xl:px-12">
        <div key={active.id} className="flex max-w-5xl flex-col justify-end pb-7 sm:pb-8">
          <div className="animate-text-load flex flex-wrap gap-2" style={{ animationDelay: "40ms" }}>
            <Badge>{active.type}</Badge>
            <Badge variant="secondary">{active.year}</Badge>
            <Badge variant="secondary">{active.maturity}</Badge>
            <Badge variant="secondary">{active.duration}</Badge>
          </div>
          <h1 className="animate-text-load mt-4 max-w-[13ch] text-4xl font-black leading-tight sm:mt-5 sm:text-6xl lg:text-7xl" style={{ animationDelay: "110ms" }}>
            {active.title}
          </h1>
          <p className="animate-text-load mt-3 line-clamp-3 max-w-2xl text-sm text-muted-foreground sm:mt-4 sm:text-lg" style={{ animationDelay: "180ms" }}>
            {active.description}
          </p>
          <div className="animate-text-load mt-5 flex flex-wrap gap-2 sm:mt-6 sm:gap-3" style={{ animationDelay: "250ms" }}>
            <Button asChild size="lg">
              <Link to={`/watch/${active.id}`}>
                <Play className="fill-current" />
                Play
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link to={`/title/${active.id}`}>
                <Info />
                More Info
              </Link>
            </Button>
            <Button variant="outline" size="lg" onClick={() => toggleSaved(active.id)}>
              {savedIds.has(active.id) ? <Check /> : <Plus />}
              {savedIds.has(active.id) ? "Saved" : "My List"}
            </Button>
          </div>
        </div>
      </div>

      <div className="absolute bottom-5 left-5 right-5 flex items-center gap-3 sm:left-8 sm:right-8 lg:left-10 lg:right-10 2xl:left-12 2xl:right-12">
        <div className="flex flex-1 gap-2">
          {heroItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/25"
              aria-label={`Show ${item.title}`}
            >
              <span
                key={index === activeIndex ? `active-${activeIndex}-${active.id}` : `inactive-${item.id}`}
                className={cn(
                  "absolute inset-y-0 left-0 w-full origin-left rounded-full bg-primary/90",
                  index === activeIndex ? "animate-hero-load" : "scale-x-0",
                )}
                style={index === activeIndex ? { animationDuration: "8000ms" } : undefined}
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function GenrePills({ genresData = genres }) {
  return (
    <ScrollArea className="mt-4 w-full max-w-full whitespace-nowrap sm:mt-5">
      <div className="flex gap-2 pb-3">
        <Button asChild variant="secondary" className="rounded-full">
          <Link to="/browse">All Genres</Link>
        </Button>
        {genresData.map((genre) => (
          <Button key={genre} asChild variant="outline" className="rounded-full">
            <Link to={`/browse?genre=${encodeURIComponent(genre)}`}>{genre}</Link>
          </Button>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

function MediaRow({ title, items, savedIds, toggleSaved }) {
  return (
    <section className="min-w-0 overflow-hidden animate-reveal-up">
      <HorizontalScroller
        header={<h2 className="animate-text-load text-xl font-bold">{title}</h2>}
        action={
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/browse">View all</Link>
          </Button>
        }
      >
        <div className="flex gap-5 pb-4">
          {items.map((item, index) => (
            <MediaCard
              key={item.id}
              item={item}
              saved={savedIds.has(item.id)}
              onToggleSaved={() => toggleSaved(item.id)}
              delay={index * 45}
              className="w-[138px] shrink-0 sm:w-[210px] xl:w-[230px] 2xl:w-[250px]"
            />
          ))}
        </div>
      </HorizontalScroller>
    </section>
  );
}

function HorizontalScroller({ children, header, action }) {
  const viewportRef = useRef(null);
  const animationRef = useRef(null);
  const [pressedDirection, setPressedDirection] = useState(null);
  const [scrollState, setScrollState] = useState({ left: false, right: false });

  const updateScrollState = useCallback(() => {
    const node = viewportRef.current;
    if (!node) return;

    const max = Math.max(0, node.scrollWidth - node.clientWidth);
    setScrollState({
      left: node.scrollLeft > 2,
      right: node.scrollLeft < max - 2,
    });
  }, []);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;

    updateScrollState();

    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(node);

    window.addEventListener("resize", updateScrollState);

    return () => {
      if (animationRef.current) {
        window.cancelAnimationFrame(animationRef.current);
      }
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateScrollState);
    };
  }, [updateScrollState]);

  const scroll = (direction) => {
    const node = viewportRef.current;
    if (!node) return;

    if (animationRef.current) {
      window.cancelAnimationFrame(animationRef.current);
    }

    const start = node.scrollLeft;
    const max = node.scrollWidth - node.clientWidth;
    const distance = direction * Math.max(360, node.clientWidth * 0.78);
    const target = Math.max(0, Math.min(max, start + distance));
    const duration = 560;
    const startedAt = performance.now();
    const easeOutQuart = (value) => 1 - Math.pow(1 - value, 4);

    const tick = (now) => {
      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / duration);
      const eased = easeOutQuart(progress);

      node.scrollLeft = start + (target - start) * eased;

      if (progress < 1) {
        animationRef.current = window.requestAnimationFrame(tick);
      } else {
        animationRef.current = null;
        updateScrollState();
      }
    };

    animationRef.current = window.requestAnimationFrame(tick);
  };

  return (
    <div className="group/rail min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">{header}</div>
        <div className="ml-auto flex items-center gap-2">
          {action}
          <div className="carousel-controls">
            <button
              type="button"
              className={cn("carousel-arrow", !scrollState.left && "invisible pointer-events-none", pressedDirection === -1 && "is-pressing")}
              onPointerDown={() => setPressedDirection(-1)}
              onPointerUp={() => setPressedDirection(null)}
              onPointerLeave={() => setPressedDirection(null)}
              onPointerCancel={() => setPressedDirection(null)}
              onClick={() => scroll(-1)}
              aria-label="Scroll carousel left"
              aria-hidden={!scrollState.left}
              tabIndex={scrollState.left ? 0 : -1}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              className={cn("carousel-arrow", !scrollState.right && "invisible pointer-events-none", pressedDirection === 1 && "is-pressing")}
              onPointerDown={() => setPressedDirection(1)}
              onPointerUp={() => setPressedDirection(null)}
              onPointerLeave={() => setPressedDirection(null)}
              onPointerCancel={() => setPressedDirection(null)}
              onClick={() => scroll(1)}
              aria-label="Scroll carousel right"
              aria-hidden={!scrollState.right}
              tabIndex={scrollState.right ? 0 : -1}
            >
              <ChevronLeft className="size-4 rotate-180" />
            </button>
          </div>
        </div>
      </div>
      <div ref={viewportRef} className="carousel-scroll w-full overflow-x-auto" onScroll={updateScrollState}>
        {children}
      </div>
    </div>
  );
}

function MediaCard({ item, saved, onToggleSaved, className, delay = 0 }) {
  return (
    <article className={cn("group min-w-0 animate-reveal-up", className)} style={{ animationDelay: `${delay}ms` }}>
      <div className="relative">
        <Link to={`/title/${item.id}`} className="block">
          <MediaImage
            className="aspect-[2/3] rounded-md"
            imageClassName="transition-transform duration-300 group-hover:scale-105"
            src={item.poster}
          />
          {item.progress > 0 && (
            <Progress
              value={item.progress}
              className="absolute bottom-[5px] left-[5px] right-[5px] h-1.5 w-auto overflow-hidden rounded-full bg-black/55"
            />
          )}
        </Link>
        <Button
          variant="secondary"
          size="icon"
          className="absolute right-2 top-2 size-8 bg-black/55 text-white backdrop-blur hover:bg-white hover:text-black"
          onClick={onToggleSaved}
          aria-label="Save title"
        >
          {saved ? <Check className="size-4" /> : <Bookmark className="size-4" />}
        </Button>
      </div>

      <Link to={`/title/${item.id}`} className="mt-2 block min-w-0">
        <h3 className="animate-text-load line-clamp-2 text-sm font-bold leading-5" style={{ animationDelay: `${delay + 80}ms` }}>
          {item.title}
        </h3>
        <p className="animate-text-load mt-0.5 text-xs leading-4 text-muted-foreground" style={{ animationDelay: `${delay + 130}ms` }}>
          {item.year} / {item.type} / {item.genres[0]}
        </p>
      </Link>
      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <Star className="size-3 fill-primary text-primary" />
        {item.rating}
      </div>
    </article>
  );
}

function BrowsePage({ savedIds, toggleSaved, library }) {
  const [searchParams] = useSearchParams();
  const type = searchParams.get("type") || "All";
  const genre = searchParams.get("genre") || "All";
  const [activeType, setActiveType] = useState(type);
  const items = getLibraryItems(library);

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        const typeMatch = activeType === "All" || item.type === activeType;
        const genreMatch = genre === "All" || item.genres.includes(genre);
        return typeMatch && genreMatch;
      }),
    [activeType, genre, items],
  );

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Browse"
        title={genre === "All" ? "Explore the Library" : genre}
        description="Filter movies, series, documentaries, and mood-based collections."
      />
      <Tabs value={activeType} onValueChange={setActiveType} className="mt-6">
        <TabsList>
          <TabsTrigger value="All">All</TabsTrigger>
          <TabsTrigger value="Movie">Movies</TabsTrigger>
          <TabsTrigger value="Series">Series</TabsTrigger>
          <TabsTrigger value="Documentary">Docs</TabsTrigger>
        </TabsList>
        <TabsContent value={activeType}>
          {filtered.length > 0 ? (
            <MediaGrid items={filtered} savedIds={savedIds} toggleSaved={toggleSaved} />
          ) : (
            <EmptyState title={library?.loading ? "Loading Jellyfin library" : "No Jellyfin titles found"} />
          )}
        </TabsContent>
      </Tabs>
    </PageFrame>
  );
}

function LibraryPage({ savedIds, toggleSaved, session, library }) {
  const [state, setState] = useState({ loading: true, error: "", categories: [], items: [] });
  const [activeTab, setActiveTab] = useState("all");

  useEffect(() => {
    let active = true;

    async function loadLibraryCategories() {
      if (!session?.accessToken) return;

      setState((current) => ({ ...current, loading: true, error: "" }));

      try {
        const data = await apiRequest("/api/jellyfin/library", { token: session.accessToken });
        if (!active) return;
        setState({
          loading: false,
          error: "",
          categories: data.categories || [],
          items: data.items || [],
        });
      } catch (error) {
        if (!active) return;
        setState({ loading: false, error: error.message, categories: [], items: [] });
      }
    }

    loadLibraryCategories();

    return () => {
      active = false;
    };
  }, [session?.accessToken]);

  const fallbackItems = getLibraryItems(library);
  const allItems = state.items.length > 0 ? state.items : fallbackItems;
  const activeCategory = state.categories.find((category) => category.id === activeTab);
  const visibleItems = activeTab === "all" ? allItems : activeCategory?.items || [];

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Library"
        title="Jellyfin Library"
        description="Browse your Jellyfin libraries by server category."
      />
      {state.error && <LibraryNotice message={state.error} />}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
        <ScrollArea className="max-w-full whitespace-nowrap">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            {state.categories.map((category) => (
              <TabsTrigger key={category.id} value={category.id}>
                {category.name}
              </TabsTrigger>
            ))}
          </TabsList>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <TabsContent value={activeTab}>
          {state.loading ? (
            <EmptyState title="Loading Jellyfin library" />
          ) : visibleItems.length > 0 ? (
            <MediaGrid items={visibleItems} savedIds={savedIds} toggleSaved={toggleSaved} />
          ) : (
            <EmptyState title="No titles in this category" />
          )}
        </TabsContent>
      </Tabs>
    </PageFrame>
  );
}

function SearchPage({ savedIds, toggleSaved, library, session }) {
  const [searchParams] = useSearchParams();
  const query = (searchParams.get("q") || "").trim();
  const lowerQuery = query.toLowerCase();
  const [remoteState, setRemoteState] = useState({ loading: false, error: "", items: [] });
  const localItems = getLibraryItems(library);
  const localResults = localItems.filter((item) => {
    const haystack = [item.title, item.type, ...(item.genres || []), ...(item.cast || [])].join(" ").toLowerCase();
    return haystack.includes(lowerQuery);
  });
  const results = remoteState.items.length > 0 ? remoteState.items : localResults;

  useEffect(() => {
    let active = true;

    async function searchJellyfin() {
      if (!query || !session?.accessToken) {
        setRemoteState({ loading: false, error: "", items: [] });
        return;
      }

      setRemoteState((current) => ({ ...current, loading: true, error: "" }));

      try {
        const data = await apiRequest(`/api/jellyfin/search?q=${encodeURIComponent(query)}`, { token: session.accessToken });
        if (!active) return;
        setRemoteState({ loading: false, error: "", items: data.items || [] });
      } catch (error) {
        if (!active) return;
        setRemoteState({ loading: false, error: error.message, items: [] });
      }
    }

    searchJellyfin();

    return () => {
      active = false;
    };
  }, [query, session?.accessToken]);

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Search"
        title={query ? `Results for "${query}"` : "Search Lumio"}
        description="Search matches titles, genres, cast, and formats."
      />
      {remoteState.error && <LibraryNotice message={remoteState.error} />}
      {query && results.length > 0 ? (
        <MediaGrid items={results} savedIds={savedIds} toggleSaved={toggleSaved} />
      ) : remoteState.loading ? (
        <EmptyState title="Searching Jellyfin" />
      ) : (
        <EmptyState title={query ? "No titles found" : "Type a search above"} />
      )}
    </PageFrame>
  );
}

function MyListPage({ saved, savedIds, toggleSaved }) {
  return (
    <PageFrame>
      <PageHeader eyebrow="Saved" title="My List" description="Everything you saved is ready here across devices." />
      {saved.length > 0 ? (
        <MediaGrid items={saved} savedIds={savedIds} toggleSaved={toggleSaved} />
      ) : (
        <EmptyState title="Your list is empty" />
      )}
    </PageFrame>
  );
}

function MediaGrid({ items, savedIds, toggleSaved }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
      {items.map((item, index) => (
        <MediaCard
          key={item.id}
          item={item}
          saved={savedIds.has(item.id)}
          onToggleSaved={() => toggleSaved(item.id)}
          delay={index * 45}
        />
      ))}
    </div>
  );
}

function DiscoverPage({ savedIds, toggleSaved }) {
  const spotlight = media[3];
  const requestItems = media.slice(2, 10);
  const collectionItems = media.filter((item) => item.type === "Series" || item.type === "Movie").slice(4, 12);
  const queue = [
    ["Requested", "18"],
    ["Available", "6"],
    ["Watching", "12"],
  ];

  return (
    <PageFrame>
      <section className="discover-hero relative -mx-3 min-h-[420px] overflow-hidden sm:-mx-4 lg:-mx-6 2xl:-mx-8">
        <MediaImage src={spotlight.hero} className="absolute -inset-x-8 -bottom-10 -top-8" imageClassName="object-center" loading="eager" />
        <div className="media-mask-wide absolute -inset-x-8 -bottom-10 -top-8" />
        <div className="relative grid min-h-[420px] gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-10 2xl:px-12">
          <div className="flex max-w-4xl flex-col justify-end pb-7">
            <div className="animate-text-load flex flex-wrap gap-2">
              <Badge>Discover</Badge>
              <Badge variant="secondary">Movies</Badge>
              <Badge variant="secondary">Series</Badge>
            </div>
            <h1 className="animate-text-load mt-4 max-w-3xl text-4xl font-black leading-tight sm:text-6xl" style={{ animationDelay: "90ms" }}>
              Find the next thing worth adding.
            </h1>
            <p className="animate-text-load mt-4 max-w-2xl text-sm text-muted-foreground sm:text-base" style={{ animationDelay: "160ms" }}>
              Browse request-ready titles, trending genres, and high-match picks in one place.
            </p>
            <div className="animate-text-load mt-6 flex flex-wrap gap-2" style={{ animationDelay: "230ms" }}>
              {genres.slice(0, 6).map((genre) => (
                <Button key={genre} asChild variant="secondary" className="rounded-full">
                  <Link to={`/browse?genre=${encodeURIComponent(genre)}`}>{genre}</Link>
                </Button>
              ))}
            </div>
          </div>

          <aside className="discover-queue hidden self-end lg:block">
            <p className="text-xs font-black uppercase text-white/50">Request Queue</p>
            <div className="mt-4 grid gap-3">
              {queue.map(([label, value], index) => (
                <div key={label} className="discover-stat animate-text-load" style={{ animationDelay: `${index * 70 + 160}ms` }}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <section className="mt-8 animate-reveal-up">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="animate-text-load text-xs font-black uppercase text-primary">Request Picks</p>
            <h2 className="animate-text-load mt-1 text-2xl font-black" style={{ animationDelay: "80ms" }}>
              Popular to add
            </h2>
          </div>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/browse">Browse all</Link>
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {requestItems.map((item, index) => (
            <DiscoverRequestCard
              key={item.id}
              item={item}
              delay={index * 45}
              saved={savedIds.has(item.id)}
              status={index % 3 === 0 ? "Available" : index % 3 === 1 ? "Requested" : "Request"}
              onToggleSaved={() => toggleSaved(item.id)}
            />
          ))}
        </div>
      </section>

      <section className="mt-8 animate-reveal-up">
        <HorizontalScroller
          header={<h2 className="animate-text-load text-xl font-bold">High-match movies and series</h2>}
          action={
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to="/browse">View library</Link>
            </Button>
          }
        >
          <div className="flex gap-5 pb-4">
            {collectionItems.map((item, index) => (
              <MediaCard
                key={item.id}
                item={item}
                saved={savedIds.has(item.id)}
                onToggleSaved={() => toggleSaved(item.id)}
                delay={index * 45}
                className="w-[138px] shrink-0 sm:w-[210px] xl:w-[230px] 2xl:w-[250px]"
              />
            ))}
          </div>
        </HorizontalScroller>
      </section>
    </PageFrame>
  );
}

function DiscoverRequestCard({ item, status, saved, onToggleSaved, delay = 0 }) {
  return (
    <article className="discover-card animate-reveal-up" style={{ animationDelay: `${delay}ms` }}>
      <Link to={`/title/${item.id}`} className="group block">
        <div className="relative aspect-[16/10] overflow-hidden rounded-md">
          <MediaImage className="absolute inset-0" imageClassName="transition-transform duration-300 group-hover:scale-105" src={item.backdrop} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/82 via-black/12 to-transparent" />
          <Badge className="absolute left-3 top-3 bg-black/55 text-white backdrop-blur-md">{status}</Badge>
          <div className="absolute bottom-3 left-3 right-3">
            <h3 className="animate-text-load truncate text-base font-black" style={{ animationDelay: `${delay + 80}ms` }}>
              {item.title}
            </h3>
            <p className="animate-text-load mt-0.5 text-xs text-white/62" style={{ animationDelay: `${delay + 130}ms` }}>
              {item.year} / {item.type} / {item.genres.join(", ")}
            </p>
          </div>
        </div>
      </Link>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground">
          <Star className="size-3 fill-primary text-primary" />
          {item.rating}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-8 rounded-md" onClick={onToggleSaved} aria-label="Save title">
            {saved ? <Check className="size-4" /> : <Bookmark className="size-4" />}
          </Button>
          <Button type="button" size="sm" variant={status === "Available" ? "secondary" : "outline"}>
            {status === "Available" ? "Watch" : "Request"}
          </Button>
        </div>
      </div>
    </article>
  );
}

function PageHeader({ eyebrow, title, description }) {
  return (
    <header className="animate-reveal-up border-b pb-5">
      <p className="animate-text-load text-xs font-black uppercase text-primary">{eyebrow}</p>
      <h1 className="animate-text-load mt-2 text-3xl font-black sm:text-5xl" style={{ animationDelay: "90ms" }}>
        {title}
      </h1>
      <p className="animate-text-load mt-3 max-w-2xl text-muted-foreground" style={{ animationDelay: "160ms" }}>
        {description}
      </p>
    </header>
  );
}

function EmptyState({ title }) {
  return (
    <div className="mt-10 grid min-h-[260px] place-items-center rounded-lg border bg-card text-center">
      <div>
        <Clapperboard className="mx-auto size-10 text-primary" />
        <h2 className="mt-4 text-xl font-bold">{title}</h2>
        <Button asChild className="mt-5">
          <Link to="/browse">Browse Library</Link>
        </Button>
      </div>
    </div>
  );
}

function TitlePage({ savedIds, toggleSaved, library, session }) {
  const { pathname } = useLocation();
  const id = pathname.split("/").pop();
  const baseItem = getLibraryTitle(id, library);
  const [detailState, setDetailState] = useState({ loading: Boolean(baseItem?.source === "jellyfin"), error: "", item: null });

  useEffect(() => {
    let active = true;

    async function loadDetails() {
      if (!session?.accessToken || baseItem?.source !== "jellyfin") {
        setDetailState({ loading: false, error: "", item: null });
        return;
      }

      setDetailState((current) => ({ ...current, loading: true, error: "" }));

      try {
        const data = await apiRequest(`/api/jellyfin/items/${encodeURIComponent(id)}`, { token: session.accessToken });
        if (!active) return;
        setDetailState({ loading: false, error: "", item: data.item });
      } catch (error) {
        if (!active) return;
        setDetailState({ loading: false, error: error.message, item: null });
      }
    }

    loadDetails();

    return () => {
      active = false;
    };
  }, [baseItem?.source, id, session?.accessToken]);

  const item = detailState.item || baseItem;

  if (!item) {
    return <Navigate to="/" replace />;
  }

  const related = getLibraryItems(library).filter((entry) => entry.id !== item.id && entry.genres.some((genre) => item.genres.includes(genre)));

  return (
    <PageFrame>
      {detailState.error && <LibraryNotice message={detailState.error} />}
      <section className="relative min-h-[580px] overflow-hidden rounded-lg border bg-card">
        <MediaImage src={item.backdrop} className="absolute inset-0" loading="eager" />
        <div className="media-mask absolute inset-0" />
        <div className="relative grid min-h-[580px] gap-8 p-5 sm:p-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-end lg:p-10">
          <MediaImage className="hidden aspect-[2/3] rounded-lg shadow-2xl lg:block" src={item.poster} />
          <div>
            <div className="animate-text-load flex flex-wrap gap-2">
              {item.genres.map((genre) => (
                <Badge key={genre} variant="secondary">
                  {genre}
                </Badge>
              ))}
            </div>
            <h1 className="animate-text-load mt-4 max-w-4xl text-4xl font-black leading-tight sm:text-6xl" style={{ animationDelay: "90ms" }}>
              {item.title}
            </h1>
            <div className="animate-text-load mt-3 flex flex-wrap gap-3 text-sm text-muted-foreground" style={{ animationDelay: "150ms" }}>
              <span>{item.year}</span>
              <span>{item.maturity}</span>
              <span>{item.duration}</span>
              <span className="inline-flex items-center gap-1 text-primary">
                <Star className="size-4 fill-current" />
                {item.rating}
              </span>
            </div>
            <p className="animate-text-load mt-4 max-w-3xl text-muted-foreground" style={{ animationDelay: "210ms" }}>
              {item.description}
            </p>
            <div className="animate-text-load mt-6 flex flex-wrap gap-3" style={{ animationDelay: "270ms" }}>
              <Button asChild size="lg">
                <Link to={`/watch/${item.id}`}>
                  <Play className="fill-current" />
                  Play
                </Link>
              </Button>
              <Button variant="outline" size="lg" onClick={() => toggleSaved(item.id)}>
                {savedIds.has(item.id) ? <Check /> : <Plus />}
                {savedIds.has(item.id) ? "Saved" : "My List"}
              </Button>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="secondary" size="lg">
                    <Film />
                    Trailer
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl p-0">
                  <DialogHeader className="p-5 pb-0">
                    <DialogTitle>{item.title} Trailer</DialogTitle>
                    <DialogDescription>Placeholder preview using production still imagery.</DialogDescription>
                  </DialogHeader>
                  <div className="relative aspect-video overflow-hidden rounded-b-lg">
                    <MediaImage className="absolute inset-0" src={item.backdrop} />
                    <div className="absolute inset-0 grid place-items-center bg-black/35">
                      <Button size="lg">
                        <Play className="fill-current" />
                        Play Trailer
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </section>

      {item.episodes.length > 0 && <EpisodeCarousel item={item} />}

      <MediaRow title="More Like This" items={related.slice(0, 6)} savedIds={savedIds} toggleSaved={toggleSaved} />
    </PageFrame>
  );
}

function EpisodeCarousel({ item }) {
  return (
    <section className="mt-8 animate-reveal-up">
      <HorizontalScroller
        header={<h2 className="animate-text-load text-xl font-bold">Episodes</h2>}
        action={
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to={`/watch/${item.episodes?.[0]?.id || item.id}`}>Resume</Link>
          </Button>
        }
      >
        <div className="flex gap-5 pb-4">
          {item.episodes.map((episode, index) => (
            <article
              key={episode.title}
              className="w-[280px] shrink-0 animate-reveal-up sm:w-[360px]"
              style={{ animationDelay: `${index * 45}ms` }}
            >
              <Link to={`/watch/${episode.id || item.id}`} className="group block">
                <div className="relative">
                  <MediaImage
                    className="aspect-video rounded-md"
                    imageClassName="transition-transform duration-300 group-hover:scale-105"
                    src={episode.backdrop || item.backdrop}
                  />
                  {episode.progress > 0 && (
                    <>
                      <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-xs font-bold text-white backdrop-blur">
                        {episode.progress >= 100 ? "Watched" : "Resume"}
                      </span>
                      <Progress
                        value={episode.progress}
                        className="absolute bottom-[5px] left-[5px] right-[5px] h-1.5 w-auto overflow-hidden rounded-full bg-black/55"
                      />
                    </>
                  )}
                </div>
                <div className="mt-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="animate-text-load truncate text-sm font-bold" style={{ animationDelay: `${index * 45 + 80}ms` }}>
                      {episode.title}
                    </h3>
                    <p className="animate-text-load mt-0.5 text-xs text-muted-foreground" style={{ animationDelay: `${index * 45 + 130}ms` }}>
                      E{episode.episodeNumber || index + 1} / {episode.runtime || episode.duration}
                    </p>
                  </div>
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-white text-black">
                    <Play className="size-4 fill-current" />
                  </span>
                </div>
              </Link>
            </article>
          ))}
        </div>
      </HorizontalScroller>
    </section>
  );
}

function timeToSeconds(value, fallback = 45 * 60) {
  const text = String(value || "");
  const hours = Number(text.match(/(\d+)\s*h/)?.[1] || 0);
  const minutes = Number(text.match(/(\d+)\s*m/)?.[1] || 0);
  const seconds = Number(text.match(/(\d+)\s*s/)?.[1] || 0);
  const total = hours * 3600 + minutes * 60 + seconds;

  return total || fallback;
}

function formatPlayerTime(value) {
  const safe = Math.max(0, Math.floor(value));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function PlayerControlButton({ children, label, active = false, className, ...props }) {
  return (
    <button type="button" className={cn("player-control", active && "is-active", className)} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

function getPlaybackItem(item) {
  if (!item?.episodes?.length) return item;
  return item.episodes.find((episode) => episode.progress > 0 && episode.progress < 100)
    || item.episodes.find((episode) => episode.progress < 100)
    || item.episodes[0]
    || item;
}

function WatchPage({ library, session }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const id = pathname.split("/").pop();
  const baseItem = getLibraryTitle(id, library);
  const playerRef = useRef(null);
  const videoRef = useRef(null);
  const [detailState, setDetailState] = useState({ loading: !baseItem && Boolean(session?.accessToken), error: "", item: null });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [volume, setVolume] = useState(72);
  const [muted, setMuted] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState("root");
  const [captions, setCaptions] = useState("English");
  const [voice, setVoice] = useState("Original");
  const [speed, setSpeed] = useState(1);
  const [pipActive, setPipActive] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [activityTick, setActivityTick] = useState(0);
  const [playerMenuContainer, setPlayerMenuContainer] = useState(null);
  const lastActivityRef = useRef(0);

  useEffect(() => {
    let active = true;

    async function loadItem() {
      if (!session?.accessToken || (baseItem && baseItem.source !== "jellyfin")) {
        setDetailState({ loading: false, error: "", item: null });
        return;
      }

      setDetailState((current) => ({ ...current, loading: true, error: "" }));

      try {
        const data = await apiRequest(`/api/jellyfin/items/${encodeURIComponent(id)}`, { token: session.accessToken });
        if (!active) return;
        setDetailState({ loading: false, error: "", item: data.item });
      } catch (error) {
        if (!active) return;
        setDetailState({ loading: false, error: error.message, item: null });
      }
    }

    loadItem();

    return () => {
      active = false;
    };
  }, [baseItem?.source, id, session?.accessToken]);

  const item = detailState.item || baseItem || media[0];
  const missingItem = !detailState.loading && !detailState.item && !baseItem;
  const playbackItem = getPlaybackItem(item);
  const episode = playbackItem?.id !== item.id ? playbackItem : { ...item, title: item.title, runtime: item.duration, progress: item.progress || 0 };
  const streamUrl = playbackItem?.streamUrl || item.streamUrl || "";
  const hasVideo = Boolean(streamUrl);
  const durationSeconds = mediaDuration || timeToSeconds(episode.runtime || episode.duration || item.duration);
  const startTime = Math.round(((episode.progress || item.progress || 0) / 100) * durationSeconds);
  const progressPercent = durationSeconds > 0 ? Math.min(100, (currentTime / durationSeconds) * 100) : 0;
  const effectiveVolume = muted ? 0 : volume;
  const controlsHidden = !controlsVisible && isPlaying && !statsOpen && !settingsOpen;
  const subtitleSamples = [
    "The signal is clean. Keep the relay open.",
    "Stay low. The city is listening now.",
    "If this reaches tomorrow, we still have time.",
  ];
  const subtitleText = subtitleSamples[Math.floor(currentTime / 7) % subtitleSamples.length];

  const revealControls = useCallback(() => {
    const now = Date.now();
    if (now - lastActivityRef.current < 120) return;

    lastActivityRef.current = now;
    setControlsVisible(true);
    setActivityTick((value) => value + 1);
  }, []);

  useEffect(() => {
    setCurrentTime(startTime);
    setMediaDuration(0);
    setIsPlaying(false);
    setControlsVisible(true);
  }, [playbackItem?.id, startTime]);

  useEffect(() => {
    setPlayerMenuContainer(playerRef.current);
  }, []);

  useEffect(() => {
    if (!isPlaying || hasVideo) return undefined;

    const timer = window.setInterval(() => {
      setCurrentTime((time) => {
        const next = Math.min(durationSeconds, time + speed);
        if (next >= durationSeconds) {
          setIsPlaying(false);
        }
        return next;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [durationSeconds, hasVideo, isPlaying, speed]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasVideo) return;

    if (isPlaying) {
      video.play().catch(() => setIsPlaying(false));
    } else {
      video.pause();
    }
  }, [hasVideo, isPlaying, streamUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasVideo) return;

    video.volume = Math.max(0, Math.min(1, effectiveVolume / 100));
    video.muted = muted || effectiveVolume === 0;
    video.playbackRate = speed;
  }, [effectiveVolume, hasVideo, muted, speed]);

  useEffect(() => {
    if (!isPlaying || statsOpen || settingsOpen) {
      setControlsVisible(true);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setControlsVisible(false);
    }, 2600);

    return () => window.clearTimeout(timer);
  }, [activityTick, isPlaying, settingsOpen, statsOpen]);

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", updateFullscreen);

    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
      } else {
        await playerRef.current?.requestFullscreen?.();
      }
    } catch {
      setFullscreen((value) => !value);
    }
  };

  if (missingItem) {
    return <Navigate to="/" replace />;
  }

  return (
    <div
      ref={playerRef}
      className={cn("player-watch min-h-screen bg-black text-white", controlsHidden && "is-idle")}
      onMouseMove={revealControls}
      onPointerDown={revealControls}
      onTouchStart={revealControls}
    >
      <div className="relative min-h-screen">
        {hasVideo ? (
          <video
            ref={videoRef}
            className="player-backdrop absolute inset-0 size-full object-cover"
            poster={playbackItem.backdrop || item.backdrop}
            src={streamUrl}
            playsInline
            onLoadedMetadata={(event) => {
              const duration = event.currentTarget.duration;
              if (Number.isFinite(duration)) {
                setMediaDuration(duration);
                if (startTime > 0 && event.currentTarget.currentTime < 1) {
                  event.currentTarget.currentTime = startTime;
                  setCurrentTime(startTime);
                }
              }
            }}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onEnded={() => setIsPlaying(false)}
          />
        ) : (
          <MediaImage className="player-backdrop absolute inset-0" imageClassName="scale-[1.02]" src={item.backdrop} loading="eager" />
        )}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.08),rgba(0,0,0,0.55)_62%,rgba(0,0,0,0.9)_100%)]" />
        <div className="player-overlay player-overlay-top absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/85 to-transparent" />

        <header className="player-overlay player-overlay-top absolute left-0 right-0 top-0 z-30 p-4 sm:p-6 lg:p-8">
          <button type="button" className="inline-flex max-w-full items-center gap-3 text-left text-white transition-opacity hover:opacity-75" onClick={() => navigate(-1)}>
            <span className="grid size-9 shrink-0 place-items-center">
              <ChevronLeft className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-black sm:text-base">{item.title}</span>
              <span className="block truncate text-xs text-white/60">{episode.title}</span>
            </span>
          </button>
        </header>

        {captions !== "Off" && (
          <div className="player-subtitles" aria-live="polite">
            <span>{subtitleText}</span>
          </div>
        )}

        <main className="player-overlay player-overlay-bottom absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black via-black/78 to-transparent p-4 pt-24 sm:p-6 sm:pt-28 lg:p-8 lg:pt-32">
          <input
            aria-label="Playback position"
            className="player-progress"
            max={durationSeconds}
            min="0"
            onChange={(event) => {
              const next = Number(event.target.value);
              setCurrentTime(next);
              if (videoRef.current && hasVideo) {
                videoRef.current.currentTime = next;
              }
            }}
            style={{ "--progress": `${progressPercent}%` }}
            type="range"
            value={currentTime}
          />

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <PlayerControlButton label={isPlaying ? "Pause" : "Play"} className="size-12" onClick={() => setIsPlaying((value) => !value)}>
                {isPlaying ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current" />}
              </PlayerControlButton>
              <div className="player-volume-inline">
                <PlayerControlButton
                  className="player-volume-button"
                  label={muted || volume === 0 ? "Unmute" : "Mute"}
                  onClick={() => {
                    if (volume === 0) {
                      setVolume(72);
                      setMuted(false);
                    } else {
                      setMuted((value) => !value);
                    }
                  }}
                >
                  {effectiveVolume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </PlayerControlButton>
                <input
                  aria-label="Volume"
                  className="player-volume-horizontal"
                  max="100"
                  min="0"
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setVolume(next);
                    setMuted(next === 0);
                  }}
                  style={{ "--volume": `${effectiveVolume}%` }}
                  type="range"
                  value={effectiveVolume}
                />
              </div>
              <span className="player-time-chip" aria-label={`${formatPlayerTime(currentTime)} elapsed, ${formatPlayerTime(durationSeconds)} total`}>
                <span className="player-time-current">{formatPlayerTime(currentTime)}</span>
                <span className="player-time-divider">/</span>
                <span className="player-time-duration">{formatPlayerTime(durationSeconds)}</span>
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
              <DropdownMenu
                open={statsOpen}
                onOpenChange={(open) => {
                  setStatsOpen(open);
                  if (open) {
                    setSettingsOpen(false);
                  }
                }}
              >
                <DropdownMenuTrigger asChild>
                  <PlayerControlButton active={statsOpen} aria-pressed={statsOpen} label="Playback stats">
                    <Info className="size-4" />
                  </PlayerControlButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent container={playerMenuContainer} side="top" align="end" sideOffset={14} className="player-dropdown w-[320px] p-3">
                  <DropdownMenuLabel className="flex items-center gap-2 px-1 text-white">
                    <Info className="size-4 text-white/55" />
                    Playback stats
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <div className="grid gap-2 px-1 py-1 text-xs">
                    {[
                      ["Stream", "HLS / adaptive"],
                      ["Resolution", "1920x1080"],
                      ["Video codec", "H.264 AVC"],
                      ["Audio", `${voice} / stereo`],
                      ["Transcoding", "1080p ready"],
                      ["Bitrate", "8.2 Mbps"],
                      ["Buffer", "38 seconds"],
                      ["CDN edge", "Amsterdam"],
                      ["Dropped frames", "0"],
                      ["Playback speed", `${speed}x`],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-4">
                        <span className="text-white/42">{label}</span>
                        <span className="font-bold text-white/78">{value}</span>
                      </div>
                    ))}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu
                open={settingsOpen}
                onOpenChange={(open) => {
                  setSettingsOpen(open);
                  setSettingsPanel("root");
                  if (open) {
                    setStatsOpen(false);
                  }
                }}
              >
                <DropdownMenuTrigger asChild>
                  <PlayerControlButton active={settingsOpen} aria-pressed={settingsOpen} label="Playback settings">
                    <Settings className="size-4" />
                  </PlayerControlButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent container={playerMenuContainer} side="top" align="end" sideOffset={14} className="player-dropdown w-[230px] p-2">
                  {settingsPanel === "root" ? (
                    <>
                      <DropdownMenuLabel className="flex items-center gap-2 text-white">
                        <Settings className="size-4 text-white/55" />
                        Playback settings
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator className="bg-white/10" />
                      <button type="button" className="player-menu-button" onClick={() => setSettingsPanel("captions")}>
                        <Captions className="size-4 text-white/55" />
                        Captions
                        <span className="flex-1 text-right text-xs text-white/42">{captions}</span>
                        <ChevronLeft className="size-4 rotate-180 text-white/35" />
                      </button>
                      <button type="button" className="player-menu-button" onClick={() => setSettingsPanel("voice")}>
                        <Volume2 className="size-4 text-white/55" />
                        Voice
                        <span className="flex-1 text-right text-xs text-white/42">{voice}</span>
                        <ChevronLeft className="size-4 rotate-180 text-white/35" />
                      </button>
                      <button type="button" className="player-menu-button" onClick={() => setSettingsPanel("speed")}>
                        <Gauge className="size-4 text-white/55" />
                        Speed
                        <span className="flex-1 text-right text-xs text-white/42">{speed}x</span>
                        <ChevronLeft className="size-4 rotate-180 text-white/35" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="player-menu-button" onClick={() => setSettingsPanel("root")}>
                        <ChevronLeft className="size-4 text-white/55" />
                        {settingsPanel === "captions" && "Captions"}
                        {settingsPanel === "voice" && "Voice"}
                        {settingsPanel === "speed" && "Speed"}
                      </button>
                      <DropdownMenuSeparator className="bg-white/10" />
                      {settingsPanel === "captions" && (
                        <DropdownMenuRadioGroup value={captions} onValueChange={setCaptions}>
                          {["Off", "English", "Dutch"].map((option) => (
                            <DropdownMenuRadioItem key={option} value={option} className="player-radio-item" onSelect={(event) => event.preventDefault()}>
                              {option}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      )}
                      {settingsPanel === "voice" && (
                        <DropdownMenuRadioGroup value={voice} onValueChange={setVoice}>
                          {["Original", "JP", "Commentary"].map((option) => (
                            <DropdownMenuRadioItem key={option} value={option} className="player-radio-item" onSelect={(event) => event.preventDefault()}>
                              {option}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      )}
                      {settingsPanel === "speed" && (
                        <DropdownMenuRadioGroup value={String(speed)} onValueChange={(value) => setSpeed(Number(value))}>
                          {[0.75, 1, 1.25, 1.5].map((option) => (
                            <DropdownMenuRadioItem key={option} value={String(option)} className="player-radio-item" onSelect={(event) => event.preventDefault()}>
                              {option}x
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      )}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <PlayerControlButton active={pipActive} aria-pressed={pipActive} label="Picture in picture" onClick={() => setPipActive((value) => !value)}>
                <PictureInPicture2 className="size-4" />
              </PlayerControlButton>
              <PlayerControlButton active={fullscreen} aria-pressed={fullscreen} label="Fullscreen" onClick={toggleFullscreen}>
                <Maximize2 className="size-4" />
              </PlayerControlButton>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
