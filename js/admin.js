// ============================================
// GPU Finder Admin (/admin)
// Not linked from the site. Hiding it is only a convenience: every action
// here is checked again by the API, which refuses anyone without the admin
// role (401 not signed in, 403 not admin).
// ============================================

const API = "/api";
const IMAGE_BUCKET = "https://irchyhaoodwsumlfsbbc.supabase.co/storage/v1/object/public/gpu-images/";
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

const $ = (id) => document.getElementById(id);

// ---------- unit fields ----------
// The catalog stores some values as text with a unit ("12GB GDDR7",
// "192-bit", "2.41 GHz", "250W"). The form takes only the number and adds
// the unit, so every GPU is written the same way.

// First number in a stored value: "12GB GDDR7" -> 12, "2.41 GHz" -> 2.41.
function firstNumber(text) {
    const match = String(text ?? "").replace(",", ".").match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : "";
}

// Trim floating-point noise: 2.4100000001 -> "2.41".
function tidy(n) {
    return String(Number(n.toFixed(3)));
}

const UNIT = {
    vram: {
        suffix: "GB",
        toText: (n, form) => `${tidy(n)}GB ${form.memory_type}`,
        fromText: firstNumber,
    },
    bus: {
        suffix: "-bit",
        toText: (n) => `${Math.round(n)}-bit`,
        fromText: firstNumber,
    },
    clock: {
        suffix: "GHz",
        // 2410 is clearly MHz: store it as 2.41 GHz.
        toText: (n) => `${tidy(n >= 50 ? n / 1000 : n)} GHz`,
        fromText: (text) => {
            const n = firstNumber(text);
            return n !== "" && /mhz/i.test(text) ? n / 1000 : n;
        },
        hint: "MHz also works (2410 → 2.41 GHz)",
    },
    watts: {
        suffix: "W",
        toText: (n) => `${Math.round(n)}W`,
        fromText: firstNumber,
    },
};

// Core type follows the brand; NVIDIA's cores are CUDA cores.
const CORE_TYPE_FOR_BRAND = { NVIDIA: "CUDA Cores", AMD: "Stream Processors", Intel: "Xe Cores" };

// The fields of a GPU, in form order. Options mirror the API's allowed
// values, newest first so the defaults suit a new card.
const FIELDS = [
    { name: "brand", label: "Brand", type: "select", options: ["NVIDIA", "AMD", "Intel"] },
    { name: "manufacturer", label: "Manufacturer", type: "select", options: ["NVIDIA", "AMD", "Intel", "ASUS", "MSI", "Gigabyte", "Zotac", "PNY", "Palit", "Colorful", "Gainward", "Inno3D", "EVGA", "PowerColor", "Sapphire", "XFX", "ASRock"] },
    { name: "model", label: "Model", type: "text", placeholder: "GeForce RTX 5070" },
    { name: "series", label: "Series", type: "text", placeholder: "GeForce RTX 50 Series" },
    { name: "architecture", label: "Architecture", type: "text", placeholder: "Blackwell" },
    { name: "memory_type", label: "Memory type", type: "select", options: ["GDDR7", "GDDR6X", "GDDR6", "GDDR5X", "GDDR5", "DDR3"] },
    { name: "vram", label: "VRAM", unit: UNIT.vram, step: "any", min: "0.5", placeholder: "12" },
    { name: "memory_bus", label: "Memory bus", unit: UNIT.bus, step: "1", min: "8", placeholder: "192" },
    { name: "memory_bandwidth_gbps", label: "Bandwidth", type: "number", suffix: "GB/s", step: "any", min: "0", placeholder: "672" },
    { name: "core_type", label: "Core type", type: "select", options: ["CUDA Cores", "Stream Processors", "Xe Cores"], hint: "Set from the brand" },
    { name: "core_count", label: "Core count", type: "number", step: "1", min: "0", placeholder: "6144" },
    { name: "base_clock", label: "Base clock", unit: UNIT.clock, step: "any", min: "0.1", placeholder: "2.16" },
    { name: "boost_clock", label: "Boost clock", unit: UNIT.clock, step: "any", min: "0.1", placeholder: "2.51" },
    { name: "power", label: "Power", unit: UNIT.watts, step: "1", min: "1", placeholder: "250" },
    { name: "recommended_psu", label: "Recommended PSU", unit: UNIT.watts, step: "1", min: "1", placeholder: "650" },
    { name: "process_node_nm", label: "Process node", type: "number", suffix: "nm", step: "1", min: "1", placeholder: "4" },
    { name: "pcie_interface", label: "PCIe interface", type: "select", options: ["PCIe 5.0 x16", "PCIe 5.0 x8", "PCIe 4.0 x16", "PCIe 4.0 x8", "PCIe 3.0 x16", "PCIe 3.0 x4", "PCIe 2.0 x16", "PCIe 2.0 x8"] },
    { name: "launch_price_usd", label: "Launch price", type: "number", prefix: "$", step: "any", min: "1", optional: true, hint: "Leave empty if unknown" },
    { name: "release_date", label: "Release date", type: "date" },
    { name: "description", label: "Description", type: "textarea", wide: true },
];

