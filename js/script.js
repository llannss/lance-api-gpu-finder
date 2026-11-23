// ============================================
// GPU Finder
// Shared API, homepage, modal, chat, and compare logic
// ============================================

// The site's vercel.json rewrites /api/* to the GPU Finder API, so the
// browser treats the API as the same site. The login lives in an HttpOnly
// cookie the API sets; page scripts never see the token.
const API_URL = "/api";

// One drawn icon set (24px grid, 1.8 stroke, currentColor), matching the
// sidebar icons. Text symbols render differently on every system.
const ICON_PATHS = {
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    star: '<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/>',
    swap: '<path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3"/>',
    logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
    gamepad: '<rect x="2.5" y="7" width="19" height="11" rx="4"/><path d="M7 10.5v4M5 12.5h4M15.5 11.5h.01M18 13.5h.01"/>',
    devices: '<rect x="3" y="5" width="13" height="10" rx="1.5"/><path d="M7 19h5M9.5 15v4"/><rect x="17.5" y="9" width="4" height="10" rx="1"/>'
};

function iconSVG(name, className = "icon") {
    return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
}

const DASHBOARD_REFRESH_MS = 60_000;
const FAVORITES_KEY = "gpuFinderFavorites";

let currentGPUs = [];
let gpuTrendChart = null;
let refreshTimer = null;

let compareGPUs = [];
let compareGpuA = null;
let compareGpuB = null;

const $ = (id) => document.getElementById(id);

// Hidden until the session check finishes (see the START section), so a
// signed-out visitor never sees an empty page flash before the redirect.
document.documentElement.classList.add("auth-checking");

// Text cut short with an ellipsis or a line clamp (long model names on the
// podium, in tables, in Recently viewed) shows its full text on hover.
document.addEventListener(
    "pointerover",
    (event) => {
        const el = event.target;
        if (!(el instanceof HTMLElement) || el.title || el.children.length) return;
        const cut = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
        if (cut && el.textContent.trim()) el.title = el.textContent.trim().replace(/\s+/g, " ");
    },
    { passive: true }
);

// Any GPU picture that fails to load is hidden, and its frame shows the
// drawn picture icon instead of the browser's broken-image icon and alt
// text. One listener replaces inline onerror="", which the CSP blocks.
document.addEventListener(
    "error",
    (event) => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement)) return;
        if (img.closest(".profile-menu, .logo")) return;
        img.style.display = "none";
        img.parentElement?.classList.add("has-missing-image");
    },
    true
);


// ============================================
// API
// ============================================

// Every API call goes through here. It sends the session cookie, adds the
// header the API requires on cookie-authenticated writes, and sends the
// visitor to the sign-in page when the session is missing or expired.
async function apiFetch(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
        credentials: "same-origin",
        ...options,
        headers: {
            Accept: "application/json",
            "X-Requested-With": "fetch",
            ...(options.headers || {})
        }
    });

    if (response.status === 401) {
        redirectToSignIn();
        throw new Error("Not signed in.");
    }

    return response;
}

let redirectingToSignIn = false;

function redirectToSignIn() {
    if (redirectingToSignIn) return;
    redirectingToSignIn = true;

    const here =
        location.pathname.split("/").pop() +
        location.search;

    location.replace(
        `signin.html?next=${encodeURIComponent(here || "index.html")}`
    );
}

let currentAccount = null;
// Resolves to the signed-in account (or null) once /auth/me has answered.
let accountReady = Promise.resolve(null);

async function loadAccount() {
    const response = await apiFetch("/auth/me", { cache: "no-store" });

    if (!response.ok) {
        throw new Error(`Account request failed (${response.status})`);
    }

    currentAccount = await response.json();
    renderAccountBox(currentAccount);
    return currentAccount;
}

// Profile menu in the top bar: an avatar button that opens a small panel
// with the account, a link to saved favorites, and sign-out options.
function renderAccountBox(account) {
    const topbar = document.querySelector(".topbar");

    if (!topbar || $("profileMenu")) return;

    const initial = (account.email || "?").charAt(0).toUpperCase();
    const isAdmin = account.role === "admin";

    const wrap = document.createElement("div");
    wrap.className = "profile";
    wrap.id = "profileMenu";

    // ----- the button -----
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "profile-trigger";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", "profilePanel");
    trigger.title = account.email;

    const avatar = document.createElement("span");
    avatar.className = "profile-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = initial;

    const name = document.createElement("span");
    name.className = "profile-name";
    name.textContent = account.email.split("@")[0];

    const caret = document.createElement("span");
    caret.className = "profile-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.innerHTML = iconSVG("chevronDown");

    trigger.append(avatar, name, caret);

    // ----- the panel -----
    const panel = document.createElement("div");
    panel.className = "profile-panel";
    panel.id = "profilePanel";
    panel.setAttribute("role", "menu");
    panel.hidden = true;

    const head = document.createElement("div");
    head.className = "profile-head";

    const bigAvatar = avatar.cloneNode(true);
    bigAvatar.classList.add("is-large");

    const who = document.createElement("div");
    who.className = "profile-who";
    const email = document.createElement("strong");
    email.textContent = account.email;
    const role = document.createElement("span");
    role.className = "profile-role" + (isAdmin ? " is-admin" : "");
    role.textContent = isAdmin ? "Admin" : "Member";
    who.append(email, role);
    head.append(bigAvatar, who);

    const item = (label, icon, onSelect, extra) => {
        const el = document.createElement(onSelect.href ? "a" : "button");
        el.className = "profile-item" + (extra?.danger ? " is-danger" : "");
        el.setAttribute("role", "menuitem");
        if (onSelect.href) {
            el.href = onSelect.href;
        } else {
            el.type = "button";
            el.addEventListener("click", onSelect);
        }
        const i = document.createElement("span");
        i.className = "profile-item-icon";
        i.setAttribute("aria-hidden", "true");
        i.innerHTML = iconSVG(icon);
        const t = document.createElement("span");
        t.textContent = label;
        el.append(i, t);
        if (extra?.badgeId) {
            const b = document.createElement("span");
            b.className = "profile-count";
            b.id = extra.badgeId;
            el.append(b);
        }
        return el;
    };

    const divider = () => {
        const hr = document.createElement("div");
        hr.className = "profile-divider";
        return hr;
    };

    panel.append(
        head,
        divider(),
        item("My favorites", "heart", { href: "favorites.html" }, { badgeId: "favoriteCount" }),
        item("Recently viewed", "clock", { href: "index.html#recentPanel" }),
        item("Saved comparisons", "star", { href: "compare.html#savedComparisons" }),
        divider(),
        item("Play GPU Guessr", "gamepad", { href: "/arena/" }),
        divider(),
        item("Sign out", "logout", signOutHere),
        item("Sign out on all devices", "devices", signOutEverywhere, { danger: true })
    );

    wrap.append(trigger, panel);
    topbar.append(wrap);

    // ----- open / close -----
    const setOpen = (open) => {
        panel.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
        if (open) panel.querySelector(".profile-item")?.focus();
    };

    trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        setOpen(panel.hidden);
    });

    document.addEventListener("click", (event) => {
        if (!wrap.contains(event.target)) setOpen(false);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !panel.hidden) {
            setOpen(false);
            trigger.focus();
        }
    });

    updateFavoriteCount();
}

function updateFavoriteCount() {
    const badge = $("favoriteCount");
    if (!badge) return;
    const count = favoriteIds.size;
    badge.textContent = count ? String(count) : "";
    badge.hidden = !count;
}

async function signOutHere() {
    try {
        await fetch(`${API_URL}/auth/logout`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-Requested-With": "fetch" }
        });
    } finally {
        location.replace("signin.html");
    }
}

async function signOutEverywhere() {
    if (!confirm("Sign out of GPU Nexus on every device?")) return;

    try {
        await apiFetch("/auth/logout-all", { method: "POST" });
    } finally {
        location.replace("signin.html");
    }
}

// Every page's setup code (global search, dashboard, browse, compare,
// analytics, rankings, details) asks for the GPU list on load. Share one
// in-flight/recent request between them instead of hitting the API once
// per caller. Responses younger than GPU_CACHE_MS are reused.
const GPU_CACHE_MS = 30_000;
let gpuRequest = null;
let gpuRequestTime = 0;

async function fetchGPUs({ force = false } = {}) {
    const isFresh =
        gpuRequest &&
        Date.now() - gpuRequestTime < GPU_CACHE_MS;

    if (force || !isFresh) {
        gpuRequestTime = Date.now();
        gpuRequest = requestGPUs().catch((error) => {
            // Don't cache failures, so Retry actually retries.
            gpuRequest = null;
            throw error;
        });
    }

    // Copy so a caller sorting/filtering in place can't affect others.
    return [...(await gpuRequest)];
}

// Call after changing a GPU so the next fetchGPUs() reads fresh data.
function invalidateGpuCache() {
    gpuRequest = null;
}

async function requestGPUs() {
    const response = await apiFetch("/gpus", {
        method: "GET",
        cache: "no-store"
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.detail ||
            data.error ||
            `GPU API request failed (${response.status})`
        );
    }

    const list =
        (Array.isArray(data) && data) ||
        (Array.isArray(data.gpus) && data.gpus) ||
        (Array.isArray(data.data) && data.data) ||
        (Array.isArray(data.results) && data.results) ||
        [];

    return list.map(normalizeGpu);
}

// Clean up values the catalog can hold but the pages shouldn't show as fact:
// a launch price of 0 or less means "unknown", not free.
function normalizeGpu(gpu) {
    if (!gpu || typeof gpu !== "object") return gpu;
    const price = Number(gpu.launch_price_usd);
    if (gpu.launch_price_usd != null && !(price > 0)) {
        return { ...gpu, launch_price_usd: null };
    }
    return gpu;
}


// ============================================
// HOMEPAGE DASHBOARD
// ============================================

function hasDashboard() {
    return Boolean(
        $("featuredGPUs") ||
        $("brandOverview") ||
        $("performanceChart")
    );
}

async function refreshDashboard() {
    try {
        const gpus = await fetchGPUs();
        currentGPUs = gpus;

        renderFeaturedGPUs(gpus);
        renderBrandOverview(gpus);

        renderPerformanceChart(
            gpus,
            $("performanceMetric")?.value || "memory_bandwidth_gbps"
        );

    } catch (error) {
        console.error("GPU dashboard error:", error);
        renderDashboardError();
    }
}

function renderDashboardError() {
    const gpuGrid = $("featuredGPUs");

    if (gpuGrid) {
        gpuGrid.innerHTML = `
            <div class="empty-state">
                <div>
                    <strong>Couldn't load the GPU catalog.</strong>

                    <p>
                        Check your connection, then try again.
                    </p>

                    <button
                        type="button"
                        id="retryGpuLoad"
                    >
                        Retry
                    </button>
                </div>
            </div>
        `;

        $("retryGpuLoad")?.addEventListener(
            "click",
            refreshDashboard
        );
    }

    $("performanceChart")?.classList.add("has-error");
}


// ============================================
// LOAD ERRORS: one failure state for every Finder page
// ============================================

// Says what failed and gives a Retry that checks the server first, so a
// second failure updates the message instead of reloading into the same error.
function showLoadError(target, {
    title = "Couldn't load the GPU catalog.",
    detail = "The server didn't answer. Check your connection, then try again.",
    probe = () => fetchGPUs({ force: true }),
    onRecover = () => window.location.reload(),
    replace = false
} = {}) {
    if (!target) return;

    target.querySelector(":scope > .load-error")?.remove();

    const box = document.createElement("div");
    box.className = "load-error";
    box.setAttribute("role", "alert");
    box.innerHTML = `
        <svg class="load-error-fan" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="24" cy="24" r="19"/>
            <circle cx="24" cy="24" r="3.5"/>
            <path d="M24 20.5c-1-5 1-9.5 6-11M27.4 25c4.8 1.8 7.6 5.7 7 11M20.6 25.6c-3.8 3.3-8.6 3.9-13 1"/>
        </svg>
        <div>
            <strong></strong>
            <p></p>
        </div>
        <button type="button" class="primary-btn load-error-retry">Retry</button>
    `;
    box.querySelector("strong").textContent = title;
    box.querySelector("p").textContent = detail;

    const retry = box.querySelector("button");
    retry.addEventListener("click", async () => {
        retry.disabled = true;
        retry.textContent = "Retrying…";
        try {
            await probe();
            onRecover();
        } catch {
            retry.disabled = false;
            retry.textContent = "Retry";
            box.querySelector("p").textContent =
                "Still no answer from the server. Wait a few seconds and try again.";
        }
    });

    if (replace) {
        target.replaceChildren(box);
    } else {
        // page-level: just under the search bar
        const topbar = target.querySelector(":scope > .topbar");
        topbar ? topbar.after(box) : target.prepend(box);
    }
}


// ============================================
// FEATURED GPUs
// ============================================

