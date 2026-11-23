
let allGPUs = [];
let filteredGPUs = [];
let selectedGPU = null;


const browseSearchForm =
    document.getElementById(
        "homeSearchForm"
    );


const browseSearchInput =
    document.getElementById(
        "searchInput"
    );


const sortSelect =
    document.getElementById(
        "sortSelect"
    );


const browseGpuGrid =
    document.getElementById(
        "browseGpuGrid"
    );


const resultsCount =
    document.getElementById(
        "resultsCount"
    );


const browseLayout =
    document.getElementById(
        "browseLayout"
    );


const detailsSidebar =
    document.getElementById(
        "detailsSidebar"
    );


const detailsEmpty =
    document.getElementById(
        "detailsEmpty"
    );


const detailsContent =
    document.getElementById(
        "detailsContent"
    );


const detailsBody =
    document.getElementById(
        "detailsBody"
    );


const detailsClose =
    document.getElementById(
        "detailsClose"
    );

document.addEventListener("DOMContentLoaded", async () => {
    setupBrowseEvents();
    await loadBrowseGPUs();
});

function setupBrowseEvents() {

    // Live filtering while typing on Browse
    browseSearchInput
        ?.addEventListener(
            "input",
            () => {

                applyBrowseFilters();
            }
        );


    setupFilterMenu();


    sortSelect
        ?.addEventListener(
            "change",
            () => {

                applyBrowseFilters();
            }
        );


    detailsClose
        ?.addEventListener(
            "click",
            closeDetailsSidebar
        );
}

async function loadBrowseGPUs() {

    try {

        allGPUs =
            await fetchGPUs();


        // Read search sent from another page
        const params =
            new URLSearchParams(
                window.location.search
            );


        const query =
            params.get("q") ||
            "";


        if (browseSearchInput) {

            browseSearchInput.value =
                query;
        }

        buildFilterOptions(params.get("brand"));


        applyBrowseFilters();


    } catch (error) {

        console.error(
            "Browse GPU load error:",
            error
        );


        if (browseGpuGrid) {
            // showLoadError lives in script.js, which loads after this file
            showLoadError(browseGpuGrid, { replace: true });
        }
    }
}