let gpus = [];
let editingId = null;          // null = adding a new GPU
let pictureTarget = null;      // GPU whose picture is being changed
let confirmAction = null;


// ---------- API ----------

async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
        credentials: "same-origin",
        cache: "no-store",
        ...options,
        headers: {
            Accept: "application/json",
            "X-Requested-With": "fetch",
            ...(options.headers || {}),
        },
    });

    if (response.status === 401) {
        location.replace("/signin.html?next=admin/");
        throw new Error("Not signed in.");
    }

    const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
    return { response, data };
}

function apiError(data, fallback) {
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
        return data.detail
            .map((d) => `${fieldLabel(d.loc?.slice(-1)[0])}: ${d.msg}`)
            .join("\n");
    }
    return fallback;
}

function fieldLabel(name) {
    return FIELDS.find((f) => f.name === name)?.label || name || "Field";
}


// ---------- access check ----------

async function start() {
    let account;

    try {
        const { response, data } = await api("/auth/me");
        if (!response.ok) throw new Error(String(response.status));
        account = data;
    } catch (error) {
        if (error.message === "Not signed in.") return;
        showGate("Can't reach GPU Nexus", "The API didn't answer. Try again in a moment.");
        return;
    }

    if (account.role !== "admin") {
        showGate("Admins only", "Your account doesn't have access to this page.");
        return;
    }

    $("adminEmail").textContent = account.email;
    $("adminGate").hidden = true;
    $("adminApp").hidden = false;
    document.body.classList.remove("admin-checking");

    buildForm();
    wireEvents();
    loadReports();
    await loadGpus();
}

function showGate(title, text) {
    $("gateTitle").textContent = title;
    $("gateText").textContent = text;
    $("gateLink").hidden = false;
    document.body.classList.remove("admin-checking");
}


// ---------- catalog ----------

async function loadGpus() {
    const { response, data } = await api("/gpus");

    if (!response.ok) {
        showNotice(apiError(data, "Couldn't load GPUs."), true);
        return;
    }

    gpus = Array.isArray(data.gpus) ? data.gpus : [];
    renderStats();
    renderRows();
    loadActivity(true);
}

function renderStats() {
    const withPicture = gpus.filter((g) => isBucketUrl(g.image_url)).length;
    $("statTotal").textContent = gpus.length;
    $("statPictures").textContent = withPicture;
    $("statNoPicture").textContent = gpus.length - withPicture;
    $("statBrands").textContent = new Set(gpus.map((g) => g.brand)).size;
}

