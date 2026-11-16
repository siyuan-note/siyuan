import {setBodyHighlight} from "../../util/assets";
import {IBodyGradient, normalizeBodyGradient} from "../../util/bodyGradient";
import {appearanceConfigApi} from "./appearanceRuntime";
import {openInternalColorPicker} from "../../colorPicker";

type GradientPath = "mode" | "light.color" | "dark.color" | "light.opacity" | "dark.opacity";
interface GradientState {
    drafts: Map<GradientPath, string | number>;
    revisions: Map<GradientPath, number>;
    sequence: number;
    preview?: {theme: "light" | "dark"; color: string; sequence: number};
}
const mountedConfigs = new WeakMap<HTMLElement, GradientState>();

const projectGradient = (config: Parameters<typeof normalizeBodyGradient>[0], state?: GradientState) => {
    const result = normalizeBodyGradient(config);
    state?.drafts.forEach((value, path) => {
        if (path === "mode") { result.mode = value as IBodyGradient["mode"]; return; }
        const [theme, property] = path.split(".") as ["light" | "dark", "color" | "opacity"];
        if (property === "color") { result[theme].color = value as string; }
        else { result[theme].opacity = value as number; }
    });
    if (state?.preview) { result[state.preview.theme].color = state.preview.color; }
    return result;
};

export const syncBodyGradient = (gradient = window.siyuan.config.appearance.bodyGradient) => {
    document.querySelectorAll<HTMLElement>("[data-body-gradient]").forEach(element => {
        const config = projectGradient(gradient, mountedConfigs.get(element));
        element.querySelector<HTMLSelectElement>("[data-gradient-mode]").value = config.mode;
        element.querySelector("[data-gradient-colors]").classList.toggle("fn__none", config.mode !== "custom");
        element.querySelectorAll<HTMLElement>("[data-gradient-theme]").forEach(row => {
            const theme = row.dataset.gradientTheme as "light" | "dark";
            row.querySelector<HTMLButtonElement>("[data-gradient-color]").textContent = config[theme].color;
            row.querySelector<HTMLInputElement>("input[type=range]").value = String(config[theme].opacity);
            row.querySelector("output").textContent = `${config[theme].opacity}%`;
        });
        setBodyHighlight(config);
    });
};

export const genBodyGradientHtml = () => {
    const config = normalizeBodyGradient(window.siyuan.config.appearance.bodyGradient);
    const lang = window.siyuan.languages;
    const disabled = window.siyuan.config.readonly ? " disabled" : "";
    return `<div class="b3-label config-item" data-body-gradient>
    <div class="fn__flex">
        <div class="fn__flex-1 config-item__main">
            <div class="config-name">${lang.bodyGradient}</div>
            <div class="b3-label__text">${lang.bodyGradientTip}</div>
        </div>
        <span class="fn__space"></span>
        <select class="b3-select fn__flex-center fn__size200" data-gradient-mode aria-label="${lang.bodyGradient}"${disabled}>
            ${[["auto", lang.bodyGradientAuto], ["custom", lang.custom], ["off", lang.disable]].map(([value, label]) =>
        `<option value="${value}"${config.mode === value ? " selected" : ""}>${label}</option>`).join("")}
        </select>
    </div>
    <div data-gradient-colors class="${config.mode === "custom" ? "" : "fn__none"}">
        ${(["light", "dark"] as const).map(theme => `<div class="config-body-gradient" data-gradient-theme="${theme}">
            <div class="config-body-gradient__color">
                <span class="fn__flex-1">${theme === "light" ? lang.themeLight : lang.themeDark}</span>
                <button type="button" class="b3-button b3-button--outline" data-gradient-color aria-label="${lang.color}"${disabled}>${config[theme].color}</button>
            </div>
            <div class="config-body-gradient__strength">
                <label for="bodyGradient-${theme}-opacity">${lang.bodyGradientStrength}</label>
                <input id="bodyGradient-${theme}-opacity" class="b3-slider" type="range" min="0" max="100" step="1" value="${config[theme].opacity}"${disabled}>
                <output for="bodyGradient-${theme}-opacity">${config[theme].opacity}%</output>
            </div>
        </div>`).join("")}
    </div>
</div>`;
};

export const mountBodyGradient = (root: HTMLElement) => {
    const element = root.querySelector<HTMLElement>("[data-body-gradient]");
    if (!element || window.siyuan.config.readonly) { return; }
    const state: GradientState = {drafts: new Map(), revisions: new Map(), sequence: 0};
    mountedConfigs.set(element, state);
    const refresh = () => syncBodyGradient();
    const save = (path: GradientPath, value: string | number) => {
        const revision = (state.revisions.get(path) || 0) + 1;
        state.revisions.set(path, revision);
        state.drafts.set(path, value);
        refresh();
        void appearanceConfigApi.patch("bodyGradient." + path, value).catch(() => {}).finally(() => {
            if (state.revisions.get(path) === revision && state.drafts.get(path) === value) { state.drafts.delete(path); }
            refresh();
        });
    };
    element.querySelector<HTMLSelectElement>("[data-gradient-mode]").addEventListener("change", event => {
        save("mode", (event.target as HTMLSelectElement).value);
    });
    element.querySelectorAll<HTMLElement>("[data-gradient-theme]").forEach(row => {
        const theme = row.dataset.gradientTheme as "light" | "dark";
        const color = row.querySelector<HTMLButtonElement>("[data-gradient-color]");
        color.addEventListener("click", () => {
            if (window.siyuan.config.readonly) { return; }
            const sequence = ++state.sequence;
            const config = projectGradient(window.siyuan.config.appearance.bodyGradient, state);
            const picker = openInternalColorPicker({ownerElement: color, value: config[theme].color, title: window.siyuan.languages.color,
                onPreview: value => {
                    if (sequence === state.sequence && !window.siyuan.config.readonly) {
                        state.preview = {theme, color: value.hex, sequence}; refresh();
                    }
                },
                onPreviewEnd: () => {
                    if (state.preview?.sequence === sequence) { state.preview = undefined; refresh(); }
                },
            });
            void picker.result.then(result => {
                if (result.type === "confirm" && result.changed && sequence === state.sequence && element.isConnected &&
                    !window.siyuan.config.readonly) { save(`${theme}.color`, result.value.hex); }
            });
        });
        const opacity = row.querySelector<HTMLInputElement>("input[type=range]");
        opacity.addEventListener("input", () => {
            state.revisions.set(`${theme}.opacity`, (state.revisions.get(`${theme}.opacity`) || 0) + 1);
            state.drafts.set(`${theme}.opacity`, Number(opacity.value)); refresh();
        });
        opacity.addEventListener("change", () => save(`${theme}.opacity`, Number(opacity.value)));
    });
};