function applyBrowseFilters() {
    const query = browseSearchInput.value.trim().toLowerCase();
    const sortValue = sortSelect.value;
    const filters = readFilters();

    filteredGPUs = allGPUs.filter((gpu) => {
        if (!matchesFilters(gpu, filters)) return false;

        if (!query) return true;

        const haystack = [
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

        return haystack.includes(query);
    });

    filteredGPUs = sortGPUs(filteredGPUs, sortValue);

    renderBrowseGrid(filteredGPUs);
    updateBrowseCount(filteredGPUs.length, query);
    updateFilterSummary(filters, filteredGPUs.length);

    if (selectedGPU) {
        const stillVisible = filteredGPUs.find(
            (gpu) => Number(gpu.id) === Number(selectedGPU.id)
        );

        if (!stillVisible) {
            closeDetailsSidebar();
        } else {
            openDetailsSidebar(stillVisible);
        }
    }
}

function sortGPUs(gpus, sortValue) {
    const list = [...gpus];

    switch (sortValue) {
        case "newest":
            list.sort(
                (a, b) =>
                    getReleaseTimestamp(b.release_date) -
                    getReleaseTimestamp(a.release_date)
            );
            break;

        case "oldest":
            list.sort(
                (a, b) =>
                    getReleaseTimestamp(a.release_date) -
                    getReleaseTimestamp(b.release_date)
            );
            break;

        case "price-high":
            list.sort(
                (a, b) =>
                    getPriceNumber(b) - getPriceNumber(a)
            );
            break;

        case "price-low":
            list.sort(
                (a, b) =>
                    getPriceNumber(a) - getPriceNumber(b)
            );
            break;

        case "vram-high":
            list.sort(
                (a, b) =>
                    getVramNumber(b.vram) - getVramNumber(a.vram)
            );
            break;

        case "name-az":
            list.sort((a, b) =>
                `${a.brand} ${a.model}`.localeCompare(
                    `${b.brand} ${b.model}`
                )
            );
            break;
    }

    return list;
}

function renderBrowseGrid(gpus) {
    browseGpuGrid.innerHTML = "";

    if (!gpus.length) {
        browseGpuGrid.innerHTML = `
            <div class="empty-state">
                No GPUs match your search and filters.
            </div>
        `;
        return;
    }

    gpus.forEach((gpu) => {
        const card = document.createElement("article");
        card.className = "gpu-card";

        const brand = gpu.brand || "GPU";
        const model = gpu.model || "Unknown GPU";
        const vram = gpu.vram || "--";
        const description =
            gpu.description ||
            `${gpu.architecture || "High-performance"} graphics card.`;

        const price = getLaunchPrice(gpu);
        const imagePath = getImageFile(gpu);

        card.innerHTML = `
            <div class="gpu-image-wrapper">
                <button
                    class="gpu-favorite browse-favorite"
                    type="button"
                    data-gpu-id="${escapeHTML(String(gpu.id ?? ""))}"
                    aria-pressed="false"
                >${iconSVG("heart")}</button>
                <img
                    src="${escapeHTML(imagePath)}"
                    alt="${escapeHTML(`${brand} ${model}`)}"
                    class="gpu-image"
                    loading="lazy"
                    data-hide-on-error
                >
            </div>

            <div class="gpu-card-body">
                <h3>${escapeHTML(model)}</h3>

                <p class="gpu-memory">
                    ${escapeHTML(vram)}
                </p>

                <p class="gpu-description">
                    ${escapeHTML(description)}
                </p>

                <div class="gpu-price">
                    ${escapeHTML(price)}
                </div>

                <button
                    class="gpu-details-button"
                    type="button"
                    data-gpu-id="${gpu.id}"
                >
                    View Details
                    ${iconSVG("arrowRight")}
                </button>
            </div>
        `;

        card.querySelector(".gpu-details-button")?.addEventListener("click", () => {
            openDetailsSidebar(gpu);
        });

        // Heart saves to the account (shared helpers in script.js).
        const heart = card.querySelector(".browse-favorite");
        paintFavoriteButton(heart, getFavoriteIds().has(String(gpu.id)));
        heart.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleFavorite(heart, gpu.id);
        });

        browseGpuGrid.appendChild(card);
    });
}

function openDetailsSidebar(gpu) {
    selectedGPU = gpu;
    recordRecentView(gpu.id);

    browseLayout.classList.add("details-open");
    detailsEmpty.hidden = true;
    detailsContent.hidden = false;

    const imagePath = getImageFile(gpu);

    detailsBody.innerHTML = `
        <div class="details-body">

            <div class="details-image-wrap">
                <img
                    src="${escapeHTML(imagePath)}"
                    alt="${escapeHTML(gpu.model || "GPU")}"
                    data-hide-on-error
                >
            </div>

            <span class="details-brand">
                ${escapeHTML(gpu.brand || "GPU")}
            </span>

            <div class="details-title-row">
                <h2 class="details-title">
                    ${escapeHTML(gpu.model || "Unknown GPU")}
                </h2>
                <button
                    class="gpu-favorite details-favorite"
                    type="button"
                    data-gpu-id="${escapeHTML(String(gpu.id ?? ""))}"
                    aria-pressed="false"
                >${iconSVG("heart")}</button>
            </div>

            <p class="details-series">
                ${escapeHTML(gpu.series || "--")}
            </p>

            <p class="details-description">
                ${escapeHTML(gpu.description || "No description available.")}
            </p>

            <div class="details-price">
                ${escapeHTML(getLaunchPrice(gpu))}
            </div>

            <div class="details-spec-grid">
                ${renderDetailSpec("Architecture", gpu.architecture)}
                ${renderDetailSpec("VRAM", gpu.vram)}
                ${renderDetailSpec("Memory Type", gpu.memory_type)}
                ${renderDetailSpec("Core Count", formatNumber(gpu.core_count))}
                ${renderDetailSpec("Core Type", gpu.core_type)}
                ${renderDetailSpec("Memory Bus", gpu.memory_bus)}
                ${renderDetailSpec("Memory Bandwidth", gpu.memory_bandwidth || `${gpu.memory_bandwidth_gbps ?? "--"} GB/s`)}
                ${renderDetailSpec("Base Clock", gpu.base_clock)}
                ${renderDetailSpec("Boost Clock", gpu.boost_clock)}
                ${renderDetailSpec("Power", gpu.power)}
                ${renderDetailSpec("Recommended PSU", gpu.recommended_psu)}
                ${renderDetailSpec("PCIe Interface", gpu.pcie_interface)}
                ${renderDetailSpec("Process Node", gpu.process_node_nm ? `${gpu.process_node_nm} nm` : "--")}
                ${renderDetailSpec("Release Date", gpu.release_date)}
            </div>

        </div>
    `;

    const heart = detailsBody.querySelector(".details-favorite");
    paintFavoriteButton(heart, getFavoriteIds().has(String(gpu.id)));
    heart.addEventListener("click", () => toggleFavorite(heart, gpu.id));
}