function renderRows() {
    const query = $("search").value.trim().toLowerCase();
    const onlyMissing = $("onlyMissing").checked;
    const body = $("gpuRows");

    const shown = gpus
        .filter((g) => !onlyMissing || !isBucketUrl(g.image_url))
        .filter((g) => !query || [g.model, g.series, g.architecture, g.brand, g.manufacturer, g.vram]
            .join(" ").toLowerCase().includes(query))
        .sort((a, b) => a.id - b.id);

    body.replaceChildren();

    if (!shown.length) {
        const row = body.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 8;
        cell.className = "admin-empty";
        cell.textContent = gpus.length ? "No GPUs match." : "No GPUs yet. Add the first one.";
        return;
    }

    for (const gpu of shown) {
        const row = body.insertRow();

        row.insertCell().textContent = gpu.id;
        row.insertCell().append(thumbnail(gpu));

        const model = row.insertCell();
        model.className = "admin-model";
        model.textContent = gpu.model;
        const brand = document.createElement("small");
        // the maker is only worth showing when it differs from the brand (e.g. ASUS for NVIDIA)
        brand.textContent = [gpu.brand, gpu.architecture, gpu.manufacturer && gpu.manufacturer !== gpu.brand ? gpu.manufacturer : ""]
            .filter(Boolean).join(" · ");
        model.append(brand);

        row.insertCell().textContent = gpu.series;
        row.insertCell().textContent = gpu.vram;
        row.insertCell().textContent = gpu.release_date;
        row.insertCell().textContent = gpu.launch_price_usd == null
            ? "—"
            : `$${Number(gpu.launch_price_usd).toLocaleString()}`;

        const actions = document.createElement("div");
        actions.className = "admin-actions";
        actions.append(
            button("Edit", "is-ghost", () => openForm(gpu)),
            button(isBucketUrl(gpu.image_url) ? "Change picture" : "Add picture", "is-ghost", () => choosePicture(gpu)),
        );
        if (isBucketUrl(gpu.image_url)) {
            actions.append(button("Remove picture", "is-ghost", () => removePicture(gpu)));
        }
        actions.append(button("Delete", "is-danger-quiet", () => confirmDelete(gpu)));
        row.insertCell().append(actions);
    }
}

const NO_PICTURE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-4.5-4.5L7 19"/></svg><span class="visually-hidden">No picture</span>';

function thumbnail(gpu) {
    const frame = document.createElement("div");
    frame.className = "admin-thumb";

    if (isBucketUrl(gpu.image_url)) {
        const img = document.createElement("img");
        img.src = gpu.image_url;
        img.alt = "";
        img.loading = "lazy";
        // a picture URL whose file is gone shows the same icon as "no picture"
        img.addEventListener("error", () => {
            frame.classList.add("is-empty");
            frame.title = "Picture file missing";
            frame.innerHTML = NO_PICTURE_ICON;
        }, { once: true });
        frame.append(img);
    } else {
        frame.classList.add("is-empty");
        frame.title = "No picture yet";
        frame.innerHTML = NO_PICTURE_ICON;
    }
    return frame;
}

function button(label, style, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `admin-btn is-small ${style}`;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
}

function isBucketUrl(url) {
    return typeof url === "string" && url.startsWith(IMAGE_BUCKET);
}

function showNotice(text, isError = false) {
    const box = $("notice");
    box.textContent = text;
    box.classList.toggle("is-error", isError);
    box.hidden = false;
    clearTimeout(showNotice.timer);
    if (!isError) showNotice.timer = setTimeout(() => { box.hidden = true; }, 6000);
}


// ---------- activity log ----------

const ACTION_LABELS = {
    "gpu.create": ["Added", "is-create"],
    "gpu.update": ["Edited", "is-update"],
    "gpu.delete": ["Deleted", "is-delete"],
    "image.upload": ["Picture set", "is-picture"],
    "image.remove": ["Picture removed", "is-picture"],
};
const ACTIVITY_PAGE = 25;
let activityOffset = 0;