// Featured picks are earned from the data, not hand-picked. Each badge has
// a rule; a GPU can only win one badge, so four different cards show up.
const FEATURE_PICKS = [
    {
        text: "Best Overall",
        className: "badge-green",
        // Strongest card: most memory bandwidth, then most VRAM, then newest.
        pick: (pool) => maxBy(pool, (g) => [bandwidthOf(g), parseVramGb(g.vram) || 0, getReleaseTimestamp(g)]),
        reason: (g) => `Highest memory bandwidth: ${bandwidthOf(g).toLocaleString()} GB/s`
    },
    {
        text: "Best Value",
        className: "badge-blue",
        // Most bandwidth per dollar, among cards from the last ~4 years of
        // the catalog so a decade-old bargain doesn't win.
        pick: (pool, all) => {
            const newest = Math.max(...all.map(getReleaseTimestamp).filter(Number.isFinite));
            const recentSince = newest - 4 * 365 * 24 * 3600 * 1000;
            const candidates = pool.filter((g) =>
                priceOf(g) > 0 && bandwidthOf(g) > 0 && getReleaseTimestamp(g) >= recentSince
            );
            return maxBy(candidates, (g) => [bandwidthOf(g) / priceOf(g), -priceOf(g)]);
        },
        reason: (g) => `${(bandwidthOf(g) / priceOf(g)).toFixed(2)} GB/s of bandwidth per dollar`
    },
    {
        text: "Creator Pick",
        className: "badge-purple",
        // Video, 3D and AI work need memory: most VRAM, then bandwidth.
        pick: (pool) => maxBy(pool, (g) => [parseVramGb(g.vram) || 0, bandwidthOf(g)]),
        reason: (g) => `${parseVramGb(g.vram)}GB of VRAM for video, 3D and AI work`
    },
    {
        text: "Rising Star",
        className: "badge-orange",
        // Newest release in the catalog.
        pick: (pool) => maxBy(pool, (g) => [getReleaseTimestamp(g), Number(g.id) || 0]),
        reason: (g, all) => {
            const newest = Math.max(...all.map(getReleaseTimestamp).filter(Number.isFinite));
            return getReleaseTimestamp(g) >= newest
                ? `Newest in the catalog, released ${g.release_date}`
                : `Newest card not already featured, released ${g.release_date}`;
        }
    }
];

function bandwidthOf(gpu) {
    const n = Number(gpu.memory_bandwidth_gbps);
    return Number.isFinite(n) ? n : 0;
}

function priceOf(gpu) {
    const n = Number(gpu.launch_price_usd);
    return gpu.launch_price_usd == null || !Number.isFinite(n) ? 0 : n;
}

// The item with the largest key; keys are arrays compared left to right.
function maxBy(items, key) {
    let best = null;
    let bestKey = null;

    for (const item of items) {
        const k = key(item).map((v) => (Number.isFinite(v) ? v : -Infinity));
        const better = !bestKey || k.some((v, i) =>
            k.slice(0, i).every((w, j) => w === bestKey[j]) && v > bestKey[i]
        );
        if (better) {
            best = item;
            bestKey = k;
        }
    }
    return best;
}

function pickFeaturedGPUs(gpus) {
    const picked = [];

    for (const rule of FEATURE_PICKS) {
        const pool = gpus.filter((g) => !picked.some((p) => p.gpu === g));
        const gpu = rule.pick(pool, gpus);
        if (gpu) {
            picked.push({ gpu, badge: { ...rule, reason: rule.reason(gpu, gpus) } });
        }
    }
    return picked;
}

function renderFeaturedGPUs(gpus) {
    const gpuGrid = $("featuredGPUs");

    if (!gpuGrid) return;

    gpuGrid.innerHTML = "";

    if (!gpus.length) {
        gpuGrid.innerHTML = `
            <div class="empty-state">
                The GPU catalog is empty right now.
            </div>
        `;

        return;
    }

    pickFeaturedGPUs(gpus).forEach(({ gpu, badge }) => {
        gpuGrid.appendChild(
            createFeaturedGpuCard(gpu, badge)
        );
    });
}

function createFeaturedGpuCard(gpu, badge) {
    const card = document.createElement("article");

    card.className = "gpu-card";

    const brand =
        gpu.brand ||
        "GPU";

    const model =
        gpu.model ||
        "Unknown GPU";

    const vram =
        gpu.vram ||
        "--";

    const description =
        gpu.description ||
        `${gpu.architecture || "High-performance"} graphics card.`;

    const price =
        getLaunchPrice(gpu);

    const imagePath =
        getImageFile(gpu);

    const isFavorite =
        getFavoriteIds().has(
            String(gpu.id)
        );

    card.innerHTML = `
        <div class="gpu-card-top">

            ${badge === false ? "<span></span>" : `<span
                class="gpu-badge ${badge?.className || "badge-blue"}"
                title="${escapeHTML(badge?.reason || "")}"
            >
                ${escapeHTML(
                    badge?.text || "Featured"
                )}
            </span>`}

            <button
                class="gpu-favorite ${
                    isFavorite
                        ? "active"
                        : ""
                }"
                type="button"
                data-gpu-id="${escapeHTML(
                    String(gpu.id ?? "")
                )}"
                aria-pressed="${isFavorite}"
            >
                ${iconSVG("heart")}
            </button>

        </div>

        <div class="gpu-image-wrapper">

            <div class="gpu-image-placeholder">
                GPU
            </div>

            <img
                src="${escapeHTML(imagePath)}"
                alt="${escapeHTML(`${brand} ${model}`)}"
                class="gpu-image"
                loading="lazy"
            >

        </div>

        <div class="gpu-card-body">

            <h3>
                ${escapeHTML(model)}
            </h3>

            <p class="gpu-memory">
                ${escapeHTML(vram)}
            </p>

            ${badge?.reason ? `<p class="gpu-pick-reason">${escapeHTML(badge.reason)}</p>` : ""}

            <p class="gpu-description">
                ${escapeHTML(description)}
            </p>

            <div class="gpu-price">
                ${escapeHTML(price)}
            </div>

            <button
                class="gpu-details-button"
                type="button"
                data-gpu-id="${escapeHTML(
                    String(gpu.id ?? "")
                )}"
            >
                View Details
                ${iconSVG("arrowRight")}
            </button>

        </div>
    `;

    const image =
        card.querySelector(".gpu-image");

    image?.addEventListener(
        "load",
        () => {
            card.classList.add("image-loaded");
        }
    );

    image?.addEventListener(
        "error",
        () => {
            image.remove();
        }
    );

    card
        .querySelector(".gpu-favorite")
        ?.addEventListener(
            "click",
            (event) => {
                toggleFavorite(
                    event.currentTarget,
                    gpu.id
                );
            }
        );

    card
        .querySelector(".gpu-details-button")
        ?.addEventListener(
            "click",
            () => {
                openGpuDetails(gpu);
            }
        );

    return card;
}


// ============================================
// SHARED GPU HELPERS
// ============================================

// Pictures uploaded by admins live in Supabase Storage. Only URLs from that
// bucket are used; anything else falls back to the bundled local image.
const GPU_IMAGE_BUCKET =
    "https://irchyhaoodwsumlfsbbc.supabase.co/storage/v1/object/public/gpu-images/";

function getImageFile(gpu) {

    if (
        typeof gpu.image_url === "string" &&
        gpu.image_url.startsWith(GPU_IMAGE_BUCKET)
    ) {
        return gpu.image_url;
    }

    const shortModel =
        String(gpu.model || "gpu")

            .replace(
                /^GeForce\s+/i,
                ""
            )

            .replace(
                /^Radeon\s+/i,
                ""
            )

            .replace(
                /^Intel\s+/i,
                ""
            )

            .toLowerCase()

            .replace(
                /[^a-z0-9]+/g,
                "-"
            )

            .replace(
                /^-|-$/g,
                ""
            );


    return `images/${shortModel}.png`;
}


function getLaunchPrice(gpu) {
    if (gpu.launch_price) {
        return String(
            gpu.launch_price
        );
    }

    const numeric =
        Number(
            gpu.launch_price_usd ??
            gpu.price ??
            gpu.msrp
        );

    return Number.isFinite(numeric) && numeric > 0
        ? `$${numeric.toLocaleString()}`
        : "Price unavailable";
}


// ---------- favorites (saved to the account) ----------
// The API keeps each account's favorites, so they follow the user to any
// browser or device. Hearts saved by the old version in this browser's
// localStorage are moved into the account once, then cleared.

let favoriteIds = new Set();      // GPU IDs as strings
let favoritesLoaded = false;

function getFavoriteIds() {
    return favoriteIds;
}

