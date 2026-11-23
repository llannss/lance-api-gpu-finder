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

function showMessage(text, type = "error") {
    const box = $("authMessage");
    if (!box) return;

    box.replaceChildren(document.createTextNode(text));
    box.className = `auth-message is-${type}`;
    box.hidden = false;
}

function addMessageButton(label, onClick) {
    const box = $("authMessage");
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);

    box.append(" ", button);
}

function hideMessage() {
    const box = $("authMessage");
    if (box) box.hidden = true;
}

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

function checkPasswords(form) {
    const password = form.password.value;

    if (password.length < 8) {
        showMessage("Passwords must be at least 8 characters.");
        return null;
    }

    if (password !== form.confirm.value) {
        showMessage("The two passwords don't match.");
        return null;
    }

    return password;
}

async function resendVerification(email) {
    const { response, data } = await authPost("/auth/resend-verification", { email });

    if (response.ok) {
        showMessage("If that account still needs confirming, a new link is on its way. Check your inbox and spam folder.", "success");
    } else {
        showMessage(errorText(data, "Couldn't send a new link. Try again later."));
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

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideMessage();

        const email = form.email.value.trim();
        const password = form.password.value;

        if (!email || !password) {
            showMessage("Enter your email and password.");
            return;
        }

        setBusy(form, true, "Signing in...");

        try {
            const { response, data } = await authPost("/auth/login", { email, password });

            if (response.ok) {
                location.replace(safeNext());
                return;
            }

            showMessage(errorText(data, "Sign-in failed. Try again."));

            if (response.status === 403) {
                addMessageButton("Send a new link", () => resendVerification(email));
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

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideMessage();

        const email = form.email.value.trim();
        const password = checkPasswords(form);
        if (!password) return;

        setBusy(form, true, "Creating account...");

        try {
            const { response, data } = await authPost("/auth/register", { email, password });

            if (response.status === 201) {
                form.hidden = true;
                showMessage(`Almost done! We sent a confirmation link to ${email}. Open it to finish creating your account (check spam too).`, "success");
                addMessageButton("Resend", () => resendVerification(email));
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
    const lead = $("verifyLead");

    if (!token) {
        lead.textContent = "This page needs the link from your confirmation email.";
        return;
    }

    try {
        const { response, data } = await authPost("/auth/verify", { token });

        if (response.ok) {
            document.querySelector("h1").textContent = "Email confirmed";
            lead.textContent = "Your email is confirmed.";
            showMessage("You're all set. Sign in to start browsing GPUs.", "success");
        } else {
            lead.textContent = "We couldn't confirm your email.";
            showMessage(`${errorText(data, "This link is invalid or has expired.")} Sign in to get a new link.`);
        }
    } catch {
        lead.textContent = "We couldn't confirm your email.";
        showMessage("Can't reach GPU Nexus right now. Reload the page to try again.");
    }
}


// ---------- reset password ----------

function setupReset() {
    const token = takeLinkToken();
    const forgotForm = $("forgotForm");
    const resetForm = $("resetForm");

    if (token) {
        forgotForm.hidden = true;
        resetForm.hidden = false;
        $("resetTitle").textContent = "Choose a new password";
        $("resetLead").textContent = "Pick a password you don't use anywhere else.";
    }

    forgotForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideMessage();

        const email = forgotForm.email.value.trim();
        if (!email) {
            showMessage("Enter your email address.");
            return;
        }

        setBusy(forgotForm, true, "Sending...");

        try {
            const { response, data } = await authPost("/auth/forgot-password", { email });

            if (response.ok) {
                forgotForm.hidden = true;
                showMessage(`${data.detail} The link expires in 30 minutes; check spam too.`, "success");
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

        setBusy(resetForm, true, "Saving...");

        try {
            const { response, data } = await authPost("/auth/reset-password", { token, password });

            if (response.ok) {
                location.replace("signin.html?reset=1");
                return;
            }

            showMessage(`${errorText(data, "This link is invalid or has expired.")} Ask for a new one below.`);
            resetForm.hidden = true;
            forgotForm.hidden = false;
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
