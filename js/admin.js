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

// The fields of a GPU, in form order. Options mirror the API's allowed values.
const FIELDS = [
    { name: "brand", label: "Brand", type: "select", options: ["NVIDIA", "AMD", "Intel"] },
    { name: "manufacturer", label: "Manufacturer", type: "select", options: ["NVIDIA", "AMD", "Intel", "ASUS", "MSI", "Gigabyte", "Zotac", "PNY", "Palit", "Colorful", "Gainward", "Inno3D", "EVGA", "PowerColor", "Sapphire", "XFX", "ASRock"] },
    { name: "model", label: "Model", type: "text", placeholder: "GeForce RTX 5070" },
    { name: "series", label: "Series", type: "text", placeholder: "GeForce RTX 50 Series" },
    { name: "architecture", label: "Architecture", type: "text", placeholder: "Blackwell" },
    { name: "vram", label: "VRAM", type: "text", placeholder: "12GB GDDR7" },
    { name: "memory_type", label: "Memory type", type: "select", options: ["DDR3", "GDDR5", "GDDR5X", "GDDR6", "GDDR6X", "GDDR7"] },
    { name: "memory_bus", label: "Memory bus", type: "text", placeholder: "192-bit" },
    { name: "memory_bandwidth_gbps", label: "Bandwidth (GB/s)", type: "number", step: "any", min: "0" },
    { name: "core_type", label: "Core type", type: "select", options: ["CUDA Cores", "Stream Processors", "Xe Cores"] },
    { name: "core_count", label: "Core count", type: "number", step: "1", min: "0" },
    { name: "cuda_cores", label: "CUDA cores", type: "number", step: "1", min: "0", hint: "0 for AMD and Intel" },
    { name: "base_clock", label: "Base clock", type: "text", placeholder: "2.16 GHz" },
    { name: "boost_clock", label: "Boost clock", type: "text", placeholder: "2.51 GHz" },
    { name: "power", label: "Power", type: "text", placeholder: "250W" },
    { name: "recommended_psu", label: "Recommended PSU", type: "text", placeholder: "650W" },
    { name: "process_node_nm", label: "Process node (nm)", type: "number", step: "1", min: "1" },
    { name: "pcie_interface", label: "PCIe interface", type: "select", options: ["PCIe 2.0 x8", "PCIe 2.0 x16", "PCIe 3.0 x4", "PCIe 3.0 x16", "PCIe 4.0 x8", "PCIe 4.0 x16", "PCIe 5.0 x8", "PCIe 5.0 x16"] },
    { name: "launch_price_usd", label: "Launch price (USD)", type: "number", step: "any", min: "0", optional: true, hint: "Leave empty if unknown" },
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
        showGate("Can't reach GPU Finder", "The API didn't answer. Try again in a moment.");
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
        brand.textContent = `${gpu.brand} · ${gpu.manufacturer}`;
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
        actions.append(button("Delete", "is-danger", () => confirmDelete(gpu)));
        row.insertCell().append(actions);
    }
}

function thumbnail(gpu) {
    const frame = document.createElement("div");
    frame.className = "admin-thumb";

    if (isBucketUrl(gpu.image_url)) {
        const img = document.createElement("img");
        img.src = gpu.image_url;
        img.alt = "";
        img.loading = "lazy";
        frame.append(img);
    } else {
        frame.textContent = "None";
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
            input.type = field.type;
            if (field.step) input.step = field.step;
            if (field.min) input.min = field.min;
            if (field.type === "text") input.maxLength = 120;
            if (field.placeholder) input.placeholder = field.placeholder;
        }

        input.id = `f_${field.name}`;
        input.name = field.name;
        input.required = !field.optional;
        wrap.append(label, input);

        if (field.hint) {
            const hint = document.createElement("small");
            hint.textContent = field.hint;
            wrap.append(hint);
        }
        grid.append(wrap);
    }
}

function openForm(gpu = null) {
    editingId = gpu ? gpu.id : null;
    $("gpuDialogTitle").textContent = gpu ? `Edit #${gpu.id} ${gpu.model}` : "Add GPU";
    $("formError").hidden = true;

    for (const field of FIELDS) {
        const input = $(`f_${field.name}`);
        input.classList.remove("is-invalid");
        const value = gpu ? gpu[field.name] : "";
        input.value = value == null ? "" : value;
        if (!gpu && field.type === "select") input.selectedIndex = 0;
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

        if (field.type === "number") {
            const number = Number(raw);
            if (!Number.isFinite(number)) {
                missing.push(field);
                continue;
            }
            body[field.name] = field.step === "1" ? Math.trunc(number) : number;
        } else {
            body[field.name] = raw;
        }
    }

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