async function loadFavorites() {
    try {
        const response = await apiFetch("/me/favorites", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        favoriteIds = new Set((data.gpu_ids || []).map(String));
        await importLegacyFavorites();
        favoritesLoaded = true;
        document.dispatchEvent(new CustomEvent("favorites-loaded"));
    } catch (error) {
        console.error("Favorites failed to load:", error);
    }
    syncFavoriteButtons();
    updateFavoriteCount();
}

async function importLegacyFavorites() {
    let legacy = [];
    try {
        legacy = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    } catch {
        legacy = [];
    }
    if (!Array.isArray(legacy) || !legacy.length) return;

    for (const id of legacy.map(String)) {
        if (!/^\d+$/.test(id) || favoriteIds.has(id)) continue;
        try {
            const response = await apiFetch(`/me/favorites/${id}`, { method: "PUT" });
            if (response.ok) favoriteIds.add(id);
        } catch {
            return;   // try again next visit
        }
    }
    try {
        localStorage.removeItem(FAVORITES_KEY);
    } catch {
        // storage blocked: nothing to clean up
    }
}

// ---------- favorites page (favorites.html) ----------

async function setupFavoritesPage() {
    const grid = $("favoritesGrid");
    if (!grid) return;

    const account = await accountReady;
    if (!account) return;

    let gpus = [];
    try {
        const response = await apiFetch("/me/favorites", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        gpus = (await response.json()).gpus || [];
    } catch {
        showLoadError(grid, {
            title: "Couldn't load your favorites.",
            probe: async () => {
                const r = await apiFetch("/me/favorites", { cache: "no-store" });
                if (!r.ok) throw new Error(String(r.status));
            },
            replace: true
        });
        return;
    }

    const render = () => {
        const saved = gpus.filter((g) => favoriteIds.has(String(g.id)) || !favoritesLoaded);
        const summary = $("favoritesSummary");
        if (summary) {
            summary.textContent = saved.length
                ? `${saved.length} saved GPU${saved.length === 1 ? "" : "s"}, synced to your account on every device.`
                : "Saved to your account, on every device you sign in to.";
        }

        grid.replaceChildren();
        if (!saved.length) {
            const empty = document.createElement("div");
            empty.className = "empty-state favorites-empty";
            const title = document.createElement("strong");
            title.textContent = "No favorites yet";
            const text = document.createElement("p");
            text.textContent = "Tap the heart on any GPU to save it here.";
            const link = document.createElement("a");
            link.className = "primary-btn";
            link.href = "browse.html";
            link.innerHTML = `Browse GPUs ${iconSVG("arrowRight")}`;
            empty.append(title, text, link);
            grid.append(empty);
            return;
        }
        for (const gpu of saved) {
            grid.append(createFeaturedGpuCard(gpu, false)); // the filled heart already says it is saved
        }
    };

    render();
    // Un-hearting a card here takes it off the page.
    document.addEventListener("favorites-changed", render);
    document.addEventListener("favorites-loaded", render);
}

// Paint every heart on the page from the saved list.
function syncFavoriteButtons() {
    for (const button of document.querySelectorAll(".gpu-favorite[data-gpu-id]")) {
        paintFavoriteButton(button, favoriteIds.has(button.dataset.gpuId));
    }
}

function paintFavoriteButton(button, active) {
    button.classList.toggle("active", active);
    if (!button.querySelector("svg")) button.innerHTML = iconSVG("heart");
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", active ? "Remove from favorites" : "Save to favorites");
    button.title = active ? "Saved to your favorites" : "Save to favorites";
}

async function toggleFavorite(button, gpuId) {
    const id = String(gpuId ?? "");
    if (!/^\d+$/.test(id) || button.disabled) return;

    const adding = !favoriteIds.has(id);

    // Show the change at once, then save it; undo if the save fails.
    adding ? favoriteIds.add(id) : favoriteIds.delete(id);
    syncFavoriteButtons();
    updateFavoriteCount();
    button.disabled = true;

    try {
        const response = await apiFetch(`/me/favorites/${id}`, { method: adding ? "PUT" : "DELETE" });
        if (!response.ok) throw new Error(String(response.status));
        document.dispatchEvent(new CustomEvent("favorites-changed"));
    } catch {
        adding ? favoriteIds.delete(id) : favoriteIds.add(id);
        syncFavoriteButtons();
        updateFavoriteCount();
        button.title = "Couldn't save. Try again.";
    } finally {
        button.disabled = false;
    }
}


// ============================================
// RECENTLY VIEWED (saved to the account)
// ============================================

// Called whenever a GPU is opened. Fire and forget: a failed save never
// gets in the way of looking at the GPU.
function recordRecentView(gpuId) {
    if (!/^\d+$/.test(String(gpuId ?? ""))) return;
    accountReady.then((account) => {
        if (!account) return;
        apiFetch(`/me/recent/${gpuId}`, { method: "POST" }).catch(() => {});
    });
}

async function renderRecentlyViewed() {
    const panel = $("recentPanel");
    const strip = $("recentStrip");
    if (!panel || !strip) return;

    const account = await accountReady;
    if (!account) return;

    let gpus = [];
    try {
        const response = await apiFetch("/me/recent?limit=10", { cache: "no-store" });
        if (!response.ok) return;
        gpus = (await response.json()).gpus || [];
    } catch {
        return;
    }

    panel.hidden = gpus.length === 0;
    strip.replaceChildren();

    for (const gpu of gpus) {
        const link = document.createElement("a");
        link.className = "recent-card";
        link.href = `gpu.html?id=${encodeURIComponent(gpu.id)}`;

        const frame = document.createElement("span");
        frame.className = "recent-image";
        const img = document.createElement("img");
        img.src = getImageFile(gpu);
        img.alt = "";
        img.loading = "lazy";
        img.setAttribute("data-hide-on-error", "");
        frame.append(img);

        const name = document.createElement("strong");
        name.textContent = gpu.model || "GPU";

        const meta = document.createElement("small");
        meta.textContent = [gpu.vram, getLaunchPrice(gpu)].filter(Boolean).join(" · ");

        link.append(frame, name, meta);
        strip.append(link);
    }
}

function setupRecentlyViewed() {
    if (!$("recentPanel")) return;

    renderRecentlyViewed();

    $("recentClear")?.addEventListener("click", async () => {
        const button = $("recentClear");
        button.disabled = true;
        try {
            const response = await apiFetch("/me/recent", { method: "DELETE" });
            if (response.ok) $("recentPanel").hidden = true;
        } finally {
            button.disabled = false;
        }
    });
}


// ============================================
// SAVED COMPARISONS (saved to the account)
// ============================================

let savedComparisons = [];

function samePair(c, a, b) {
    return (String(c.gpu_a_id) === String(a) && String(c.gpu_b_id) === String(b)) ||
        (String(c.gpu_a_id) === String(b) && String(c.gpu_b_id) === String(a));
}

function currentSavedComparison() {
    if (!compareGpuA || !compareGpuB) return null;
    return savedComparisons.find((c) => samePair(c, compareGpuA.id, compareGpuB.id)) || null;
}

function updateSaveComparisonButton() {
    const button = $("saveComparison");
    if (!button) return;
    const saved = currentSavedComparison();
    button.innerHTML = `${iconSVG("star")}<span>${saved ? "Saved" : "Save comparison"}</span>`;
    button.classList.toggle("is-saved", Boolean(saved));
    button.setAttribute("aria-pressed", String(Boolean(saved)));
    button.title = saved ? "Remove from your saved comparisons" : "Save this pair to your account";
}

function renderSavedComparisons() {
    const box = $("savedComparisons");
    const list = $("savedList");
    if (!box || !list) return;

    box.hidden = savedComparisons.length === 0;
    list.replaceChildren();

    for (const c of savedComparisons) {
        const item = document.createElement("div");
        item.className = "saved-item";

        const link = document.createElement("a");
        link.href = `compare.html?gpu1=${encodeURIComponent(c.gpu_a_id)}&gpu2=${encodeURIComponent(c.gpu_b_id)}`;
        const names = `${c.gpu_a_model || "GPU " + c.gpu_a_id} vs ${c.gpu_b_model || "GPU " + c.gpu_b_id}`;
        link.textContent = c.name ? `${c.name}: ${names}` : names;

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "saved-remove";
        remove.setAttribute("aria-label", `Remove ${names}`);
        remove.textContent = "×";
        remove.addEventListener("click", () => deleteSavedComparison(c));

        item.append(link, remove);
        list.append(item);
    }
}

async function deleteSavedComparison(c) {
    try {
        const response = await apiFetch(`/me/comparisons/${c.id}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404) return;
        savedComparisons = savedComparisons.filter((x) => x.id !== c.id);
        renderSavedComparisons();
        updateSaveComparisonButton();
    } catch {
        // leave it listed; the user can try again
    }
}

async function setupSavedComparisons() {
    const button = $("saveComparison");
    if (!button && !$("savedComparisons")) return;

    const account = await accountReady;
    if (!account) return;

    try {
        const response = await apiFetch("/me/comparisons", { cache: "no-store" });
        if (response.ok) savedComparisons = (await response.json()).comparisons || [];
    } catch {
        savedComparisons = [];
    }
    renderSavedComparisons();
    updateSaveComparisonButton();

    button?.addEventListener("click", async () => {
        if (!compareGpuA || !compareGpuB) return;
        const existing = currentSavedComparison();
        button.disabled = true;
        try {
            if (existing) {
                await deleteSavedComparison(existing);
                return;
            }
            const response = await apiFetch("/me/comparisons", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ gpu_a_id: compareGpuA.id, gpu_b_id: compareGpuB.id })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                button.title = typeof data.detail === "string" ? data.detail : "Couldn't save. Try again.";
                return;
            }
            const saved = await response.json();
            if (!savedComparisons.some((x) => x.id === saved.id)) savedComparisons.unshift(saved);
            renderSavedComparisons();
            updateSaveComparisonButton();
        } catch {
            button.title = "Couldn't save. Try again.";
        } finally {
            button.disabled = false;
        }
    });
}

// ============================================
// BRAND OVERVIEW
// ============================================

const BRAND_TARGETS = {
    NVIDIA: {
        vram: "nvidiaVram",
        series: "nvidiaSeries",
        platform: "nvidiaPlatform"
    },

    AMD: {
        vram: "amdVram",
        series: "amdSeries",
        platform: "amdPlatform"
    },

    INTEL: {
        vram: "intelVram",
        series: "intelSeries",
        platform: "intelPlatform"
    }
};


function renderBrandOverview(gpus) {
    Object.entries(
        BRAND_TARGETS
    ).forEach(
        ([brand, ids]) => {

            const candidates =
                gpus.filter(
                    (gpu) =>
                        String(
                            gpu.brand || ""
                        ).toUpperCase() ===
                        brand
                );

            const highest =
                [...candidates].sort(
                    (a, b) =>
                        parseVramGb(b.vram) -
                        parseVramGb(a.vram) ||

                        getReleaseTimestamp(b) -
                        getReleaseTimestamp(a)
                )[0];

            setText(
                ids.vram,
                highest?.vram || "--"
            );

            setText(
                ids.series,
                highest
                    ? formatSeries(
                        highest.series
                    )
                    : "--"
            );

            setText(
                ids.platform,
                highest?.architecture || "--"
            );

            // A brand with no GPUs in the catalog says so instead of six "--"
            const card = document.querySelector(
                `.brand-card[data-brand="${brand === "INTEL" ? "Intel" : brand}"]`
            );

            if (card) {
                card.classList.toggle("is-empty", !highest);

                let note = card.querySelector(".brand-empty");
                if (!highest && !note) {
                    note = document.createElement("p");
                    note.className = "brand-empty";
                    note.textContent = `No ${brand === "INTEL" ? "Intel" : brand} GPUs in the catalog yet.`;
                    card.append(note);
                }
                if (note) note.hidden = Boolean(highest);
            }
        }
    );
}


// "24GB GDDR6X" -> 24, "512MB DDR3" -> 0.5, "1.5 GB" -> 1.5, 12 -> 12
function parseVramGb(value) {
    const match =
        String(
            value ?? ""
        ).match(
            /(\d+(?:\.\d+)?)\s*(TB|GB|MB)?/i
        );

    if (!match) return 0;

    const amount = Number(match[1]);
    const unit = (match[2] || "GB").toUpperCase();

    if (unit === "MB") return amount / 1024;
    if (unit === "TB") return amount * 1024;
    return amount;
}


function formatSeries(series) {
    if (!series) {
        return "--";
    }

    return String(series)
        .replace(/^GeForce\s+/i, "")
        .replace(/^Radeon\s+/i, "")
        .replace(/\s+Series$/i, "")
        .trim();
}


function getPlatform(gpu) {
    const brand =
        String(
            gpu.brand || ""
        ).toUpperCase();

    const architecture =
        String(
            gpu.architecture || ""
        ).trim();

    const coreType =
        String(
            gpu.core_type || ""
        ).trim();

    if (brand === "NVIDIA") {
        return /cuda/i.test(coreType)
            ? "CUDA"
            : architecture || "CUDA";
    }

    if (brand === "AMD") {
        if (/rdna/i.test(architecture)) {
            return architecture;
        }

        if (/stream/i.test(coreType)) {
            return "Stream";
        }

        return architecture || "AMD";
    }

    if (brand === "INTEL") {
        if (/xe/i.test(coreType)) {
            return "Xe";
        }

        if (/xe/i.test(architecture)) {
            return architecture;
        }

        return architecture || "Xe";
    }

    return (
        architecture ||
        coreType ||
        "--"
    );
}


// ============================================
// PERFORMANCE CHART
// ============================================

const METRICS = {

    memory_bandwidth_gbps: {
        label: "Memory Bandwidth",

        getValue: (gpu) =>
            numberOrNull(
                gpu.memory_bandwidth_gbps ??
                parseNumber(
                    gpu.memory_bandwidth
                )
            ),

        format: (value) =>
            `${formatCompact(value)} GB/s`
    },


    vram: {
        label: "VRAM",

        getValue: (gpu) =>
            numberOrNull(
                parseVramGb(
                    gpu.vram
                )
            ),

        format: (value) =>
            `${formatCompact(value)} GB`
    },


    core_count: {
        label: "Core Count",

        getValue: (gpu) =>
            numberOrNull(
                gpu.core_count ??
                gpu.cuda_cores
            ),

        format: (value) =>
            Math
                .round(value)
                .toLocaleString()
    },


    boost_clock: {
        label: "Boost Clock",

        getValue: (gpu) =>
            numberOrNull(
                parseNumber(
                    gpu.boost_clock
                )
            ),

        format: (value) =>
            `${Number(value).toFixed(2)} GHz`
    },


    launch_price_usd: {
        label: "Launch Price",

        getValue: (gpu) =>
            numberOrNull(
                gpu.launch_price_usd ??
                parseNumber(
                    gpu.launch_price
                )
            ),

        format: (value) =>
            `$${Math
                .round(value)
                .toLocaleString()}`
    }
};


const BRAND_COLORS = {
    NVIDIA: "#16b978",
    AMD: "#f14f56",
    Intel: "#2f7df6"
};


function renderPerformanceChart(
    gpus,
    metricKey
) {

    const canvas =
        $("gpuTrendChart");

    const chartPanel =
        $("performanceChart");

    if (!canvas || !chartPanel) {
        return;
    }

    chartPanel.classList.remove(
        "has-error"
    );

    if (typeof Chart === "undefined") {

        chartPanel.innerHTML = `
            <div class="panel-loading">
                Chart.js could not load.
            </div>
        `;

        return;
    }

    const metric =
        METRICS[metricKey] ||
        METRICS.memory_bandwidth_gbps;

    const years = [
        ...new Set(
            gpus
                .map(getReleaseYear)
                .filter(Boolean)
        )
    ].sort(
        (a, b) => a - b
    );

    if (!years.length) {

        chartPanel.innerHTML = `
            <div class="panel-loading">
                No release dates are available for the chart.
            </div>
        `;

        return;
    }

    const datasets =
        ["NVIDIA", "AMD", "Intel"]
            .map(
                (brand) => ({

                    label: brand,

                    data:
                        years.map(
                            (year) => {

                                const values =
                                    gpus
                                        .filter(
                                            (gpu) =>
                                                String(
                                                    gpu.brand || ""
                                                ).toUpperCase() ===
                                                brand.toUpperCase() &&

                                                getReleaseYear(gpu) ===
                                                year
                                        )
                                        .map(
                                            metric.getValue
                                        )
                                        .filter(
                                            (value) =>
                                                value !== null
                                        );

                                return values.length
                                    ? Math.max(
                                        ...values
                                    )
                                    : null;
                            }
                        ),

                    borderColor:
                        BRAND_COLORS[brand],

                    backgroundColor:
                        BRAND_COLORS[brand],

                    pointBackgroundColor:
                        BRAND_COLORS[brand],

                    pointRadius: 3,
                    pointHoverRadius: 5,
                    borderWidth: 2,
                    tension: 0,
                    spanGaps: true
                })
            );

    gpuTrendChart?.destroy();

    gpuTrendChart =
        new Chart(
            canvas,
            {
                type: "line",

                data: {
                    labels: years,
                    datasets
                },

                options: {                    responsive: true,

                    maintainAspectRatio: false,

                    interaction: {
                        mode: "index",
                        intersect: false
                    },

                    plugins: {

                        legend: {
                            position: "top",
                            align: "start",

                            labels: {
                                usePointStyle: true,
                                boxWidth: 7,
                                boxHeight: 7,

                                font: {
                                    size: 9
                                }
                            }
                        },

                        tooltip: {
                            callbacks: {
                                label(context) {
                                    return (
                                        `${context.dataset.label}: ` +
                                        metric.format(
                                            context.parsed.y
                                        )
                                    );
                                }
                            }
                        }
                    },

                    scales: {

                        x: {
                            grid: {
                                color:
                                    "rgba(117, 137, 165, 0.12)"
                            },

                            ticks: {
                                color: "#687992",

                                font: {
                                    size: 9
                                }
                            }
                        },

                        y: {
                            beginAtZero: true,

                            grid: {
                                color:
                                    "rgba(117, 137, 165, 0.12)"
                            },

                            ticks: {
                                color: "#687992",

                                font: {
                                    size: 9
                                },

                                callback: (value) =>
                                    metric.format(
                                        Number(value)
                                    )
                            }
                        }
                    }
                }
            }
        );
}


function getReleaseYear(gpu) {
    if (!gpu?.release_date) {
        return null;
    }

    const parsed =
        new Date(
            gpu.release_date
        );

    return Number.isNaN(
        parsed.getTime()
    )
        ? null
        : parsed.getFullYear();
}


function getReleaseTimestamp(gpu) {
    const parsed =
        new Date(
            gpu?.release_date || 0
        );

    return Number.isNaN(
        parsed.getTime()
    )
        ? 0
        : parsed.getTime();
}


function parseNumber(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    const match =
        String(value)
            .replace(/,/g, "")
            .match(
                /-?\d+(?:\.\d+)?/
            );

    return match
        ? Number(match[0])
        : null;
}


function numberOrNull(value) {
    // Number(null) is 0, which would plot a missing spec as a real zero
    if (value === null || value === undefined || value === "") return null;

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : null;
}


function formatCompact(value) {
    return Number(value)
        .toLocaleString(
            undefined,
            {
                maximumFractionDigits: 1
            }
        );
}


// ============================================
// HOME SEARCH
// ============================================

// ============================================
// GLOBAL SEARCH
// Works on every page
// ============================================

async function setupHomeSearch() {

    const form =
        $("homeSearchForm");

    const input =
        $("searchInput");

    if (!form || !input) {
        return;
    }


    // Create dropdown automatically
    let suggestions =
        form.querySelector(
            ".global-search-suggestions"
        );


    if (!suggestions) {

        suggestions =
            document.createElement(
                "div"
            );

        suggestions.className =
            "global-search-suggestions";

        form.appendChild(
            suggestions
        );
    }


    let searchGPUs = [];


    try {

        searchGPUs =
            await fetchGPUs();

    } catch (error) {

        console.error(
            "Global search GPU load failed:",
            error
        );
    }


    // If we're already on browse page,
    // load ?q= into the search input
    if (
        window.location.pathname
            .toLowerCase()
            .includes("browse")
    ) {

        const params =
            new URLSearchParams(
                window.location.search
            );

        const query =
            params.get("q");

        if (query) {
            input.value = query;
        }
    }


    function getMatches() {

        const query =
            input.value
                .trim()
                .toLowerCase();


        const sorted =
            [...searchGPUs].sort(
                (a, b) => {

                    const nameA =
                        `${a.brand || ""} ${a.model || ""}`;

                    const nameB =
                        `${b.brand || ""} ${b.model || ""}`;

                    return nameA.localeCompare(
                        nameB
                    );
                }
            );


        // Empty input = show ALL GPUs
        if (!query) {
            return sorted;
        }


        return sorted.filter(
            (gpu) => {

                const searchableText = [
                    gpu.brand,
                    gpu.manufacturer,
                    gpu.model,
                    gpu.series,
                    gpu.architecture,
                    gpu.vram,
                    gpu.memory_type
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();


                return searchableText.includes(
                    query
                );
            }
        );
    }


    function openSearchCatalog() {

        renderGlobalSearchSuggestions(
            getMatches(),
            suggestions
        );
    }


    function closeSearchCatalog() {

        suggestions.classList.remove(
            "show"
        );
    }


    // Click/focus = show available GPUs
    input.addEventListener(
        "focus",
        openSearchCatalog
    );


    input.addEventListener(
        "click",
        openSearchCatalog
    );


    // Typing = filter dropdown
    input.addEventListener(
        "input",
        openSearchCatalog
    );


    // Unselect = hide dropdown
    input.addEventListener(
        "blur",
        () => {

            setTimeout(
                closeSearchCatalog,
                120
            );
        }
    );


    // ESC = hide
    input.addEventListener(
        "keydown",
        (event) => {

            if (
                event.key === "Escape"
            ) {

                closeSearchCatalog();

                input.blur();
            }
        }
    );


    // Click outside = hide
    document.addEventListener(
        "pointerdown",
        (event) => {

            if (
                !form.contains(
                    event.target
                )
            ) {

                closeSearchCatalog();
            }
        }
    );


    // Blue Search button
    form.addEventListener(
        "submit",
        (event) => {

            event.preventDefault();


            const query =
                input.value.trim();


            if (!query) {

                window.location.href =
                    "browse.html";

                return;
            }


            window.location.href =
                `browse.html?q=${encodeURIComponent(
                    query
                )}`;
        }
    );
}

function renderGlobalSearchSuggestions(
    gpus,
    container
) {

    container.innerHTML = "";


    if (!gpus.length) {

        container.innerHTML = `
            <div class="global-search-empty">
                No GPUs found.
            </div>
        `;

        container.classList.add(
            "show"
        );

        return;
    }


    gpus.forEach(
        (gpu) => {

            const button =
                document.createElement(
                    "button"
                );


            button.type =
                "button";


            button.className =
                "global-search-item";


            button.innerHTML = `

                <div class="global-search-image">

                    <img
                        src="${escapeHTML(
                            getImageFile(
                                gpu
                            )
                        )}"

                        alt="${escapeHTML(
                            gpu.model ||
                            "GPU"
                        )}"

                        loading="lazy"
                    >

                </div>


                <div class="global-search-info">

                    <strong>
                        ${escapeHTML(
                            gpu.model ||
                            "Unknown GPU"
                        )}
                    </strong>


                    <span>
                        ${escapeHTML(
                            `${gpu.brand || ""} • ${gpu.vram || "--"}`
                        )}
                    </span>

                </div>


                <div class="global-search-price">

                    ${escapeHTML(
                        getLaunchPrice(
                            gpu
                        )
                    )}

                </div>

            `;


            // pointerdown fires before blur
            button.addEventListener(
    "pointerdown",
    (event) => {

        event.preventDefault();


        window.location.href =
            `gpu.html?id=${encodeURIComponent(
                gpu.id
            )}`;
    }
);


            container.appendChild(
                button
            );
        }
    );


    container.classList.add(
        "show"
    );
}


// ============================================
// GEMINI CHAT
// ============================================

function setupGeminiChat() {

    const helpButton =
        $("helpButton");

    const miniChat =
        $("miniChat");

    const chatClose =
        $("chatClose");

    const chatForm =
        $("chatForm");

    const chatInput =
        $("chatInput");

    const chatSend =
        $("chatSend");

    const chatMessages =
        $("chatMessages");

    const chatTyping =
        $("chatTyping");

    if (
        !helpButton ||
        !miniChat ||
        !chatClose ||
        !chatForm ||
        !chatInput ||
        !chatSend ||
        !chatMessages ||
        !chatTyping
    ) {
        return;
    }

    const conversation = [];

    // "Ask a question" on the home page opens the same chat as the character
    document.querySelector("[data-open-chat]")?.addEventListener("click", () => {
        // the character button toggles; only open, never close, from here
        if (!miniChat.classList.contains("show")) helpButton.click();
    });

    helpButton.addEventListener(
        "click",
        () => {

            miniChat.classList.toggle(
                "show"
            );

            if (
                miniChat.classList.contains(
                    "show"
                )
            ) {

                setTimeout(
                    () => chatInput.focus(),
                    150
                );
            }
        }
    );


    chatClose.addEventListener(
        "click",
        () => {

            miniChat.classList.remove(
                "show"
            );
        }
    );


    chatForm.addEventListener(
        "submit",
        async (event) => {

            event.preventDefault();

            const message =
                chatInput.value.trim();

            if (!message) {
                return;
            }

            addChatMessage(
                chatMessages,
                message,
                "user"
            );

            conversation.push({
                role: "user",
                text: message
            });

            chatInput.value = "";

            setChatLoading(
                true,
                chatTyping,
                chatInput,
                chatSend
            );

            try {

                const response =
                    await apiFetch(
                        "/chat",
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            // Odd count so the window starts on a
                            // user turn and ends on this message.
                            body:
                                JSON.stringify({
                                    message,
                                    history:
                                        conversation.slice(
                                            -9
                                        )
                                })
                        }
                    );

                const data =
                    await response
                        .json()
                        .catch(
                            () => ({})
                        );

                if (!response.ok) {
                    const chatError = new Error(
                        data.detail ||
                        data.error ||
                        `Chat request failed (${response.status})`
                    );
                    chatError.status = response.status;
                    throw chatError;
                }

                const reply =
                    data.reply ||
                    "I couldn't generate a response.";

                addChatMessage(
                    chatMessages,
                    reply,
                    "bot"
                );

                conversation.push({
                    role: "model",
                    // Server caps history items at 2000 chars.
                    text: reply.slice(0, 2000)
                });

            } catch (error) {

                console.error(
                    "Gemini chat error:",
                    error
                );

                // Drop the unanswered turn so history keeps
                // alternating user/model (the server rejects
                // two user turns in a row).
                conversation.pop();

                addChatMessage(
                    chatMessages,
                    error.status === 429
                        ? error.message
                        : "The assistant is unavailable right now.",
                    "error"
                );

            } finally {

                setChatLoading(
                    false,
                    chatTyping,
                    chatInput,
                    chatSend
                );

                chatInput.focus();
            }
        }
    );
}


function addChatMessage(
    container,
    text,
    type
) {

    const message =
        document.createElement(
            "div"
        );

    message.className =
        `chat-message ${type}-message`;

    message.textContent =
        text;

    container.appendChild(
        message
    );

    container.scrollTop =
        container.scrollHeight;
}


function setChatLoading(
    loading,
    typing,
    input,
    send
) {

    typing.classList.toggle(
        "show",
        loading
    );

    input.disabled =
        loading;

    send.disabled =
        loading;
}


// ============================================
// FEATURED GPU DETAILS MODAL
// ============================================

function setupGpuDetailsModal() {

    $("gpuModalClose")
        ?.addEventListener(
            "click",
            closeGpuDetails
        );

    $("gpuModalOverlay")
        ?.addEventListener(
            "click",
            closeGpuDetails
        );

    document.addEventListener(
        "keydown",
        (event) => {

            if (
                event.key === "Escape" &&
                $("gpuDetailsModal")
                    ?.classList.contains(
                        "show"
                    )
            ) {
                closeGpuDetails();
            }
        }
    );
}


function openGpuDetails(gpu) {
    const modal =
        $("gpuDetailsModal");

    const body =
        $("gpuModalBody");

    if (!modal || !body) {
        return;
    }

    const image =
        getImageFile(gpu);

    const price =
        getLaunchPrice(gpu);

    body.innerHTML = `
        <div class="gpu-modal-main">

            <div class="gpu-modal-image">

                <img
                    src="${escapeHTML(image)}"
                    alt="${escapeHTML(
                        gpu.model || "GPU"
                    )}"
                    data-hide-on-error
                >

            </div>

            <div class="gpu-modal-info">

                <span class="gpu-modal-brand">
                    ${escapeHTML(
                        gpu.brand || "GPU"
                    )}
                </span>

                <h2 id="gpuModalTitle">
                    ${escapeHTML(
                        gpu.model || "Unknown GPU"
                    )}
                </h2>

                <p class="gpu-modal-series">
                    ${escapeHTML(
                        gpu.series || ""
                    )}
                </p>

                <p class="gpu-modal-description">
                    ${escapeHTML(
                        gpu.description ||
                        "No description available."
                    )}
                </p>

                <div class="gpu-modal-price">
                    ${escapeHTML(price)}
                </div>

            </div>

        </div>

        <div class="gpu-modal-spec-grid">

            ${createDetailSpec(
                "Architecture",
                gpu.architecture
            )}

            ${createDetailSpec(
                "VRAM",
                gpu.vram
            )}

            ${createDetailSpec(
                "Memory Type",
                gpu.memory_type
            )}

            ${createDetailSpec(
                "Core Count",
                gpu.core_count
                    ? Number(
                        gpu.core_count
                    ).toLocaleString()
                    : "--"
            )}

            ${createDetailSpec(
                "Core Type",
                gpu.core_type
            )}

            ${createDetailSpec(
                "Memory Bus",
                gpu.memory_bus
            )}

            ${createDetailSpec(
                "Memory Bandwidth",
                gpu.memory_bandwidth ||
                (
                    gpu.memory_bandwidth_gbps
                        ? `${gpu.memory_bandwidth_gbps} GB/s`
                        : "--"
                )
            )}

            ${createDetailSpec(
                "Base Clock",
                gpu.base_clock
            )}

            ${createDetailSpec(
                "Boost Clock",
                gpu.boost_clock
            )}

            ${createDetailSpec(
                "Power",
                gpu.power
            )}

            ${createDetailSpec(
                "Recommended PSU",
                gpu.recommended_psu
            )}

            ${createDetailSpec(
                "PCIe Interface",
                gpu.pcie_interface
            )}

            ${createDetailSpec(
                "Process Node",
                gpu.process_node_nm
                    ? `${gpu.process_node_nm} nm`
                    : "--"
            )}

            ${createDetailSpec(
                "Release Date",
                gpu.release_date
            )}

        </div>
    `;

    modal.classList.add("show");

    modal.setAttribute(
        "aria-hidden",
        "false"
    );

    document.body.classList.add(
        "modal-open"
    );
}


function createDetailSpec(
    label,
    value
) {

    return `
        <div class="gpu-modal-spec">

            <span>
                ${escapeHTML(label)}
            </span>

            <strong>
                ${escapeHTML(
                    value ?? "--"
                )}
            </strong>

        </div>
    `;
}


function closeGpuDetails() {
    const modal =
        $("gpuDetailsModal");

    if (!modal) {
        return;
    }

    modal.classList.remove(
        "show"
    );

    modal.setAttribute(
        "aria-hidden",
        "true"
    );

    document.body.classList.remove(
        "modal-open"
    );
}


// ============================================
// COMPARE PAGE
// ============================================

async function setupComparePage() {

    const searchA =
        $("compareSearchA");

    const searchB =
        $("compareSearchB");

    if (!searchA || !searchB) {
        return;
    }

    try {

        compareGPUs =
            await fetchGPUs();

        setupCompareSearch(
            searchA,
            $("compareSuggestionsA"),
            "A"
        );

        setupCompareSearch(
            searchB,
            $("compareSuggestionsB"),
            "B"
        );

        loadCompareFromURL();

        $("swapCompare")
            ?.addEventListener(
                "click",
                swapComparedGPUs
            );

        $("clearCompare")
            ?.addEventListener(
                "click",
                clearComparison
            );

        $("differencesOnly")
            ?.addEventListener(
                "change",
                renderComparisonTable
            );

    } catch (error) {

        console.error(
            "Compare page error:",
            error
        );
        showLoadError(document.querySelector(".main"));
    }
}


// ============================================
// COMPARE SEARCH / CATALOG
// ============================================

function setupCompareSearch(
    input,
    suggestions,
    slot
) {

    if (!suggestions) {
        return;
    }

    function openCatalog() {

        const query =
            input.value
                .trim()
                .toLowerCase();

        let matches =
            getAvailableCompareGPUs(
                slot
            );

        if (query) {

            matches =
                matches.filter(
                    (gpu) => {

                        const searchableText = [
                            gpu.brand,
                            gpu.manufacturer,
                            gpu.model,
                            gpu.series,
                            gpu.architecture,
                            gpu.vram,
                            gpu.memory_type
                        ]
                            .filter(Boolean)
                            .join(" ")
                            .toLowerCase();

                        return searchableText.includes(
                            query
                        );
                    }
                );
        }

        renderCompareSuggestions(
            matches,
            suggestions,
            slot
        );
    }


    function closeCatalog() {
        suggestions.classList.remove(
            "show"
        );
    }


    // CLICK / FOCUS = SHOW ALL AVAILABLE GPUs
    input.addEventListener(
        "focus",
        openCatalog
    );

    input.addEventListener(
        "click",
        openCatalog
    );


    // TYPE = FILTER GPUs
    input.addEventListener(
        "input",
        openCatalog
    );


    // UNSELECT / TAB AWAY = HIDE CATALOG
    input.addEventListener(
        "blur",
        () => {

            // Small delay lets GPU click register first
            window.setTimeout(
                closeCatalog,
                120
            );
        }
    );


    // ESCAPE = CLOSE
    input.addEventListener(
        "keydown",
        (event) => {

            if (event.key === "Escape") {

                closeCatalog();

                input.blur();
            }
        }
    );


    // CLICK OUTSIDE = CLOSE
    document.addEventListener(
        "pointerdown",
        (event) => {

            const clickedInput =
                event.target === input;

            const clickedCatalog =
                suggestions.contains(
                    event.target
                );

            if (
                !clickedInput &&
                !clickedCatalog
            ) {
                closeCatalog();
            }
        }
    );
}


function getAvailableCompareGPUs(slot) {

    return [...compareGPUs]

        // Don't show GPU selected on opposite side
        .filter(
            (gpu) => {

                if (
                    slot === "A" &&
                    compareGpuB
                ) {

                    return String(gpu.id) !==
                        String(compareGpuB.id);
                }

                if (
                    slot === "B" &&
                    compareGpuA
                ) {

                    return String(gpu.id) !==
                        String(compareGpuA.id);
                }

                return true;
            }
        )

        // Alphabetical catalog
        .sort(
            (a, b) => {

                const nameA =
                    `${a.brand} ${a.model}`;

                const nameB =
                    `${b.brand} ${b.model}`;

                return nameA.localeCompare(
                    nameB
                );
            }
        );
}


function renderCompareSuggestions(
    gpus,
    container,
    slot
) {

    container.innerHTML = "";

    if (!gpus.length) {

        container.innerHTML = `
            <div class="compare-no-results">
                No GPUs found.
            </div>
        `;

        container.classList.add(
            "show"
        );

        return;
    }

    gpus.forEach(
        (gpu) => {

            const button =
                document.createElement(
                    "button"
                );

            button.type = "button";

            button.className =
                "compare-suggestion";

            button.innerHTML = `
                <div class="compare-suggestion-image">

                    <img
                        src="${escapeHTML(
                            getImageFile(gpu)
                        )}"
                        alt="${escapeHTML(
                            gpu.model || "GPU"
                        )}"
                        loading="lazy"
                    >

                </div>

                <div class="compare-suggestion-info">

                    <strong>
                        ${escapeHTML(
                            `${gpu.brand || ""} ${gpu.model || "Unknown GPU"}`
                                .trim()
                        )}
                    </strong>

                    <span>
                        ${escapeHTML(
                            gpu.vram || "--"
                        )}
                    </span>

                </div>
            `;

            button.addEventListener(
                "click",
                () => {

                    selectCompareGPU(
                        gpu,
                        slot
                    );

                    container.classList.remove(
                        "show"
                    );
                }
            );

            container.appendChild(
                button
            );
        }
    );

    container.classList.add(
        "show"
    );
}


function selectCompareGPU(
    gpu,
    slot
) {    if (slot === "A") {

        compareGpuA = gpu;

        if ($("compareSearchA")) {
            $("compareSearchA").value = "";
        }

    } else {

        compareGpuB = gpu;

        if ($("compareSearchB")) {
            $("compareSearchB").value = "";
        }
    }

    renderCompareSelections();

    updateCompareURL();

    renderComparisonTable();
}


function renderCompareSelections() {

    renderCompareSelected(
        compareGpuA,
        $("compareSelectedA"),
        "A"
    );

    renderCompareSelected(
        compareGpuB,
        $("compareSelectedB"),
        "B"
    );
}


function renderCompareSelected(
    gpu,
    container,
    slot
) {

    if (!container) {
        return;
    }


    if (!gpu) {

        container.innerHTML = `
            <div class="compare-empty">

                <div class="compare-empty-icon">
                    +
                </div>

                <strong>
                    Select a GPU
                </strong>

                <p>
                    Search by model,
                    brand, or series.
                </p>

            </div>
        `;

        return;
    }


    container.innerHTML = `
        <div class="compare-gpu">

            <div class="compare-gpu-image">

                <img
                    src="${escapeHTML(
                        getImageFile(gpu)
                    )}"
                    alt="${escapeHTML(
                        gpu.model || "GPU"
                    )}"
                >

            </div>


            <div class="compare-gpu-info">

                <span class="compare-gpu-brand">
                    ${escapeHTML(
                        gpu.brand || "GPU"
                    )}
                </span>

                <h3>
                    ${escapeHTML(
                        gpu.model || "Unknown GPU"
                    )}
                </h3>

                ${gpu.series ? `<p class="compare-gpu-series">${escapeHTML(gpu.series)}</p>` : ""}

                ${gpu.vram ? `<p class="compare-gpu-memory">${escapeHTML(gpu.vram)}</p>` : ""}

                <div class="compare-gpu-price">
                    ${escapeHTML(
                        getLaunchPrice(gpu)
                    )}
                </div>

                <button
                    class="compare-remove"
                    type="button"
                >
                    Remove
                </button>

            </div>

        </div>
    `;


    container
        .querySelector(".compare-remove")
        ?.addEventListener(
            "click",
            () => {

                if (slot === "A") {
                    compareGpuA = null;
                } else {
                    compareGpuB = null;
                }

                renderCompareSelections();

                updateCompareURL();

                renderComparisonTable();
            }
        );
}


// ============================================
// COMPARE SPECIFICATIONS
// ============================================

// How each spec is compared. A row with `better` gets a winner:
//   number(gpu)  -> the value used to compare
//   better       -> "higher" or "lower" wins
//   group        -> which part of the verdict it counts towards
//   comparable   -> optional; when it returns false the row isn't scored
// Rows without `better` are shown for information only.

const MEMORY_TYPE_RANK = {
    DDR3: 1, GDDR5: 2, GDDR5X: 3, GDDR6: 4, GDDR6X: 5, GDDR7: 6
};

// "2.41 GHz" -> 2.41, "2410 MHz" -> 2.41
function clockGhz(text) {
    const n = parseCompareNumber(text);
    return /mhz/i.test(String(text || "")) ? n / 1000 : n;
}

// "PCIe 5.0 x16" -> 516 (generation first, then lanes)
function pcieScore(text) {
    const match = String(text || "").match(/(\d+)(?:\.\d+)?\s*x(\d+)/i);
    return match ? Number(match[1]) * 100 + Number(match[2]) : NaN;
}

const COMPARE_ROWS = [
    { category: "Overview" },
    {
        label: "Launch Price",
        value: (gpu) => getLaunchPrice(gpu),
        number: (gpu) => (Number(gpu.launch_price_usd) > 0 ? Number(gpu.launch_price_usd) : NaN),
        better: "lower",
        group: "value",
        note: "Cheaper"
    },
    {
        label: "Release Date",
        value: (gpu) => gpu.release_date || "--",
        number: (gpu) => getReleaseTimestamp(gpu),
        better: "higher",
        group: "info",
        note: "Newer"
    },
    { label: "Series", value: (gpu) => gpu.series || "--" },

    { category: "Performance" },
    { label: "Architecture", value: (gpu) => gpu.architecture || "--" },
    {
        label: "Core Count",
        value: (gpu) => formatCompareNumber(gpu.core_count),
        number: (gpu) => Number(gpu.core_count),
        better: "higher",
        group: "performance",
        // CUDA cores, Stream Processors and Xe cores aren't the same size.
        comparable: (a, b) => a.core_type === b.core_type,
        notComparable: "Different core types: counts aren't directly comparable"
    },
    { label: "Core Type", value: (gpu) => gpu.core_type || "--" },
    {
        label: "Base Clock",
        value: (gpu) => gpu.base_clock || "--",
        number: (gpu) => clockGhz(gpu.base_clock),
        better: "higher",
        group: "performance",
        // Clock speeds mean different things on different designs.
        comparable: (a, b) => a.core_type === b.core_type,
        notComparable: "Different core designs: clock speeds aren't directly comparable"
    },
    {
        label: "Boost Clock",
        value: (gpu) => gpu.boost_clock || "--",
        number: (gpu) => clockGhz(gpu.boost_clock),
        better: "higher",
        group: "performance",
        // Clock speeds mean different things on different designs.
        comparable: (a, b) => a.core_type === b.core_type,
        notComparable: "Different core designs: clock speeds aren't directly comparable"
    },

    { category: "Memory" },
    {
        label: "VRAM",
        value: (gpu) => gpu.vram || "--",
        number: (gpu) => parseVramGb(gpu.vram),
        better: "higher",
        group: "performance"
    },
    {
        label: "Memory Type",
        value: (gpu) => gpu.memory_type || "--",
        number: (gpu) => MEMORY_TYPE_RANK[gpu.memory_type] ?? NaN,
        better: "higher",
        group: "performance"
    },
    {
        label: "Memory Bus",
        value: (gpu) => gpu.memory_bus || "--",
        number: (gpu) => parseCompareNumber(gpu.memory_bus),
        better: "higher",
        group: "performance"
    },
    {
        label: "Memory Bandwidth",
        value: (gpu) =>
            gpu.memory_bandwidth ||
            (gpu.memory_bandwidth_gbps ? `${gpu.memory_bandwidth_gbps} GB/s` : "--"),
        number: (gpu) => Number(gpu.memory_bandwidth_gbps),
        better: "higher",
        group: "performance"
    },

    { category: "Power & Platform" },
    {
        label: "Power",
        value: (gpu) => gpu.power || "--",
        number: (gpu) => parseCompareNumber(gpu.power),
        better: "lower",
        group: "efficiency",
        note: "Less power"
    },
    {
        label: "Recommended PSU",
        value: (gpu) => gpu.recommended_psu || "--",
        number: (gpu) => parseCompareNumber(gpu.recommended_psu),
        better: "lower",
        group: "efficiency",
        note: "Smaller PSU"
    },
    {
        label: "PCIe Interface",
        value: (gpu) => gpu.pcie_interface || "--",
        number: (gpu) => pcieScore(gpu.pcie_interface),
        better: "higher",
        group: "platform"
    },
    {
        label: "Process Node",
        value: (gpu) => (gpu.process_node_nm ? `${gpu.process_node_nm} nm` : "--"),
        number: (gpu) => Number(gpu.process_node_nm),
        better: "lower",
        group: "efficiency",
        note: "Smaller node"
    }
];


// "A", "B", "tie", "na" (can't be compared) or null (information row)
function compareRowWinner(row, a, b) {
    if (!row.better || !row.number) return null;
    if (row.comparable && !row.comparable(a, b)) return "na";

    const numberA = row.number(a);
    const numberB = row.number(b);

    if (!Number.isFinite(numberA) || !Number.isFinite(numberB)) return "na";
    if (numberA === numberB) return "tie";

    const aWins = row.better === "higher" ? numberA > numberB : numberA < numberB;
    return aWins ? "A" : "B";
}


function renderComparisonTable() {
    const results = $("compareResults");
    const body = $("compareTableBody");

    if (!results || !body) {
        return;
    }

    if (!compareGpuA || !compareGpuB) {
        results.hidden = true;
        return;
    }

    results.hidden = false;
    setText("compareTableGpuA", compareGpuA.model || "GPU 1");
    setText("compareTableGpuB", compareGpuB.model || "GPU 2");

    renderCompareVerdict(compareGpuA, compareGpuB);
    updateSaveComparisonButton();

    const differencesOnly = $("differencesOnly")?.checked;
    body.innerHTML = "";

    COMPARE_ROWS.forEach((row) => {
        const tr = document.createElement("tr");

        if (row.category) {
            tr.className = "compare-category";
            const cell = tr.insertCell();
            cell.colSpan = 3;
            cell.textContent = row.category;
            body.appendChild(tr);
            return;
        }

        const valueA = row.value(compareGpuA);
        const valueB = row.value(compareGpuB);

        if (differencesOnly && String(valueA) === String(valueB)) {
            return;
        }

        const winner = compareRowWinner(row, compareGpuA, compareGpuB);
        const classFor = (side) => {
            if (winner === "A" || winner === "B") {
                return winner === side ? "compare-better" : "compare-worse";
            }
            return winner === "na" ? "compare-na" : "compare-same";
        };

        const label = tr.insertCell();
        label.textContent = row.label;

        for (const [side, value] of [["A", valueA], ["B", valueB]]) {
            const cell = tr.insertCell();
            cell.className = classFor(side);
            cell.textContent = value;

            if (winner === side) {
                const badge = document.createElement("span");
                badge.className = "compare-win-badge";
                badge.textContent = row.note || (row.better === "lower" ? "Lower" : "Better");
                cell.append(" ", badge);
            }
        }

        if (winner === "na" && row.notComparable) {
            tr.title = row.notComparable;
        }

        body.appendChild(tr);
    });
}


// ---------- overall verdict ----------

function compareTally(a, b) {
    const groups = {};

    for (const row of COMPARE_ROWS) {
        if (!row.group || row.group === "info") continue;

        const winner = compareRowWinner(row, a, b);
        if (winner !== "A" && winner !== "B" && winner !== "tie") continue;

        const g = (groups[row.group] ??= { A: 0, B: 0, tie: 0, rows: [] });
        g[winner] += 1;
        g.rows.push({ label: row.label, winner });
    }

    const total = { A: 0, B: 0, tie: 0 };
    for (const g of Object.values(groups)) {
        total.A += g.A;
        total.B += g.B;
        total.tie += g.tie;
    }

    return { groups, total };
}

function renderCompareVerdict(a, b) {
    const box = $("compareVerdict");
    if (!box) return;

    const nameA = a.model || "GPU 1";
    const nameB = b.model || "GPU 2";
    const { groups, total } = compareTally(a, b);
    const perf = groups.performance || { A: 0, B: 0, tie: 0 };

    // Headline: who has the stronger performance specs.
    const counted = perf.A + perf.B + perf.tie;
    let headline;
    let subline = "";
    if (perf.A === perf.B) {
        headline = "These two are evenly matched on performance specs";
        if (counted) subline = `Each is ahead on ${perf.A}, and ${perf.tie} of ${counted} performance specs are equal.`;
    } else {
        const aLeads = perf.A > perf.B;
        headline = `${aLeads ? nameA : nameB} has the stronger specs`;
        subline = `Ahead on ${aLeads ? perf.A : perf.B}, behind on ${aLeads ? perf.B : perf.A}, equal on ${perf.tie} of ${counted} performance specs (${a.core_type === b.core_type ? "cores, clocks and memory" : "memory only, since the core designs differ"}).`;
    }

    // Supporting facts, each only when it says something.
    const facts = [];
    const priceA = Number(a.launch_price_usd);
    const priceB = Number(b.launch_price_usd);
    const hasPrices = priceA > 0 && priceB > 0;

    if (hasPrices && priceA !== priceB) {
        const cheaper = priceA < priceB ? nameA : nameB;
        facts.push(["Price", `${cheaper} launched $${Math.abs(priceA - priceB).toLocaleString()} cheaper`]);
    } else if (hasPrices) {
        facts.push(["Price", `Same launch price ($${priceA.toLocaleString()})`]);
    }

    const bwA = Number(a.memory_bandwidth_gbps);
    const bwB = Number(b.memory_bandwidth_gbps);
    if (bwA && bwB && bwA !== bwB) {
        const faster = bwA > bwB ? nameA : nameB;
        const pct = Math.round((Math.max(bwA, bwB) / Math.min(bwA, bwB) - 1) * 100);
        facts.push(["Memory", `${faster} has ${pct}% more memory bandwidth`]);
    }

    if (hasPrices && priceA > 0 && priceB > 0 && bwA && bwB) {
        const perDollarA = bwA / priceA;
        const perDollarB = bwB / priceB;
        if (Math.abs(perDollarA - perDollarB) / Math.max(perDollarA, perDollarB) > 0.05) {
            facts.push(["Value", `${perDollarA > perDollarB ? nameA : nameB} gives more bandwidth per dollar`]);
        }
    }

    const powerA = parseCompareNumber(a.power);
    const powerB = parseCompareNumber(b.power);
    if (Number.isFinite(powerA) && Number.isFinite(powerB) && powerA !== powerB) {
        const lighter = powerA < powerB ? nameA : nameB;
        facts.push(["Power", `${lighter} draws ${Math.abs(powerA - powerB)}W less`]);
    }

    if (a.core_type && b.core_type && a.core_type !== b.core_type) {
        facts.push(["Note", `${a.core_type} and ${b.core_type} differ in design, so core counts and clock speeds aren't scored between them`]);
    }

    // Build with DOM APIs: model names come from the API.
    box.replaceChildren();

    const heading = document.createElement("h3");
    heading.textContent = headline;

    const score = document.createElement("div");
    score.className = "compare-verdict-score";
    const scored = total.A + total.B + (total.tie || 0);
    for (const [name, wins, side] of [[nameA, total.A, "A"], [nameB, total.B, "B"]]) {
        const pill = document.createElement("span");
        const leading = total[side] > total[side === "A" ? "B" : "A"];
        pill.className = "compare-verdict-pill" + (leading ? " is-leading" : "");
        pill.textContent = `${name} is better on ${wins} of ${scored} spec${scored === 1 ? "" : "s"}`;
        score.append(pill);
    }
    if (total.tie) {
        const ties = document.createElement("span");
        ties.className = "compare-verdict-pill";
        ties.textContent = `${total.tie} tied`;
        score.append(ties);
    }

    const list = document.createElement("ul");
    for (const [topic, text] of facts) {
        const item = document.createElement("li");
        const strong = document.createElement("strong");
        strong.textContent = `${topic}: `;
        item.append(strong, text);
        list.append(item);
    }

    const foot = document.createElement("p");
    foot.className = "compare-verdict-foot";
    foot.textContent =
        "Based on listed specifications, not benchmarks. Real-world performance depends on the game or app, drivers and resolution.";

    box.append(heading);
    if (subline) {
        const sub = document.createElement("p");
        sub.className = "compare-verdict-sub";
        sub.textContent = subline;
        box.append(sub);
    }
    box.append(score);
    if (facts.length) box.append(list);
    box.append(foot);
}