function closeDetailsSidebar() {
    selectedGPU = null;
    browseLayout.classList.remove("details-open");
    detailsEmpty.hidden = false;
    detailsContent.hidden = true;
    detailsBody.innerHTML = "";
}

function renderDetailSpec(label, value) {
    return `
        <div class="details-spec">
            <span>${escapeHTML(label)}</span>
            <strong>${escapeHTML(value ?? "--")}</strong>
        </div>
    `;
}

// ============================================
// FILTERS: dropdown with checklists + VRAM slider
// ============================================

// Each checklist and the GPU field it reads. Brand always lists the three
// makers; the others list whatever the catalog has.
const FILTER_GROUPS = [
    { id: "filterBrand", key: "brand", always: ["NVIDIA", "AMD", "Intel"] },
    { id: "filterArchitecture", key: "architecture" },
    { id: "filterMemory", key: "memory_type" },
];

// Slider stops are the VRAM sizes that exist in the catalog, so every stop
// changes the results (stop 0 = Any).
let vramStops = [0];

function setupFilterMenu() {
    const menu = document.getElementById("filterMenu");
    const toggle = document.getElementById("filterToggle");
    const panel = document.getElementById("filterPanel");
    if (!menu || !toggle || !panel) return;

    const setOpen = (open) => {
        menu.classList.toggle("is-open", open);
        toggle.setAttribute("aria-expanded", String(open));
        if (open) panel.querySelector("input:not(:disabled)")?.focus();
    };

    toggle.addEventListener("click", () => setOpen(!menu.classList.contains("is-open")));

    document.getElementById("filterDone")?.addEventListener("click", () => {
        setOpen(false);
        toggle.focus();
    });

    document.getElementById("filterClear")?.addEventListener("click", () => {
        panel.querySelectorAll('input[type="checkbox"]').forEach((box) => { box.checked = false; });
        const range = document.getElementById("vramRange");
        if (range) range.value = "0";
        applyBrowseFilters();
    });

    // results update as boxes are ticked or the slider moves
    panel.addEventListener("input", applyBrowseFilters);

    // close on Escape or a click outside
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && menu.classList.contains("is-open")) {
            setOpen(false);
            toggle.focus();
        }
    });
    document.addEventListener("click", (event) => {
        if (menu.classList.contains("is-open") && !menu.contains(event.target)) setOpen(false);
    });
}

