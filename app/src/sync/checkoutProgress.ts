import {escapeHtml} from "../util/escape";
import {fetchSyncPost} from "../util/fetch";

type CheckoutState = {taskID: string; current: number; total: number; message: string; compact: boolean; canceling: boolean};
let state: CheckoutState | undefined;
let previousFocus: HTMLElement | undefined;

const blockEditing = (event: Event) => {
    const root = document.getElementById("sync-checkout-progress");
    if (!root) {
        return;
    }
    if (event.type === "keydown" && (event as KeyboardEvent).key === "Tab") {
        const controls = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).filter(button => !button.disabled);
        const index = controls.indexOf(document.activeElement as HTMLButtonElement);
        const backwards = (event as KeyboardEvent).shiftKey;
        const next = index < 0 ? (backwards ? controls.length - 1 : 0) :
            backwards ? (index - 1 + controls.length) % controls.length : (index + 1) % controls.length;
        controls[next]?.focus();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
    }
    if (root.contains(event.target as Node)) {
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
};

const setEditingGuard = (enabled: boolean) => {
    ["keydown", "beforeinput", "paste", "drop"].forEach(name => {
        if (enabled) {
            document.addEventListener(name, blockEditing, true);
        } else {
            document.removeEventListener(name, blockEditing, true);
        }
    });
};

const render = () => {
    if (!state) {
        return;
    }
    let root = document.getElementById("sync-checkout-progress");
    if (!root) {
        previousFocus = document.activeElement as HTMLElement;
        root = document.createElement("div");
        root.id = "sync-checkout-progress";
        root.className = "sync-checkout";
        root.style.zIndex = String(++window.siyuan.zIndex);
        document.body.appendChild(root);
        setEditingGuard(true);
        root.innerHTML = `<div class="b3-dialog__scrim sync-checkout__scrim"></div>
<div class="sync-checkout__panel b3-dialog__loading" role="dialog" aria-modal="true" aria-label="${escapeHtml(window.siyuan.languages.sync)}" tabindex="-1">
    <div class="sync-checkout__details">
        <div data-type="message" class="ft__breakword" role="status"></div>
        <progress class="sync-checkout__progress" max="100" value="0"></progress>
    </div>
    <div class="sync-checkout__notice ft__secondary">${escapeHtml(window.siyuan.languages._kernel[436])}</div>
    <div class="fn__flex">
        <button class="b3-button b3-button--outline" data-action="toggle"><svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg><span></span></button>
        <span class="fn__flex-1"></span><span class="fn__space"></span>
        <button class="b3-button b3-button--cancel" data-action="cancel">${escapeHtml(window.siyuan.languages.cancel)}</button>
    </div>
</div>`;
        root.querySelector('[data-action="toggle"]').addEventListener("click", () => {
            state.compact = !state.compact;
            render();
        });
        root.querySelector('[data-action="cancel"]').addEventListener("click", () => {
            if (state.canceling) {
                return;
            }
            const taskID = state.taskID;
            state.canceling = true;
            render();
            void fetchSyncPost("/api/sync/cancelSyncCheckout", {taskID}).then(response => {
                if (response.code !== 0 && state?.taskID === taskID) {
                    state.canceling = false;
                    render();
                } else if (response.code === 0 && !response.data.requested && state?.taskID === taskID) {
                    syncCheckoutProgress({code: 2, msg: "", data: {taskID}});
                }
            }).catch(() => {
                if (state?.taskID === taskID) {
                    state.canceling = false;
                    render();
                }
            });
        });
        root.querySelector<HTMLElement>(".sync-checkout__panel").focus();
    }
    root.classList.toggle("sync-checkout--compact", state.compact);
    root.querySelector(".sync-checkout__details").classList.toggle("fn__none", state.compact);
    root.querySelector('[data-type="message"]').textContent = state.message;
    const progress = root.querySelector<HTMLProgressElement>("progress");
    progress.value = state.total > 0 ? Math.max(0, Math.min(100, state.current / state.total * 100)) : 0;
    root.querySelector('[data-action="toggle"] span').textContent = state.compact ? window.siyuan.languages.sync : window.siyuan.languages.collapse;
    root.querySelector<HTMLButtonElement>('[data-action="cancel"]').disabled = state.canceling;
};

export const syncCheckoutProgress = (data: IWebSocketData) => {
    const taskID = data.data?.taskID;
    if (typeof taskID !== "string" || !taskID) {
        return;
    }
    if (data.code === 2) {
        if (state?.taskID === taskID) {
            state = undefined;
            document.getElementById("sync-checkout-progress")?.remove();
            setEditingGuard(false);
            if (previousFocus?.isConnected) previousFocus.focus();
            previousFocus = undefined;
        }
        return;
    }
    if (!state || state.taskID !== taskID) {
        state = {taskID, current: 0, total: 1, message: "", compact: false, canceling: false};
    }
    state.current = Number(data.data.current) || 0;
    state.total = Number(data.data.total) || 0;
    state.message = data.msg || "";
    render();
};