// ============================================
// COMPARE ACTIONS
// ============================================

function swapComparedGPUs() {

    [
        compareGpuA,
        compareGpuB
    ] = [
        compareGpuB,
        compareGpuA
    ];

    renderCompareSelections();

    updateCompareURL();

    renderComparisonTable();
}


function clearComparison() {

    compareGpuA = null;

    compareGpuB = null;


    if ($("compareSearchA")) {
        $("compareSearchA").value = "";
    }


    if ($("compareSearchB")) {
        $("compareSearchB").value = "";
    }


    $("compareSuggestionsA")
        ?.classList.remove(
            "show"
        );


    $("compareSuggestionsB")
        ?.classList.remove(
            "show"
        );


    renderCompareSelections();

    updateCompareURL();

    renderComparisonTable();
}


// ============================================
// COMPARE URL
// ============================================

function updateCompareURL() {

    const params =
        new URLSearchParams();


    if (compareGpuA) {
        params.set(
            "gpu1",
            compareGpuA.id
        );
    }


    if (compareGpuB) {
        params.set(
            "gpu2",
            compareGpuB.id
        );
    }


    const query =
        params.toString();


    history.replaceState(
        {},
        "",
        query
            ? `compare.html?${query}`
            : "compare.html"
    );
}


function loadCompareFromURL() {

    const params =
        new URLSearchParams(
            window.location.search
        );


    const idA =
        params.get("gpu1");


    const idB =
        params.get("gpu2");


    if (idA) {

        compareGpuA =
            compareGPUs.find(
                (gpu) =>
                    String(gpu.id) ===
                    String(idA)
            ) || null;
    }


    if (idB) {

        compareGpuB =
            compareGPUs.find(
                (gpu) =>
                    String(gpu.id) ===
                    String(idB)
            ) || null;
    }


    renderCompareSelections();

    renderComparisonTable();
}