// Fill the checklists from the loaded catalog. ?brand=AMD ticks that brand.
function buildFilterOptions(brandFromUrl) {
    for (const group of FILTER_GROUPS) {
        const box = document.getElementById(group.id);
        if (!box) continue;

        const counts = new Map();
        for (const name of group.always || []) counts.set(name, 0);
        for (const gpu of allGPUs) {
            const value = String(gpu[group.key] || "").trim();
            if (!value) continue;
            const known = [...counts.keys()].find((k) => k.toLowerCase() === value.toLowerCase());
            const name = known || value;
            counts.set(name, (counts.get(name) || 0) + 1);
        }

        // brands keep their fixed order; the rest go most common first
        const entries = [...counts.entries()];
        if (!group.always) entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

        box.replaceChildren(...entries.map(([value, count]) => {
            const label = document.createElement("label");
            label.className = "filter-option";

            const input = document.createElement("input");
            input.type = "checkbox";
            input.name = group.key;
            input.value = value;
            // a brand the catalog doesn't carry yet can't be picked
            input.disabled = count === 0;
            input.checked = group.key === "brand" && count > 0
                && value.toLowerCase() === String(brandFromUrl || "").toLowerCase();

            const text = document.createElement("span");
            text.textContent = value;

            const num = document.createElement("span");
            num.className = "filter-option-count";
            num.textContent = count;

            label.append(input, text, num);
            return label;
        }));
    }

    vramStops = [0, ...new Set(allGPUs.map((g) => getVramNumber(g.vram)).filter((n) => n > 0))]
        .sort((a, b) => a - b);

    const range = document.getElementById("vramRange");
    if (range) {
        range.max = String(vramStops.length - 1);
        range.value = "0";
        range.disabled = vramStops.length < 2;
    }
    const maxLabel = document.getElementById("vramMaxLabel");
    if (maxLabel) maxLabel.textContent = `${vramStops[vramStops.length - 1]}GB`;
}

function readFilters() {
    const checked = (key) => new Set(
        [...document.querySelectorAll(`#filterPanel input[name="${key}"]:checked`)]
            .map((box) => box.value.toLowerCase())
    );

    return {
        brand: checked("brand"),
        architecture: checked("architecture"),
        memory_type: checked("memory_type"),
        minVram: vramStops[Number(document.getElementById("vramRange")?.value || 0)] || 0,
    };
}

// Nothing ticked in a list = no limit. Ticking several in one list shows
// any of them (NVIDIA or AMD); different lists narrow each other.
function matchesFilters(gpu, filters) {
    for (const key of ["brand", "architecture", "memory_type"]) {
        const picked = filters[key];
        if (picked.size && !picked.has(String(gpu[key] || "").toLowerCase())) return false;
    }
    return !filters.minVram || getVramNumber(gpu.vram) >= filters.minVram;
}

// Badge on the Filters button, slider readout, "Show N GPUs" button.
function updateFilterSummary(filters, count) {
    const active = filters.brand.size + filters.architecture.size
        + filters.memory_type.size + (filters.minVram ? 1 : 0);

    const badge = document.getElementById("filterBadge");
    if (badge) {
        badge.hidden = active === 0;
        badge.textContent = active;
    }
    document.getElementById("filterToggle")
        ?.setAttribute("aria-label", active ? `Filters, ${active} active` : "Filters");

    const value = document.getElementById("vramValue");
    if (value) value.textContent = filters.minVram ? `${filters.minVram}GB or more` : "Any";

    const done = document.getElementById("filterDone");
    if (done) done.textContent = `Show ${count} GPU${count === 1 ? "" : "s"}`;

    const clear = document.getElementById("filterClear");
    if (clear) clear.disabled = active === 0;
}

function updateBrowseCount(count, query) {
    if (!resultsCount) return;

    if (query) {
        resultsCount.textContent = `${count} result${count !== 1 ? "s" : ""} for "${query}"`;
    } else {
        resultsCount.textContent = `${count} GPU${count !== 1 ? "s" : ""}`;
    }
}


function getPriceNumber(gpu) {
    const numeric = Number(gpu.launch_price_usd);
    return Number.isFinite(numeric) ? numeric : 0;
}

function getVramNumber(vram) {
    const match = String(vram || "").match(/(\d+(\.\d+)?)/);
    return match ? Number(match[1]) : 0;
}

function getBrowseReleaseTimestamp(
    releaseDate
) {

    const parsed =
        new Date(
            releaseDate || 0
        );


    return Number.isNaN(
        parsed.getTime()
    )
        ? 0
        : parsed.getTime();
}
function formatNumber(value) {
    if (value === null || value === undefined || value === "") {
        return "--";
    }

    const numeric = Number(value);

    if (Number.isFinite(numeric)) {
        return numeric.toLocaleString();
    }

    return String(value);
}
