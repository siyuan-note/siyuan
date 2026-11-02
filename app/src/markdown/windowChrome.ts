import type {MarkdownBridge, MarkdownWindowState} from "./bridge";

export const createMarkdownWindowChrome = (options: {
    root: HTMLElement; header: HTMLElement; platform: string; bridge: MarkdownBridge["window"];
    text(key: string): string; onError(): void;
}) => {
    if (!options.bridge) return;
    const {root, header, bridge, platform, text} = options;
    const events = new AbortController();
    let disposed = false;
    let maximized = false;
    const controls = platform === "win32" ? "overlay" : platform === "darwin" ? "mac" : "custom";
    root.dataset.windowControls = controls;
    const placeholder = document.createElement("div");
    placeholder.className = "markdown-caption-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    if (controls === "mac") header.prepend(placeholder); else header.append(placeholder);
    const buttons = document.createElement("div");
    buttons.className = "markdown-caption";
    let maximize: HTMLButtonElement;
    if (controls === "custom") {
        for (const [action, icon, label] of [["minimize", "iconMin", "min"], ["maximize", "iconMax", "max"], ["close", "iconClose", "close"]] as const) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "block__icon block__icon--show markdown-caption__button";
            button.dataset.action = action;
            button.setAttribute("aria-label", text(label)); button.title = text(label);
            button.innerHTML = `<svg aria-hidden="true"><use href="#${icon}"></use></svg>`;
            button.addEventListener("click", () => {void bridge.control(action).catch(options.onError);}, {signal: events.signal});
            buttons.append(button);
            if (action === "maximize") maximize = button;
        }
        root.append(buttons);
    }
    const refresh = () => {
        if (disposed) return;
        const height = Math.round(header.getBoundingClientRect().height);
        root.style.setProperty("--markdown-caption-height", `${height}px`);
        if (controls === "overlay" && height > 0) {
            void bridge.overlay({height, symbolColor: getComputedStyle(header).color}).catch(options.onError);
        }
    };
    const update = (state: MarkdownWindowState) => {
        if (disposed || !state) return;
        maximized = state.maximized;
        root.dataset.fullscreen = String(state.fullscreen);
        if (maximize) {
            const label = text(maximized ? "restore" : "max");
            maximize.setAttribute("aria-label", label); maximize.title = label;
            maximize.querySelector("use").setAttribute("href", maximized ? "#iconRestore" : "#iconMax");
        }
    };
    const observer = new ResizeObserver(refresh);
    observer.observe(header); refresh();
    void bridge.state().then(update).catch(options.onError);
    return {refresh, update, destroy() {
        disposed = true; events.abort(); observer.disconnect(); placeholder.remove(); buttons.remove();
        delete root.dataset.windowControls; delete root.dataset.fullscreen;
    }};
};