// ============================================
// COMPARE HELPERS
// ============================================

function parseCompareNumber(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return NaN;
    }


    const match =
        String(value)
            .replaceAll(
                ",",
                ""
            )
            .match(
                /\d+(?:\.\d+)?/
            );


    return match
        ? Number(match[0])
        : NaN;
}


function formatCompareNumber(value) {

    if (value === null || value === undefined || value === "") return "--";

    const number =
        Number(value);


    return Number.isFinite(number)
        ? number.toLocaleString()
        : "--";
}


// ============================================
// UTILITIES
// ============================================

function setText(
    id,
    value
) {

    const element =
        $(id);

    if (element) {
        element.textContent =
            value;
    }
}


function escapeHTML(value) {

    return String(value)

        .replaceAll(
            "&",
            "&amp;"
        )

        .replaceAll(
            "<",
            "&lt;"
        )

        .replaceAll(
            ">",
            "&gt;"
        )

        .replaceAll(
            '"',
            "&quot;"
        )

        .replaceAll(
            "'",
            "&#039;"
        );
}

// ============================================
// ANALYTICS PAGE
// ============================================

let analyticsGPUs = [];

let analyticsTrendChart = null;
let analyticsBrandChart = null;
let analyticsPriceChart = null;


async function setupAnalyticsPage() {

    if (!$("analyticsTrendChart")) {
        return;
    }


    try {

        analyticsGPUs =
            await fetchGPUs();


        $("analyticsBrandFilter")
            ?.addEventListener(
                "change",
                renderAnalyticsPage
            );


        $("analyticsMetric")
            ?.addEventListener(
                "change",
                renderAnalyticsPage
            );


        $("analyticsRankingMetric")
            ?.addEventListener(
                "change",
                renderAnalyticsPage
            );


        renderAnalyticsPage();


    } catch (error) {

        console.error(
            "Analytics page error:",
            error
        );
        showLoadError(document.querySelector(".main"));
    }
}

