// ============================================
// GPU Nexus auth pages (sign in, create account, reset, confirm email):
// interaction details only. Submitting, API calls and messages live in auth.js.
//
//   .nx-reveal[aria-controls=<input id>]   show / hide a password
//   input[data-caps=<hint id>]             Caps Lock warning
//   input[data-rule=<rule id>]             "At least 8 characters" tick
//   input[data-match=<input id>][data-match-status=<id>]   "Passwords match"
// ============================================

document.addEventListener("DOMContentLoaded", () => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(pointer: fine)");

    // ---------- show / hide password ----------
    // The eye icons crossfade in CSS off aria-pressed.

    document.querySelectorAll(".nx-reveal").forEach((button) => {
        const input = document.getElementById(button.getAttribute("aria-controls"));
        if (!input) return;

        const setShown = (shown) => {
            input.type = shown ? "text" : "password";
            button.setAttribute("aria-pressed", String(shown));
            button.setAttribute("aria-label", shown ? "Hide password" : "Show password");
        };

        button.addEventListener("click", () => {
            setShown(input.type === "password");
            input.focus({ preventScroll: true });
        });

        // Never leave a password visible after the form is sent.
        input.form?.addEventListener("submit", () => setShown(false));
    });

    // ---------- Caps Lock warning ----------

    document.querySelectorAll("input[data-caps]").forEach((input) => {
        const hint = document.getElementById(input.dataset.caps);
        if (!hint) return;

        const update = (event) => {
            if (typeof event.getModifierState === "function") {
                hint.hidden = !event.getModifierState("CapsLock");
            }
        };

        input.addEventListener("keydown", update);
        input.addEventListener("keyup", update);
        input.addEventListener("blur", () => { hint.hidden = true; });
    });

    // ---------- live password checks (create account, new password) ----------

    document.querySelectorAll("input[data-rule]").forEach((input) => {
        const rule = document.getElementById(input.dataset.rule);
        if (!rule) return;

        const min = Number(input.getAttribute("minlength")) || 8;
        const update = () => { rule.dataset.met = String(input.value.length >= min); };

        input.addEventListener("input", update);
        update();
    });

    document.querySelectorAll("input[data-match]").forEach((confirm) => {
        const original = document.getElementById(confirm.dataset.match);
        const status = document.getElementById(confirm.dataset.matchStatus);
        if (!original || !status) return;

        const label = status.querySelector("span");

        // Stay quiet while the second password is still a correct prefix of
        // the first: only speak up once it matches, or has clearly gone wrong.
        const update = () => {
            const a = original.value;
            const b = confirm.value;

            let state = "";
            if (b && a === b) state = "ok";
            else if (b && (b.length >= a.length || !a.startsWith(b))) state = "bad";

            status.hidden = state === "";
            if (!state) return;

            status.dataset.state = state;
            label.textContent = state === "ok" ? "Passwords match" : "Passwords don't match";
        };

        confirm.addEventListener("input", update);
        original.addEventListener("input", () => { if (confirm.value) update(); });
    });

    // ---------- shake the form on an error ----------
    // auth.js shows errors by un-hiding #authMessage with class "is-error".
    // A repeated error would otherwise look identical, so each one gets a short,
    // decaying shake of whichever form is on screen. WAAPI keeps it on the
    // compositor; reduced motion skips it (the message itself still fades in).

    const message = document.getElementById("authMessage");

    if (message) {
        let shake;

        const shakeVisibleForm = () => {
            if (reduceMotion.matches) return;

            const form = [...document.querySelectorAll(".nx-form")].find((f) => !f.hidden);
            if (!form) return;

            shake?.cancel();
            shake = form.animate(
                [
                    { transform: "translateX(0)" },
                    { transform: "translateX(-7px)" },
                    { transform: "translateX(6px)" },
                    { transform: "translateX(-4px)" },
                    { transform: "translateX(2px)" },
                    { transform: "translateX(0)" }
                ],
                { duration: 380, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
            );
        };

        new MutationObserver(() => {
            if (!message.hidden && message.classList.contains("is-error")) shakeVisibleForm();
        }).observe(message, { attributes: true, attributeFilter: ["hidden", "class"], childList: true });
    }

    // ---------- put the cursor in the first field (mouse and keyboard only) ----------
    // On phones this would pop the keyboard over the page, so it is skipped there.

    if (finePointer.matches) {
        const first = [...document.querySelectorAll(".nx-form")]
            .find((f) => !f.hidden)
            ?.querySelector("input");

        first?.focus({ preventScroll: true });
    }
});
