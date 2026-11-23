// ============================================
// GPU Nexus: sign in, sign up, confirm email, reset password
// These pages don't load script.js, so they never redirect to themselves.
// ============================================

const AUTH_API = "/api";

const $ = (id) => document.getElementById(id);

async function authPost(path, body) {
    const response = await fetch(`${AUTH_API}${path}`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Requested-With": "fetch"
        },
        body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));
    return { response, data };
}

// FastAPI validation errors arrive as a list; show the first one plainly.
function errorText(data, fallback) {
    if (typeof data.detail === "string") return data.detail;

    if (Array.isArray(data.detail) && data.detail.length) {
        const field = data.detail[0].loc?.slice(-1)[0];
        if (field === "email") return "Enter a valid email address.";
        if (field === "password") return "Passwords must be 8 to 128 characters.";
        return data.detail[0].msg || fallback;
    }

    return fallback;
}


// ---------- messages ----------

// type: "error" | "success" | "info"
function showMessage(text, type = "error") {
    const box = $("authMessage");
    if (!box) return;

    box.replaceChildren(document.createTextNode(text));
    box.className = `auth-message is-${type}`;
    box.hidden = false;
}

// Buttons go on their own row under the message text.
function addMessageButton(label, onClick) {
    const box = $("authMessage");
    if (!box) return;

    let row = box.querySelector(".auth-actions");
    if (!row) {
        row = document.createElement("span");
        row.className = "auth-actions";
        box.append(row);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    row.append(button);
}

// Called at the start of every submit: clear the old message and any
// leftover field marks, so only this attempt's error shows.
function hideMessage() {
    const box = $("authMessage");
    if (box) box.hidden = true;

    document.querySelectorAll("[aria-invalid='true']").forEach((input) => {
        input.removeAttribute("aria-invalid");
    });

    document.querySelectorAll(".nx-field-error").forEach((error) => {
        error.hidden = true;
    });
}

// Point at the field the error is about: the message goes right under that
// field (so it can't scroll out of view when the cursor jumps there), the
// field is marked invalid, and the cursor moves to it. The top-of-card box
// stays for server and connection errors.
function flagField(input, text) {
    if (!input) {
        showMessage(text);
        return;
    }

    const field = input.closest(".nx-field");
    // the live "Passwords don't match" line already says it; don't repeat it
    const saidAlready = field?.querySelector(".nx-match[data-state='bad']:not([hidden])");

    if (field && !saidAlready) {
        const id = `${input.id}-error`;
        let error = document.getElementById(id);

        if (!error) {
            error = document.createElement("p");
            error.className = "nx-field-error";
            error.id = id;
            error.setAttribute("role", "alert");
            field.append(error);
        }

        error.textContent = text;
        error.hidden = false;

        const described = (input.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
        if (!described.includes(id)) input.setAttribute("aria-describedby", [...described, id].join(" "));
    } else if (!field) {
        showMessage(text);
    }

    input.setAttribute("aria-invalid", "true");
    input.focus();
    window.nxShake?.();
}


// ---------- page heading, lead and state ----------

const card = () => document.querySelector(".nx-card");

// lead: a string, or an array of strings and {strong: "..."} parts
function setHeading(title, lead) {
    const h1 = card()?.querySelector("h1");
    const p = card()?.querySelector(".nx-card-lead");

    if (h1 && title) h1.textContent = title;
    if (!p || lead == null) return;

    const parts = Array.isArray(lead) ? lead : [lead];
    p.replaceChildren(...parts.map((part) => {
        if (typeof part === "string") return document.createTextNode(part);
        const strong = document.createElement("strong");
        strong.textContent = part.strong;
        return strong;
    }));
}

// Drives the badge icon and colors on reset / confirm pages.
function setCardState(state) {
    const el = card();
    if (!el) return;
    if (state) el.dataset.state = state;
    else delete el.dataset.state;
}

function rememberHeading() {
    const h1 = card()?.querySelector("h1");
    const p = card()?.querySelector(".nx-card-lead");
    return { title: h1?.textContent || "", lead: p?.textContent || "" };
}


// ---------- small helpers ----------

function setBusy(form, busy, busyLabel) {
    const button = form.querySelector("button[type=submit]");

    if (!button.dataset.label) button.dataset.label = button.textContent;

    button.disabled = busy;
    button.textContent = busy ? busyLabel : button.dataset.label;
}

// Only allow returning to one of this site's own pages, never another
// website (?next=https://evil.example would otherwise be an open redirect).
function safeNext() {
    const next = new URLSearchParams(location.search).get("next") || "";
    if (next === "admin/") return "admin/";
    return /^[a-z0-9-]+\.html(\?[^#\s]*)?$/i.test(next) ? next : "index.html";
}

// Read the one-time secret from the link, then remove it from the address
// bar and history so it isn't left lying around.
function takeLinkToken() {
    const token = new URLSearchParams(location.search).get("token");
    if (token) history.replaceState(null, "", location.pathname);
    return token;
}

// Carry the typed email between sign in and reset (this tab only; never in the URL).
const EMAIL_KEY = "nx-email";

function rememberEmail(email) {
    try { if (email) sessionStorage.setItem(EMAIL_KEY, email); } catch { /* storage off */ }
}

function prefillEmail(input) {
    if (!input || input.value) return;
    try { input.value = sessionStorage.getItem(EMAIL_KEY) || ""; } catch { /* storage off */ }
}

function checkEmail(input) {
    const email = input.value.trim();

    if (!email) {
        flagField(input, "Enter your email address.");
        return null;
    }

    // type="email" still validates under novalidate; we just report it ourselves.
    if (!input.checkValidity()) {
        flagField(input, "Check the email address. It should look like you@example.com.");
        return null;
    }

    return email;
}

function checkPasswords(form) {
    const password = form.password.value;

    if (password.length < 8) {
        flagField(form.password, "Passwords must be at least 8 characters.");
        return null;
    }

    if (password !== form.confirm.value) {
        flagField(form.confirm, "The two passwords don't match.");
        return null;
    }

    return password;
}

async function resendVerification(email) {
    try {
        const { response, data } = await authPost("/auth/resend-verification", { email });

        if (response.ok) {
            showMessage("If that account still needs confirming, a new link is on its way. Check your inbox and spam folder.", "success");
        } else {
            showMessage(errorText(data, "Couldn't send a new link. Try again later."));
        }
    } catch {
        showMessage("Can't reach GPU Nexus right now. Check your connection.");
    }
}


// ---------- sign in ----------

async function setupSignIn() {
    // Already signed in? Go straight back.
    try {
        const me = await fetch(`${AUTH_API}/auth/me`, { credentials: "same-origin", cache: "no-store" });
        if (me.ok) {
            location.replace(safeNext());
            return;
        }
    } catch {
        // API unreachable; the form below will report it.
    }

    const params = new URLSearchParams(location.search);
    if (params.get("reset") === "1") {
        showMessage("Password changed. Sign in with your new password.", "success");
    }

    const form = $("authForm");
    prefillEmail(form.email);

    // "Forgot password?" takes the typed email along to the reset page.
    document.querySelector("a[href='reset.html']")?.addEventListener("click", () => {
        rememberEmail(form.email.value.trim());
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideMessage();

        const email = checkEmail(form.email);
        if (!email) return;

        const password = form.password.value;
        if (!password) {
            flagField(form.password, "Enter your password.");
            return;
        }

        setBusy(form, true, "Signing in…");

        try {
            const { response, data } = await authPost("/auth/login", { email, password });

            if (response.ok) {
                location.replace(safeNext());
                return;
            }

            showMessage(errorText(data, "Sign-in failed. Try again."));

            if (response.status === 403) {
                addMessageButton("Send a new confirmation link", () => resendVerification(email));
            } else if (response.status !== 429) {
                // Wrong password, or a locked account: the way out is a reset.
                addMessageButton("Reset your password", () => {
                    rememberEmail(email);
                    location.href = "reset.html";
                });
            }

            form.password.value = "";
            form.password.focus();
        } catch {
            showMessage("Can't reach GPU Nexus right now. Check your connection.");
        } finally {
            setBusy(form, false);
        }
    });
}


// ---------- sign up ----------

function setupSignUp() {
    const form = $("authForm");
    const original = rememberHeading();

    const startOver = () => {
        hideMessage();
        setHeading(original.title, original.lead);
        form.hidden = false;
        form.email.focus();
    };

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideMessage();

        const email = checkEmail(form.email);
        if (!email) return;

        const password = checkPasswords(form);
        if (!password) return;

        setBusy(form, true, "Creating your account…");

        try {
            const { response, data } = await authPost("/auth/register", { email, password });

            if (response.status === 201) {
                form.hidden = true;
                form.password.value = "";
                form.confirm.value = "";

                setHeading("Check your inbox", [
                    "We sent a confirmation link to ",
                    { strong: email },
                    ". Open it to finish creating your account."
                ]);

                showMessage("Didn't get it? Check your spam folder first.", "info");
                addMessageButton("Resend link", () => resendVerification(email));
                addMessageButton("Use a different email", startOver);
                return;
            }

            showMessage(errorText(data, "Couldn't create the account. Try again."));
        } catch {
            showMessage("Can't reach GPU Nexus right now. Check your connection.");
        } finally {
            setBusy(form, false);
        }
    });
}


// ---------- confirm email ----------

async function setupVerify() {
    const token = takeLinkToken();

    if (!token) {
        setCardState("missing");
        setHeading(
            "Open the link from your email",
            "This page confirms your address, but it needs the link we emailed you. Check your inbox, and your spam folder too."
        );
        return;
    }

    setCardState("loading");
    setHeading("Confirming your email", "Checking your link…");

    try {
        const { response, data } = await authPost("/auth/verify", { token });

        if (response.ok) {
            setCardState("ok");
            setHeading("Email confirmed", "You're all set. Sign in to start using GPU Nexus.");
        } else {
            setCardState("error");
            setHeading("This link didn't work", "It may have expired or already been used.");
            showMessage(`${errorText(data, "This link is invalid or has expired.")} Sign in and we'll offer to send a new link.`);
        }
    } catch {
        setCardState("error");
        setHeading("Couldn't reach GPU Nexus", "Check your connection, then reload this page to try again.");
    }
}


// ---------- reset password ----------

// Set while a reset link is open, so a refresh (which loses the link, since
// it was stripped from the address bar) can explain itself. Only a flag is
// stored, never the token.
const RESET_FLAG = "nx-reset-link-open";

function setResetFlag(on) {
    try {
        if (on) sessionStorage.setItem(RESET_FLAG, "1");
        else sessionStorage.removeItem(RESET_FLAG);
    } catch { /* storage off */ }
}

function hadResetFlag() {
    try { return sessionStorage.getItem(RESET_FLAG) === "1"; } catch { return false; }
}

function setupReset() {
    const token = takeLinkToken();
    const forgotForm = $("forgotForm");
    const resetForm = $("resetForm");
    const original = rememberHeading();

    prefillEmail(forgotForm.email);

    const showForgot = () => {
        resetForm.hidden = true;
        forgotForm.hidden = false;
    };

    if (token) {
        setResetFlag(true);
        forgotForm.hidden = true;
        resetForm.hidden = false;
        setHeading("Choose a new password", "Pick a password you don't use anywhere else.");
    } else if (hadResetFlag()) {
        setResetFlag(false);
        setHeading("Request a new link", "For your security, a reset link only works once, and refreshing the page used it up. Enter your email and we'll send a fresh one.");
    }

    const startOver = () => {
        hideMessage();
        setCardState("");
        setHeading(original.title, original.lead);
        forgotForm.hidden = false;
        forgotForm.email.focus();
    };

    forgotForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideMessage();

        const email = checkEmail(forgotForm.email);
        if (!email) return;

        setBusy(forgotForm, true, "Sending link…");

        try {
            const { response, data } = await authPost("/auth/forgot-password", { email });

            if (response.ok) {
                rememberEmail(email);
                forgotForm.hidden = true;
                setCardState("sent");
                setHeading("Check your inbox", [
                    "If an account exists for ",
                    { strong: email },
                    ", a reset link is on its way. It expires in 30 minutes."
                ]);
                showMessage("Didn't get it? Check your spam folder first.", "info");
                addMessageButton("Use a different email", startOver);
            } else {
                showMessage(errorText(data, "Couldn't send the link. Try again later."));
            }
        } catch {
            showMessage("Can't reach GPU Nexus right now. Check your connection.");
        } finally {
            setBusy(forgotForm, false);
        }
    });

    resetForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideMessage();

        const password = checkPasswords(resetForm);
        if (!password) return;

        setBusy(resetForm, true, "Saving password…");

        try {
            const { response, data } = await authPost("/auth/reset-password", { token, password });

            if (response.ok) {
                setResetFlag(false);
                location.replace("signin.html?reset=1");
                return;
            }

            setResetFlag(false);
            showForgot();
            setHeading("Request a new link", "That reset link has expired or was already used. Enter your email and we'll send a fresh one.");
            showMessage(errorText(data, "This link is invalid or has expired."));
            forgotForm.email.focus();
        } catch {
            showMessage("Can't reach GPU Nexus right now. Check your connection.");
        } finally {
            setBusy(resetForm, false);
        }
    });
}


// ---------- start ----------

const AUTH_PAGES = {
    signin: setupSignIn,
    signup: setupSignUp,
    verify: setupVerify,
    reset: setupReset
};

document.addEventListener("DOMContentLoaded", () => {
    AUTH_PAGES[document.body.dataset.page]?.();
});