function getAnalyticsGPUs() {

    const brand =
        $("analyticsBrandFilter")
            ?.value ||
        "ALL";


    if (brand === "ALL") {
        return [...analyticsGPUs];
    }


    return analyticsGPUs.filter(
        (gpu) =>
            String(
                gpu.brand || ""
            ).toUpperCase() ===
            brand
    );
}

function renderAnalyticsPage() {

    const gpus =
        getAnalyticsGPUs();


    renderAnalyticsStats(gpus);

    renderAnalyticsTrend(gpus);

    renderAnalyticsBrands(gpus);

    renderAnalyticsPriceScatter(gpus);

    renderAnalyticsRanking(gpus);
}

function renderAnalyticsStats(gpus) {

    setText(
        "analyticsTotalGPUs",
        gpus.length.toLocaleString()
    );


    setText(
        "analyticsTotalSubtext",
        gpus.length === 1
            ? "1 GPU in current filter"
            : `${gpus.length} GPUs in current filter`
    );


    // Average price
    const prices =
        gpus
            .map(
                (gpu) =>
                    Number(
                        gpu.launch_price_usd
                    )
            )
            .filter(
                Number.isFinite
            );


    const averagePrice =
        prices.length

            ? prices.reduce(
                (total, price) =>
                    total + price,
                0
            ) / prices.length

            : null;


    setText(
        "analyticsAveragePrice",

        averagePrice !== null
            ? `$${Math.round(
                averagePrice
            ).toLocaleString()}`
            : "--"
    );


    // Highest VRAM
    const highestVramGPU =
        [...gpus].sort(
            (a, b) =>
                parseVramGb(
                    b.vram
                ) -
                parseVramGb(
                    a.vram
                )
        )[0];


    setText(
        "analyticsHighestVram",

        highestVramGPU
            ? `${parseVramGb(
                highestVramGPU.vram
            )}GB`
            : "--"
    );


    setText(
        "analyticsHighestVramGpu",

        highestVramGPU
            ? highestVramGPU.model
            : "--"
    );


    // Latest GPU
    const latestGPU =
        [...gpus]
            .sort(
                (a, b) =>
                    getReleaseTimestamp(b) -
                    getReleaseTimestamp(a)
            )[0];


    setText(
        "analyticsLatestGpu",

        latestGPU
            ? latestGPU.model
            : "--"
    );


    setText(
        "analyticsLatestDate",

        latestGPU
            ? latestGPU.release_date
            : "--"
    );
}

// An empty canvas reads as broken; say there's no data in the chart's box.
function showChartEmpty(canvas, isEmpty, text = "No data to chart yet.") {
    const box = canvas?.parentElement;
    if (!box) return;
    box.classList.toggle("is-chart-empty", isEmpty);
    box.setAttribute("data-empty-text", text);
}

function renderAnalyticsTrend(gpus) {

    const canvas =
        $("analyticsTrendChart");


    if (
        !canvas ||
        typeof Chart === "undefined"
    ) {
        return;
    }

    showChartEmpty(canvas, !gpus.length);


    const metricKey =
        $("analyticsMetric")
            ?.value ||
        "memory_bandwidth_gbps";


    const metric =
        METRICS[metricKey] ||
        METRICS.memory_bandwidth_gbps;


    const years = [
        ...new Set(
            gpus
                .map(getReleaseYear)
                .filter(Boolean)
        )
    ].sort(
        (a, b) => a - b
    );


    const brands = [
        ...new Set(
            gpus
                .map(
                    (gpu) =>
                        gpu.brand
                )
                .filter(Boolean)
        )
    ];


    const datasets =
        brands.map(
            (brand) => {

                const values =
                    years.map(
                        (year) => {

                            const matching =
                                gpus
                                    .filter(
                                        (gpu) =>
                                            gpu.brand === brand &&
                                            getReleaseYear(
                                                gpu
                                            ) === year
                                    )
                                    .map(
                                        metric.getValue
                                    )
                                    .filter(
                                        (value) =>
                                            value !== null
                                    );


                            return matching.length
                                ? Math.max(
                                    ...matching
                                )
                                : null;
                        }
                    );


                return {
                    label: brand,
                    data: values,

                    borderColor:
                        BRAND_COLORS[
                            brand
                        ],

                    backgroundColor:
                        BRAND_COLORS[
                            brand
                        ],

                    pointBackgroundColor:
                        BRAND_COLORS[
                            brand
                        ],

                    borderWidth: 2,
                    pointRadius: 3,
                    tension: 0,
                    spanGaps: true
                };
            }
        );


    analyticsTrendChart
        ?.destroy();


    analyticsTrendChart =
        new Chart(
            canvas,
            {

                type: "line",

                data: {
                    labels: years,
                    datasets
                },

                options: {

                    responsive: true,

                    maintainAspectRatio:
                        false,

                    interaction: {
                        mode: "index",
                        intersect: false
                    },

                    plugins: {

                        legend: {
                            position: "top",

                            labels: {
                                usePointStyle: true,
                                boxWidth: 7,

                                font: {
                                    size: 9
                                }
                            }
                        },

                        tooltip: {
                            callbacks: {

                                label(context) {

                                    return (
                                        `${context.dataset.label}: ` +
                                        metric.format(
                                            context.parsed.y
                                        )
                                    );
                                }
                            }
                        }
                    },

                    scales: {

                        y: {
                            beginAtZero: true,

                            ticks: {

                                font: {
                                    size: 9
                                },

                                callback:
                                    (value) =>
                                        metric.format(
                                            value
                                        )
                            }
                        },

                        x: {

                            ticks: {
                                font: {
                                    size: 9
                                }
                            }
                        }
                    }
                }
            }
        );
}

