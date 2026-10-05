
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


        applyBrowseFilters();


    } catch (error) {

        console.error(
            "Browse GPU load error:",
            error
        );


        if (browseGpuGrid) {

            browseGpuGrid.innerHTML = `
                <div class="empty-state">
                    Unable to load GPUs.
                </div>
            `;
        }
    }
}

function applyBrowseFilters() {
    const query = browseSearchInput.value.trim().toLowerCase();
    const sortValue = sortSelect.value;

    filteredGPUs = allGPUs.filter((gpu) => {
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
                No GPUs matched your search.
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
                <img
                    src="${escapeHTML(imagePath)}"
                    alt="${escapeHTML(`${brand} ${model}`)}"
                    class="gpu-image"
                    loading="lazy"
                    onerror="this.style.display='none'"
                >
            </div>

            <div class="gpu-card-body">
                <h3>${escapeHTML(`${brand} ${model}`)}</h3>

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
                    <span>→</span>
                </button>
            </div>
        `;

        card.querySelector(".gpu-details-button")?.addEventListener("click", () => {
            openDetailsSidebar(gpu);
        });

        browseGpuGrid.appendChild(card);
    });
}

function openDetailsSidebar(gpu) {
    selectedGPU = gpu;

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
                    onerror="this.style.display='none'"
                >
            </div>

            <span class="details-brand">
                ${escapeHTML(gpu.brand || "GPU")}
            </span>

            <h2 class="details-title">
                ${escapeHTML(gpu.model || "Unknown GPU")}
            </h2>

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