function formatWhen(iso) {
    if (!iso) return "—";   // new Date(null) is 1 Jan 1970
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso || "";
    return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// "gpu.bulk_import" -> "Bulk import" for actions this page has no label for
function actionWords(action) {
    const words = String(action || "").split(".").pop().replace(/[_-]+/g, " ").trim();
    return words ? words[0].toUpperCase() + words.slice(1) : "Changed";
}

function summarizeChanges(changes) {
    if (!changes || typeof changes !== "object") return "";
    return Object.entries(changes)
        .map(([field, pair]) => {
            const [before, after] = Array.isArray(pair) ? pair : [undefined, pair];
            const show = (v) => (v == null || v === "" ? "—" : String(v)).slice(0, 40);
            return `${fieldLabel(field)}: ${show(before)} → ${show(after)}`;
        })
        .join("\n");
}

async function loadActivity(reset = true) {
    if (reset) activityOffset = 0;
    const body = $("activityRows");

    let data;
    try {
        const result = await api(`/admin/audit?limit=${ACTIVITY_PAGE}&offset=${activityOffset}`);
        if (!result.response.ok) throw new Error(apiError(result.data, "Couldn't load activity."));
        data = result.data;
    } catch (error) {
        body.replaceChildren();
        const row = body.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 5;
        cell.className = "admin-empty";
        cell.textContent = error.message || "Couldn't load activity.";
        return;
    }

    if (reset) body.replaceChildren();
    const entries = data.entries || [];

    if (reset && !entries.length) {
        const row = body.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 5;
        cell.className = "admin-empty";
        cell.textContent = "No changes yet. Adding, editing or deleting GPUs shows up here.";
    }

    for (const entry of entries) {
        const row = body.insertRow();
        row.insertCell().textContent = formatWhen(entry.created_at);
        row.insertCell().textContent = entry.admin_email || "—";

        const [label, style] = ACTION_LABELS[entry.action] || [actionWords(entry.action), ""];
        const pill = document.createElement("span");
        pill.className = `admin-action ${style}`;
        pill.textContent = label;
        row.insertCell().append(pill);

        row.insertCell().textContent = entry.gpu_id
            ? `#${entry.gpu_id} ${entry.gpu_model || ""}`.trim()
            : (entry.gpu_model || "—");

        const changes = row.insertCell();
        changes.className = "admin-changes";
        const summary = summarizeChanges(entry.changes) || "—";
        const clamp = document.createElement("div");
        clamp.className = "admin-changes-text";
        clamp.textContent = summary;
        if (summary.split("\n").length > 3) clamp.title = summary;
        changes.append(clamp);
    }

    activityOffset += entries.length;
    $("activityTotal").textContent = data.total
        ? `${Number(data.total).toLocaleString()} change${data.total === 1 ? "" : "s"}`
        : "";
    $("activityMore").hidden = activityOffset >= (data.total || 0);
}


// ---------- add / edit ----------

function buildForm() {
    const grid = $("formFields");

    for (const field of FIELDS) {
        const wrap = document.createElement("div");
        wrap.className = "admin-field" + (field.wide ? " is-wide" : "");

        const label = document.createElement("label");
        label.htmlFor = `f_${field.name}`;
        label.textContent = field.label + (field.optional ? " (optional)" : "");

        let input;
        if (field.type === "select") {
            input = document.createElement("select");
            for (const value of field.options) {
                input.append(new Option(value, value));
            }
        } else if (field.type === "textarea") {
            input = document.createElement("textarea");
            input.maxLength = 4000;
        } else {
            input = document.createElement("input");
            input.type = field.unit ? "number" : field.type;
            if (field.step) input.step = field.step;
            if (field.min) input.min = field.min;
            if (input.type === "text") input.maxLength = 120;
            if (input.type === "number") input.inputMode = "decimal";
            if (field.placeholder) input.placeholder = field.placeholder;
        }

        input.id = `f_${field.name}`;
        input.name = field.name;
        input.required = !field.optional;

        const prefix = field.prefix;
        const suffix = field.unit?.suffix || field.suffix;
        if (prefix || suffix) {
            // Number box with the unit shown inside it, e.g. [ 250 | W ].
            const box = document.createElement("div");
            box.className = "admin-affix";
            if (prefix) box.append(affix(prefix, "is-prefix"));
            box.append(input);
            if (suffix) box.append(affix(suffix, "is-suffix"));
            wrap.append(label, box);
        } else {
            wrap.append(label, input);
        }

        const hintText = field.hint || field.unit?.hint;
        if (field.unit) {
            const preview = document.createElement("small");
            preview.className = "admin-preview";
            preview.id = `p_${field.name}`;
            wrap.append(preview);
        } else if (hintText) {
            const hint = document.createElement("small");
            hint.textContent = hintText;
            wrap.append(hint);
        }
        grid.append(wrap);
    }

    // Live "Saved as: ..." previews for the unit fields.
    grid.addEventListener("input", updatePreviews);
    grid.addEventListener("change", updatePreviews);

    // Brand drives the core type and, for reference cards, the manufacturer.
    $("f_brand").addEventListener("change", () => applyBrandDefaults());
}

function affix(text, className) {
    const span = document.createElement("span");
    span.className = `admin-affix-text ${className}`;
    span.textContent = text;
    span.setAttribute("aria-hidden", "true");
    return span;
}

function applyBrandDefaults() {
    const brand = $("f_brand").value;
    $("f_core_type").value = CORE_TYPE_FOR_BRAND[brand];
    const manufacturer = $("f_manufacturer");
    if (["NVIDIA", "AMD", "Intel"].includes(manufacturer.value)) {
        manufacturer.value = brand;
    }
    updatePreviews();
}

function updatePreviews() {
    const memoryType = $("f_memory_type").value;

    for (const field of FIELDS.filter((f) => f.unit)) {
        const raw = $(`f_${field.name}`).value.trim();
        const n = Number(raw);
        const preview = $(`p_${field.name}`);
        preview.textContent = raw && Number.isFinite(n) && n > 0
            ? `Saved as: ${field.unit.toText(n, { memory_type: memoryType })}`
            : (field.unit.hint || "");
    }
}

function openForm(gpu = null) {
    editingId = gpu ? gpu.id : null;
    $("gpuDialogTitle").textContent = gpu ? `Edit #${gpu.id} ${gpu.model}` : "Add GPU";
    $("formError").hidden = true;

    for (const field of FIELDS) {
        const input = $(`f_${field.name}`);
        input.classList.remove("is-invalid");
        let value = gpu ? gpu[field.name] : "";
        // Stored text like "12GB GDDR7" goes back into the box as 12.
        if (field.unit && gpu) value = field.unit.fromText(value);
        input.value = value == null ? "" : value;
        if (!gpu && field.type === "select") input.selectedIndex = 0;
    }

    if (gpu) {
        updatePreviews();
    } else {
        applyBrandDefaults();
    }

    $("gpuDialog").showModal();
    $(`f_${FIELDS[gpu ? 2 : 0].name}`).focus();
}

function readForm() {
    const body = {};
    const missing = [];

    for (const field of FIELDS) {
        const input = $(`f_${field.name}`);
        const raw = input.value.trim();
        input.classList.remove("is-invalid");

        if (!raw) {
            if (field.optional) {
                body[field.name] = null;
                continue;
            }
            missing.push(field);
            continue;
        }

        if (field.unit || field.type === "number") {
            const number = Number(raw);
            if (!Number.isFinite(number) || (field.unit && number <= 0)) {
                missing.push(field);
                continue;
            }
            if (field.unit) {
                // memory_type comes before vram in FIELDS, so it's already read.
                body[field.name] = field.unit.toText(number, body);
            } else {
                body[field.name] = field.step === "1" ? Math.trunc(number) : number;
            }
        } else {
            body[field.name] = raw;
        }
    }

    // NVIDIA lists its cores as CUDA cores; AMD and Intel have none.
    body.cuda_cores = body.brand === "NVIDIA" && Number.isFinite(body.core_count) ? body.core_count : 0;

    for (const field of missing) $(`f_${field.name}`).classList.add("is-invalid");
    return { body, missing };
}

async function saveForm(event) {
    event.preventDefault();
    const errorBox = $("formError");
    const { body, missing } = readForm();

    if (missing.length) {
        errorBox.textContent = `Fill in: ${missing.map((f) => f.label).join(", ")}.`;
        errorBox.hidden = false;
        $(`f_${missing[0].name}`).focus();
        return;
    }

    const save = $("saveGpu");
    save.disabled = true;

    try {
        const path = editingId ? `/gpus/${editingId}` : "/gpus";
        const { response, data } = await api(path, {
            method: editingId ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            errorBox.textContent = apiError(data, "Couldn't save the GPU.");
            errorBox.hidden = false;
            if (Array.isArray(data.detail)) {
                for (const d of data.detail) {
                    $(`f_${d.loc?.slice(-1)[0]}`)?.classList.add("is-invalid");
                }
            }
            return;
        }

        $("gpuDialog").close();
        showNotice(editingId ? `Saved #${data.id} ${data.model}.` : `Added #${data.id} ${data.model}. Add its picture next.`);
        await loadGpus();
    } catch {
        errorBox.textContent = "Can't reach the API. Check your connection.";
        errorBox.hidden = false;
    } finally {
        save.disabled = false;
    }
}


// ---------- delete ----------

function confirmDelete(gpu) {
    $("confirmTitle").textContent = `Delete #${gpu.id}?`;
    $("confirmText").textContent =
        `${gpu.model} will be removed from the catalog, together with its picture. This can't be undone.`;
    confirmAction = async () => {
        const { response, data } = await api(`/gpus/${gpu.id}`, { method: "DELETE" });
        if (!response.ok) {
            showNotice(apiError(data, "Couldn't delete the GPU."), true);
            return;
        }
        showNotice(`Deleted #${gpu.id} ${gpu.model}.`);
        await loadGpus();
    };
    $("confirmDialog").showModal();
}


// ---------- Marketplace reports ----------

const REPORT_REASONS = {
    scam: "Looks like a scam",
    wrong_item: "Not what it says",
    offensive: "Offensive",
    sold_elsewhere: "Already sold",
    other: "Something else",
};

async function loadReports() {
    const body = $("reportRows");
    const message = (text) => {
        body.replaceChildren();
        const cell = body.insertRow().insertCell();
        cell.colSpan = 5;
        cell.className = "admin-empty";
        cell.textContent = text;
    };
    let data;
    try {
        const result = await api("/admin/reports");
        if (!result.response.ok) throw new Error(apiError(result.data, "Couldn't load reports."));
        data = result.data;
    } catch (error) {
        // before market.sql runs, the Marketplace tables don't exist yet
        message(error.message || "Couldn't load reports.");
        return;
    }
    const reports = data.reports || [];
    $("reportsTotal").textContent = reports.length ? `${reports.length} open` : "";
    if (!reports.length) {
        message("No open reports. Members can report a listing from its page.");
        return;
    }
    body.replaceChildren();
    for (const report of reports) {
        const row = body.insertRow();
        row.insertCell().textContent = formatWhen(report.created_at);

        const listing = row.insertCell();
        listing.className = "admin-model";
        const link = document.createElement("a");
        link.href = `/market/#/listing/${report.listing.id}`;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = report.listing.title;
        listing.append(link);
        if (report.listing.status === "sold") {
            const note = document.createElement("small");
            note.textContent = "Marked sold";
            listing.append(note);
        }

        row.insertCell().textContent = REPORT_REASONS[report.reason] || report.reason;
        const details = row.insertCell();
        details.className = "admin-changes";
        details.textContent = report.details || "—";

        const actions = document.createElement("div");
        actions.className = "admin-actions";
        actions.append(
            button("Dismiss", "is-ghost", () => dismissReport(report)),
            button("Delete listing", "is-danger-quiet", () => confirmDeleteListing(report)),
        );
        row.insertCell().append(actions);
    }
}

async function dismissReport(report) {
    const { response, data } = await api(`/admin/reports/${report.id}`, { method: "DELETE" });
    if (!response.ok) {
        showNotice(apiError(data, "Couldn't dismiss the report."), true);
        return;
    }
    showNotice(`Dismissed the report on "${report.listing.title}".`);
    loadReports();
}

function confirmDeleteListing(report) {
    $("confirmTitle").textContent = "Delete this listing?";
    $("confirmText").textContent =
        `"${report.listing.title}" will be removed from the Marketplace with its photos, messages and reports. This can't be undone.`;
    confirmAction = async () => {
        const { response, data } = await api(`/listings/${report.listing.id}`, { method: "DELETE" });
        if (!response.ok) {
            showNotice(apiError(data, "Couldn't delete the listing."), true);
            return;
        }
        showNotice(`Deleted "${report.listing.title}".`);
        await loadReports();
    };
    $("confirmDialog").showModal();
}


// ---------- pictures ----------

function choosePicture(gpu) {
    pictureTarget = gpu;
    $("pictureInput").value = "";
    $("pictureInput").click();
}

async function uploadPicture() {
    const file = $("pictureInput").files[0];
    const gpu = pictureTarget;
    if (!file || !gpu) return;

    if (!IMAGE_TYPES.includes(file.type)) {
        showNotice("Choose a PNG, JPEG or WebP picture.", true);
        return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
        showNotice("The picture must be 4 MB or smaller.", true);
        return;
    }

    showNotice(`Uploading picture for ${gpu.model}...`);
    const form = new FormData();
    form.append("file", file);

    try {
        const { response, data } = await api(`/gpus/${gpu.id}/image`, { method: "POST", body: form });
        if (!response.ok) {
            showNotice(apiError(data, "Upload failed."), true);
            return;
        }
        showNotice(`Picture saved for ${gpu.model}.`);
        await loadGpus();
    } catch {
        showNotice("Upload failed. Check your connection.", true);
    }
}

async function removePicture(gpu) {
    const { response, data } = await api(`/gpus/${gpu.id}/image`, { method: "DELETE" });
    if (!response.ok) {
        showNotice(apiError(data, "Couldn't remove the picture."), true);
        return;
    }
    showNotice(`Picture removed from ${gpu.model}.`);
    await loadGpus();
}


// ---------- wiring ----------

function wireEvents() {
    $("search").addEventListener("input", renderRows);
    $("activityRefresh").addEventListener("click", () => loadActivity(true));
    $("reportsRefresh").addEventListener("click", loadReports);
    $("activityMore").addEventListener("click", () => loadActivity(false));
    $("onlyMissing").addEventListener("change", renderRows);
    $("addGpu").addEventListener("click", () => openForm());
    $("gpuForm").addEventListener("submit", saveForm);
    $("pictureInput").addEventListener("change", uploadPicture);

    for (const closer of document.querySelectorAll("[data-close]")) {
        closer.addEventListener("click", () => closer.closest("dialog").close());
    }

    $("confirmNo").addEventListener("click", () => $("confirmDialog").close());
    $("confirmYes").addEventListener("click", async () => {
        $("confirmYes").disabled = true;
        try {
            await confirmAction?.();
        } finally {
            $("confirmYes").disabled = false;
            $("confirmDialog").close();
        }
    });

    $("signOut").addEventListener("click", async () => {
        try {
            await fetch(`${API}/auth/logout`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "X-Requested-With": "fetch" },
            });
        } finally {
            location.replace("/signin.html");
        }
    });
}

document.addEventListener("DOMContentLoaded", start);