function renderAnalyticsBrands(gpus) {

    const canvas =
        $("analyticsBrandChart");


    if (
        !canvas ||
        typeof Chart === "undefined"
    ) {
        return;
    }

    showChartEmpty(canvas, !gpus.length);


    const counts = {};


    gpus.forEach(
        (gpu) => {

            const brand =
                gpu.brand ||
                "Unknown";


            counts[brand] =
                (counts[brand] || 0) +
                1;
        }
    );


    // one brand fills the whole ring, so say it in words too
    const brandNote = canvas.closest("article")?.querySelector(".analytics-card-header p, p");
    const brands = Object.keys(counts);
    if (brandNote) {
        brandNote.textContent = brands.length === 1
            ? (gpus.length === 1
                ? `The only GPU in the catalog is ${brands[0]}.`
                : `All ${gpus.length} GPUs in the catalog are ${brands[0]}.`)
            : "GPUs in the catalog.";
    }

    analyticsBrandChart
        ?.destroy();


    analyticsBrandChart =
        new Chart(
            canvas,
            {

                type: "doughnut",

                data: {

                    labels:
                        Object.keys(
                            counts
                        ),

                    datasets: [
                        {
                            data:
                                Object.values(
                                    counts
                                ),

                            backgroundColor:
                                Object.keys(counts).map(
                                    (brand) => BRAND_COLORS[brand] || "#9ca3af"
                                ),

                            borderWidth: 0
                        }
                    ]
                },

                options: {

                    responsive: true,

                    maintainAspectRatio:
                        false,

                    cutout: "68%",

                    plugins: {

                        legend: {
                            position: "bottom",

                            labels: {
                                usePointStyle: true,

                                font: {
                                    size: 9
                                }
                            }
                        }
                    }
                }
            }
        );
}

function renderAnalyticsPriceScatter(gpus) {

    const canvas =
        $("analyticsPriceChart");


    if (
        !canvas ||
        typeof Chart === "undefined"
    ) {
        return;
    }

    showChartEmpty(canvas, !gpus.length);


    const brands = [
        ...new Set(
            gpus
                .map(
                    (gpu) =>
                        gpu.brand
                )
                .filter(Boolean)
        )
    ];


    const datasets =
        brands.map(
            (brand) => {

                const brandGPUs =
                    gpus.filter(
                        (gpu) =>
                            gpu.brand === brand
                    );


                return {

                    label: brand,


                    data:
                        brandGPUs
                            .map(
                                (gpu) => ({

                                    x:
                                        Number(
                                            gpu.launch_price_usd
                                        ),

                                    y:
                                        Number(
                                            gpu.memory_bandwidth_gbps
                                        ),

                                    gpu
                                })
                            )
                            .filter(
                                (point) =>
                                    Number.isFinite(
                                        point.x
                                    ) &&
                                    Number.isFinite(
                                        point.y
                                    )
                            ),


                    backgroundColor:
                        BRAND_COLORS[
                            brand
                        ],


                    pointRadius: 5,

                    pointHoverRadius: 7
                };
            }
        );


    analyticsPriceChart
        ?.destroy();


    analyticsPriceChart =
        new Chart(
            canvas,
            {

                type: "scatter",

                data: {
                    datasets
                },

                options: {

                    responsive: true,

                    maintainAspectRatio:
                        false,

                    plugins: {

                        legend: {
                            position: "top",

                            labels: {
                                usePointStyle: true,

                                font: {
                                    size: 9
                                }
                            }
                        },


                        tooltip: {

                            callbacks: {

                                title(items) {

                                    const point =
                                        items[0]
                                            ?.raw;


                                    return (
                                        point?.gpu?.model ||
                                        "GPU"
                                    );
                                },


                                label(context) {

                                    return [
                                        `Price: $${context.raw.x.toLocaleString()}`,

                                        `Bandwidth: ${context.raw.y.toLocaleString()} GB/s`
                                    ];
                                }
                            }
                        }
                    },


                    scales: {

                        x: {

                            title: {
                                display: true,
                                text: "Launch Price (USD)"
                            },

                            ticks: {

                                callback:
                                    (value) =>
                                        `$${value.toLocaleString()}`
                            }
                        },


                        y: {

                            title: {
                                display: true,
                                text:
                                    "Memory Bandwidth (GB/s)"
                            },

                            beginAtZero: true
                        }
                    }
                }
            }
        );
}

function renderAnalyticsRanking(gpus) {

    const container =
        $("analyticsRankingList");


    if (!container) {
        return;
    }


    const metricKey =
        $("analyticsRankingMetric")
            ?.value ||
        "vram";


    const configs = {

        vram: {

            value:
                (gpu) =>
                    parseVramGb(
                        gpu.vram
                    ),

            format:
                (value) =>
                    `${value}GB`
        },


        memory_bandwidth_gbps: {

            value:
                (gpu) =>
                    Number(
                        gpu.memory_bandwidth_gbps
                    ),

            format:
                (value) =>
                    `${value.toLocaleString()} GB/s`
        },


        launch_price_usd: {

            value:
                (gpu) =>
                    Number(
                        gpu.launch_price_usd
                    ),

            format:
                (value) =>
                    `$${value.toLocaleString()}`
        },


        boost_clock: {

            value:
                (gpu) =>
                    parseCompareNumber(
                        gpu.boost_clock
                    ),

            format:
                (value) =>
                    `${value.toFixed(2)} GHz`
        }
    };


    const config =
        configs[metricKey];


    const ranked =
        [...gpus]

            .map(
                (gpu) => ({
                    gpu,
                    value:
                        config.value(
                            gpu
                        )
                })
            )

            .filter(
                (item) =>
                    Number.isFinite(
                        item.value
                    )
            )

            .sort(
                (a, b) =>
                    b.value -
                    a.value
            )

            .slice(
                0,
                5
            );


    container.innerHTML =
        "";

    if (!ranked.length) {
        const empty = document.createElement("p");
        empty.className = "analytics-list-empty";
        empty.textContent = "No GPUs have this spec yet.";
        container.append(empty);
        return;
    }


    ranked.forEach(
        (item, index) => {

            const row =
                document.createElement(
                    "div"
                );


            row.className =
                "analytics-ranking-item";


            row.innerHTML = `

                <div class="analytics-ranking-number">
                    ${index + 1}
                </div>


                <div class="analytics-ranking-image">

                    <img
                        src="${escapeHTML(
                            getImageFile(
                                item.gpu
                            )
                        )}"

                        alt="${escapeHTML(
                            item.gpu.model
                        )}"
                    >

                </div>


                <div class="analytics-ranking-info">

                    <strong>
                        ${escapeHTML(
                            item.gpu.model
                        )}
                    </strong>

                    <span>
                        ${escapeHTML(
                            item.gpu.brand
                        )}
                    </span>

                </div>


                <div class="analytics-ranking-value">

                    ${escapeHTML(
                        config.format(
                            item.value
                        )
                    )}

                </div>

            `;


            container.appendChild(
                row
            );
        }
    );
}

// ============================================
// RANKINGS PAGE
// ============================================

let rankingGPUs = [];


const RANKING_METRICS = {

    vram: {

        title:
            "Highest VRAM",

        description:
            "GPUs ranked by total video memory capacity.",

        tableLabel:
            "VRAM",

        value:
            (gpu) =>
                parseVramGb(
                    gpu.vram
                ),

        format:
            (gpu) =>
                gpu.vram ||
                "--",

        direction:
            "desc"
    },


    memory_bandwidth_gbps: {

        title:
            "Memory Bandwidth",

        description:
            "GPUs ranked by maximum memory bandwidth.",

        tableLabel:
            "Bandwidth",

        value:
            (gpu) =>
                Number(
                    gpu.memory_bandwidth_gbps
                ),

        format:
            (gpu) =>
                Number.isFinite(
                    Number(
                        gpu.memory_bandwidth_gbps
                    )
                )
                    ? `${Number(
                        gpu.memory_bandwidth_gbps
                    ).toLocaleString()} GB/s`
                    : "--",

        direction:
            "desc"
    },


    boost_clock: {

        title:
            "Boost Clock",

        description:
            "GPUs ranked by listed boost clock frequency.",

        tableLabel:
            "Boost Clock",

        value:
            (gpu) =>
                parseCompareNumber(
                    gpu.boost_clock
                ),

        format:
            (gpu) =>
                gpu.boost_clock ||
                "--",

        direction:
            "desc"
    },


    launch_price_low: {

        title:
            "Lowest Launch Price",

        description:
            "GPUs ranked from lowest to highest launch price.",

        tableLabel:
            "Launch Price",

        value:
            (gpu) =>
                Number(
                    gpu.launch_price_usd
                ),

        format:
            (gpu) =>
                getLaunchPrice(gpu),

        direction:
            "asc"
    },


    release_date: {

        title:
            "Newest Release",

        description:
            "GPUs ranked by most recent release date.",

        tableLabel:
            "Release Date",

        value:
            (gpu) =>
                getReleaseTimestamp(
                    gpu
                ),

        format:
            (gpu) =>
                gpu.release_date ||
                "--",

        direction:
            "desc"
    },


    process_node_nm: {

        title:
            "Smallest Process Node",

        description:
            "GPUs ranked by listed semiconductor process node.",

        tableLabel:
            "Process Node",

        value:
            (gpu) =>
                Number(
                    gpu.process_node_nm
                ),

        format:
            (gpu) =>
                Number.isFinite(
                    Number(
                        gpu.process_node_nm
                    )
                )
                    ? `${gpu.process_node_nm} nm`
                    : "--",

        direction:
            "asc"
    }
};

async function setupRankingsPage() {

    if (!$("rankingTableBody")) {
        return;
    }


    try {

        rankingGPUs =
            await fetchGPUs();


        $("rankingMetric")
            ?.addEventListener(
                "change",
                renderRankingsPage
            );


        $("rankingBrand")
            ?.addEventListener(
                "change",
                renderRankingsPage
            );


        $("rankingSearch")
            ?.addEventListener(
                "input",
                renderRankingsPage
            );


        renderRankingsPage();


    } catch (error) {

        console.error(
            "Rankings page error:",
            error
        );
        showLoadError(document.querySelector(".main"));
    }
}

function getRankedGPUs() {

    const metricKey =
        $("rankingMetric")
            ?.value ||
        "vram";


    const brand =
        $("rankingBrand")
            ?.value ||
        "ALL";


    const query =
        $("rankingSearch")
            ?.value
            .trim()
            .toLowerCase() ||
        "";


    const metric =
        RANKING_METRICS[
            metricKey
        ];


    let gpus =
        rankingGPUs.filter(
            (gpu) => {


                if (
                    brand !== "ALL" &&
                    String(
                        gpu.brand || ""
                    ).toUpperCase() !==
                    brand
                ) {
                    return false;
                }


                if (query) {

                    const text = [
                        gpu.brand,
                        gpu.model,
                        gpu.series,
                        gpu.architecture,
                        gpu.vram
                    ]
                        .filter(Boolean)
                        .join(" ")
                        .toLowerCase();


                    if (
                        !text.includes(
                            query
                        )
                    ) {
                        return false;
                    }
                }


                const value =
                    metric.value(
                        gpu
                    );


                return Number.isFinite(
                    value
                );
            }
        );


    gpus.sort(
        (a, b) => {

            const valueA =
                metric.value(a);

            const valueB =
                metric.value(b);


            return metric.direction ===
                "asc"

                ? valueA - valueB

                : valueB - valueA;
        }
    );


    return gpus;
}

function renderRankingsPage() {

    const metricKey =
        $("rankingMetric")
            ?.value ||
        "vram";


    const metric =
        RANKING_METRICS[
            metricKey
        ];


    const gpus =
        getRankedGPUs();


    const brand =
        $("rankingBrand")
            ?.value ||
        "ALL";


    setText(
        "rankingTitle",
        metric.title
    );


    // the count used to sit in a summary box that repeated the dropdowns
    setText(
        "rankingDescription",
        metric.description.replace(
            /^GPUs/,
            `${gpus.length.toLocaleString()} ${gpus.length === 1 ? "GPU" : "GPUs"}`
        )
    );


    setText(
        "rankingMetricHeader",
        metric.tableLabel
    );


    setText(
        "rankingCount",
        gpus.length
            .toLocaleString()
    );


    setText(
        "rankingBrandLabel",

        brand === "ALL"
            ? "All Brands"
            : brand
    );


    renderRankingPodium(
        gpus,
        metric
    );


    renderRankingTable(
        gpus,
        metric
    );
}

function renderRankingPodium(
    gpus,
    metric
) {

    const podium = document.querySelector(".ranking-podium");
    if (podium) podium.style.display = gpus.length ? "" : "none";

    renderPodiumGPU(
        $("rankingFirst"),
        gpus[0],
        1,
        metric
    );


    renderPodiumGPU(
        $("rankingSecond"),
        gpus[1],
        2,
        metric
    );


    renderPodiumGPU(
        $("rankingThird"),
        gpus[2],
        3,
        metric
    );
}

function renderPodiumGPU(
    container,
    gpu,
    rank,
    metric
) {

    if (!container) {
        return;
    }


    // fewer than 3 GPUs: leave the place out instead of "No GPU available."
    container.style.display = gpu ? "" : "none";

    if (!gpu) {
        container.innerHTML = "";
        return;
    }


    container.innerHTML = `

        <div class="podium-rank">
            #${rank}
        </div>


        <div class="podium-image">

            <img
                src="${escapeHTML(
                    getImageFile(
                        gpu
                    )
                )}"

                alt="${escapeHTML(
                    gpu.model ||
                    "GPU"
                )}"
            >

        </div>


        <span class="podium-brand">

            ${escapeHTML(
                gpu.brand ||
                "GPU"
            )}

        </span>


        <h3>
            ${escapeHTML(
                gpu.model ||
                "Unknown GPU"
            )}
        </h3>


        ${gpu.series ? `<p class="podium-series">${escapeHTML(gpu.series)}</p>` : ""}


        <span class="podium-value-label">

            ${escapeHTML(
                metric.tableLabel
            )}

        </span>


        <strong class="podium-value">

            ${escapeHTML(
                metric.format(
                    gpu
                )
            )}

        </strong>
    `;
}

function rankingIsFiltered() {
    return ($("rankingBrand")?.value || "ALL") !== "ALL" ||
        Boolean($("rankingSearch")?.value.trim());
}

function renderRankingTable(
    gpus,
    metric
) {

    const body =
        $("rankingTableBody");


    if (!body) {
        return;
    }


    body.innerHTML = "";


    if (!gpus.length) {

        body.innerHTML = `

            <tr>

                <td
                    colspan="7"
                    class="ranking-empty"
                >
                    ${rankingIsFiltered()
                        ? "No GPUs match this brand or filter."
                        : "The catalog has no GPUs yet."}
                </td>

            </tr>
        `;

        return;
    }


    gpus.forEach(
        (gpu, index) => {

            const rank =
                index + 1;


            const tr =
                document.createElement(
                    "tr"
                );


            tr.className =
                "ranking-row";


            tr.innerHTML = `

                <td>

                    <span
                        class="ranking-number ${
                            rank <= 3
                                ? "top-rank"
                                : ""
                        }"
                    >
                        #${rank}
                    </span>

                </td>


                <td>

                    <div class="ranking-gpu-cell">

                        <div class="ranking-gpu-image">

                            <img
                                src="${escapeHTML(
                                    getImageFile(
                                        gpu
                                    )
                                )}"

                                alt="${escapeHTML(
                                    gpu.model ||
                                    "GPU"
                                )}"
                            >

                        </div>


                        <div class="ranking-gpu-info">

                            <strong>
                                ${escapeHTML(
                                    gpu.model ||
                                    "Unknown GPU"
                                )}
                            </strong>

                            <span>
                                ${escapeHTML(
                                    gpu.series ||
                                    "--"
                                )}
                            </span>

                        </div>

                    </div>

                </td>


                <td>
                    ${escapeHTML(
                        gpu.brand ||
                        "--"
                    )}
                </td>


                <td class="ranking-metric-value">

                    ${escapeHTML(
                        metric.format(
                            gpu
                        )
                    )}

                </td>


                <td>

                    ${escapeHTML(
                        gpu.release_date ||
                        "--"
                    )}

                </td>


                <td>

                    ${escapeHTML(
                        getLaunchPrice(
                            gpu
                        )
                    )}

                </td>


                <td>

                    <a
                        href="compare.html?gpu1=${encodeURIComponent(
                            gpu.id
                        )}"

                        class="ranking-compare-button"
                    >
                        Compare
                    </a>

                </td>
            `;


            body.appendChild(
                tr
            );
        }
    );
}

// ============================================
// GPU DETAILS PAGE
// ============================================

async function setupGpuDetailsPage() {

    const container =
        $("gpuPageContent");


    if (!container) {
        return;
    }


    const params =
        new URLSearchParams(
            window.location.search
        );


    const gpuId =
        params.get("id");


    if (!gpuId) {

        renderGpuPageError(
            "No GPU was selected."
        );

        return;
    }


    try {

        const gpus =
            await fetchGPUs();


        const gpu =
            gpus.find(
                (item) =>
                    String(item.id) ===
                    String(gpuId)
            );


        if (!gpu) {

            renderGpuPageError(
                "GPU not found."
            );

            return;
        }


        renderGpuDetailsPage(
            gpu
        );

        recordRecentView(gpu.id);

        // Heart on the details page saves to the account.
        const heart = document.querySelector(".gpu-page-favorite");
        if (heart) {
            paintFavoriteButton(heart, favoriteIds.has(String(gpu.id)));
            heart.addEventListener("click", () => toggleFavorite(heart, gpu.id));
        }

        // Admins get picture controls. The API checks the role again.
        accountReady.then((account) => {
            if (account?.role === "admin") {
                setupGpuImageAdmin(gpu);
            }
        });


    } catch (error) {

        console.error(
            "GPU details page error:",
            error
        );


        showLoadError($("gpuPageContent"), {
            title: "Couldn't load this GPU.",
            replace: true
        });
    }
}

// ---------- admin: GPU picture upload ----------

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;   // matches the API (Vercel body limit)

function setupGpuImageAdmin(gpu) {
    const frame = document.querySelector(".gpu-page-image");

    if (!frame || frame.querySelector(".gpu-image-admin")) return;

    const panel = document.createElement("div");
    panel.className = "gpu-image-admin";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_TYPES.join(",");
    input.id = "gpuImageInput";
    input.className = "visually-hidden";

    const change = document.createElement("label");
    change.htmlFor = input.id;
    change.className = "gpu-image-admin-btn";
    change.textContent = gpu.image_url ? "Change picture" : "Upload picture";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "gpu-image-admin-btn is-secondary";
    remove.textContent = "Remove picture";
    remove.hidden = !gpu.image_url;

    const status = document.createElement("p");
    status.className = "gpu-image-admin-status";
    status.setAttribute("role", "status");

    panel.append(input, change, remove, status);
    frame.appendChild(panel);

    const showPicture = (updated) => {
        gpu.image_url = updated.image_url;
        let img = frame.querySelector("img");

        if (!img) {
            img = document.createElement("img");
            img.setAttribute("data-hide-on-error", "");
            frame.prepend(img);
        }

        img.alt = gpu.model || "GPU";
        img.style.display = "";
        img.src = getImageFile(gpu);
        change.textContent = gpu.image_url ? "Change picture" : "Upload picture";
        remove.hidden = !gpu.image_url;
    };

    const setBusy = (busy, text = "") => {
        change.classList.toggle("is-busy", busy);
        input.disabled = busy;
        remove.disabled = busy;
        status.textContent = text;
        status.classList.remove("is-error");
    };

    const fail = (text) => {
        setBusy(false);
        status.textContent = text;
        status.classList.add("is-error");
    };

    input.addEventListener("change", async () => {
        const file = input.files[0];
        input.value = "";
        if (!file) return;

        if (!IMAGE_TYPES.includes(file.type)) {
            fail("Choose a PNG, JPEG or WebP picture.");
            return;
        }

        if (file.size > IMAGE_MAX_BYTES) {
            fail("The picture must be 4 MB or smaller.");
            return;
        }

        setBusy(true, "Uploading...");

        try {
            const body = new FormData();
            body.append("file", file);

            // No Content-Type: the browser adds the multipart boundary.
            const response = await apiFetch(`/gpus/${encodeURIComponent(gpu.id)}/image`, {
                method: "POST",
                body
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                fail(typeof data.detail === "string" ? data.detail : "Upload failed.");
                return;
            }

            showPicture(data);
            invalidateGpuCache();
            setBusy(false, "Picture saved.");
        } catch {
            fail("Upload failed. Check your connection.");
        }
    });

    remove.addEventListener("click", async () => {
        setBusy(true, "Removing...");

        try {
            const response = await apiFetch(`/gpus/${encodeURIComponent(gpu.id)}/image`, {
                method: "DELETE"
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                fail(typeof data.detail === "string" ? data.detail : "Couldn't remove the picture.");
                return;
            }

            showPicture(data);
            invalidateGpuCache();
            setBusy(false, "Picture removed. The built-in image is shown.");
        } catch {
            fail("Couldn't remove the picture. Check your connection.");
        }
    });
}

function renderGpuDetailsPage(gpu) {

    const container =
        $("gpuPageContent");


    if (!container) {
        return;
    }


    const image =
        getImageFile(
            gpu
        );


    container.innerHTML = `

        <div class="gpu-page-top">

            <a
                href="browse.html"
                class="gpu-page-back"
            >
                ${iconSVG("arrowLeft")}
                Back to Browse
            </a>

        </div>


        <div class="gpu-page-hero">


            <div class="gpu-page-image">

                <img
                    src="${escapeHTML(
                        image
                    )}"

                    alt="${escapeHTML(
                        gpu.model ||
                        "GPU"
                    )}"

                    data-hide-on-error
                >

            </div>



            <div class="gpu-page-summary">


                <span class="gpu-page-brand">

                    ${escapeHTML(
                        gpu.brand ||
                        "GPU"
                    )}

                </span>


                <h1>

                    ${escapeHTML(
                        gpu.model ||
                        "Unknown GPU"
                    )}

                </h1>


                ${gpu.series ? `<p class="gpu-page-series">${escapeHTML(gpu.series)}</p>` : ""}


                <p class="gpu-page-description">

                    ${escapeHTML(
                        gpu.description ||
                        "No description available."
                    )}

                </p>


                <div class="gpu-page-price">

                    ${escapeHTML(
                        getLaunchPrice(
                            gpu
                        )
                    )}

                </div>


                <div class="gpu-page-actions">


                    <a
                        href="compare.html?gpu1=${encodeURIComponent(
                            gpu.id
                        )}"

                        class="primary-btn"
                    >
                        Compare GPU
                    </a>


                    <a
                        href="browse.html?q=${encodeURIComponent(
                            gpu.model ||
                            ""
                        )}"

                        class="gpu-page-secondary"
                    >
                        Find Similar
                    </a>


                    <button
                        type="button"
                        class="gpu-favorite gpu-page-favorite"
                        data-gpu-id="${escapeHTML(String(gpu.id ?? ""))}"
                        aria-pressed="false"
                    >${iconSVG("heart")}</button>

                </div>

            </div>

        </div>



        <div class="gpu-page-spec-section">


            <div class="gpu-page-section-header">

                <div>

                    <h2>
                        Specifications
                    </h2>

                </div>

            </div>



            <div class="gpu-page-spec-grid">

                ${createGpuPageSpec(
                    "Architecture",
                    gpu.architecture
                )}

                ${createGpuPageSpec(
                    "VRAM",
                    gpu.vram
                )}

                ${createGpuPageSpec(
                    "Memory Type",
                    gpu.memory_type
                )}

                ${createGpuPageSpec(
                    "Core Count",
                    formatGpuPageNumber(
                        gpu.core_count
                    )
                )}

                ${createGpuPageSpec(
                    "Core Type",
                    gpu.core_type
                )}

                ${createGpuPageSpec(
                    "Memory Bus",
                    gpu.memory_bus
                )}

                ${createGpuPageSpec(
                    "Memory Bandwidth",
                    gpu.memory_bandwidth ||
                    (
                        gpu.memory_bandwidth_gbps
                            ? `${gpu.memory_bandwidth_gbps} GB/s`
                            : "--"
                    )
                )}

                ${createGpuPageSpec(
                    "Base Clock",
                    gpu.base_clock
                )}

                ${createGpuPageSpec(
                    "Boost Clock",
                    gpu.boost_clock
                )}

                ${createGpuPageSpec(
                    "Power",
                    gpu.power
                )}

                ${createGpuPageSpec(
                    "Recommended PSU",
                    gpu.recommended_psu
                )}

                ${createGpuPageSpec(
                    "PCIe Interface",
                    gpu.pcie_interface
                )}

                ${createGpuPageSpec(
                    "Process Node",
                    gpu.process_node_nm
                        ? `${gpu.process_node_nm} nm`
                        : "--"
                )}

                ${createGpuPageSpec(
                    "Release Date",
                    gpu.release_date
                )}

                ${createGpuPageSpec(
                    "Manufacturer",
                    gpu.manufacturer
                )}

                ${createGpuPageSpec(
                    "Launch Price",
                    getLaunchPrice(
                        gpu
                    )
                )}

            </div>

        </div>
    `;


    document.title =
        `${gpu.model || "GPU"} – GPU Nexus`;
}

function createGpuPageSpec(
    label,
    value
) {

    return `
        <article class="gpu-page-spec">

            <span>
                ${escapeHTML(
                    label
                )}
            </span>

            <strong>
                ${escapeHTML(
                    value ??
                    "--"
                )}
            </strong>

        </article>
    `;
}


function formatGpuPageNumber(
    value
) {

    if (value === null || value === undefined || value === "") return "--";

    const numeric =
        Number(value);


    return Number.isFinite(
        numeric
    )
        ? numeric.toLocaleString()
        : "--";
}


function renderGpuPageError(
    message
) {

    const container =
        $("gpuPageContent");


    if (!container) {
        return;
    }


    container.innerHTML = `

        <div class="gpu-page-error">

            <h2>
                ${escapeHTML(
                    message
                )}
            </h2>

            <a
                href="browse.html"
                class="primary-btn"
            >
                Browse GPUs
            </a>

        </div>
    `;
}


// ============================================
// START
// ============================================

document.addEventListener(
    "DOMContentLoaded",
    () => {

        // Show the page once we know who is signed in. A missing session
        // redirects to sign-in inside apiFetch; any other failure (API down)
        // still reveals the page so its error messages are visible.
        accountReady = loadAccount()
            .catch((error) => {
                console.error("Account check failed:", error);
                return null;
            });

        accountReady.then((account) => {
            if (account) loadFavorites();
        });

        accountReady
            .finally(() => {
                if (!redirectingToSignIn) {
                    document.documentElement.classList.remove("auth-checking");
                }
            });

        setupHomeSearch();

        setupGeminiChat();

        setupFavoritesPage();

        setupRecentlyViewed();

        setupSavedComparisons();

        setupGpuDetailsModal();

        setupComparePage();

        setupAnalyticsPage();

        setupRankingsPage();

        setupGpuDetailsPage();


        $("performanceMetric")
            ?.addEventListener(
                "change",
                (event) => {

                    renderPerformanceChart(
                        currentGPUs,
                        event.target.value
                    );
                }
            );


        // Only run dashboard API refresh
        // on pages that actually contain dashboard content
        if (hasDashboard()) {

            refreshDashboard();


            refreshTimer =
                window.setInterval(
                    refreshDashboard,
                    DASHBOARD_REFRESH_MS
                );


            document.addEventListener(
                "visibilitychange",
                () => {

                    if (
                        !document.hidden
                    ) {
                        refreshDashboard();
                    }
                }
            );
        }
    }
);


window.addEventListener(
    "beforeunload",
    () => {

        if (refreshTimer) {

            window.clearInterval(
                refreshTimer
            );
        }
    }
);