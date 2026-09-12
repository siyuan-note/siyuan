import {setBodyHighlight} from "../../util/assets";
import {IBodyGradient, normalizeBodyGradient} from "../../util/bodyGradient";
import {appearanceConfigApi} from "./appearanceRuntime";

const mountedConfigs = new WeakMap<HTMLElement, {
    config: IBodyGradient;
    revision: number;
    editing: boolean;
}>();

export const syncBodyGradient = (gradient = window.siyuan.config.appearance.bodyGradient) => {
    document.querySelectorAll<HTMLElement>("[data-body-gradient]").forEach(element => {
        const mountedConfig = mountedConfigs.get(element);
        // 保留尚未确认的本地编辑，避免较早的推送覆盖连续切换或拖动中的数值。
        const config = mountedConfig?.editing ? mountedConfig.config : normalizeBodyGradient(gradient);
        if (mountedConfig && !mountedConfig.editing) {
            Object.assign(mountedConfig.config, config);
        }
        if (mountedConfig?.editing) {
            setBodyHighlight(config);
        }
        element.querySelector<HTMLSelectElement>("[data-gradient-mode]").value = config.mode;
        element.querySelector("[data-gradient-colors]").classList.toggle("fn__none", config.mode !== "custom");
        element.querySelectorAll<HTMLElement>("[data-gradient-theme]").forEach(row => {
            const theme = row.dataset.gradientTheme as "light" | "dark";
            row.querySelector<HTMLInputElement>("input[type=color]").value = config[theme].color;
            row.querySelector<HTMLInputElement>("input[type=range]").value = String(config[theme].opacity);
            row.querySelector("output").textContent = `${config[theme].opacity}%`;
        });
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
            <label class="config-body-gradient__color" for="bodyGradient-${theme}-color">
                <span class="fn__flex-1">${theme === "light" ? lang.themeLight : lang.themeDark}</span>
                <input id="bodyGradient-${theme}-color" class="b3-text-field" type="color" value="${config[theme].color}"${disabled}>
            </label>
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
    if (!element || window.siyuan.config.readonly) {
        return;
    }
    const config = normalizeBodyGradient(window.siyuan.config.appearance.bodyGradient);
    const state = {config, revision: 0, editing: false};
    mountedConfigs.set(element, state);
    const preview = () => {
        state.revision++;
        state.editing = true;
        setBodyHighlight(config);
    };
    const save = () => {
        const revision = state.revision;
        // 队列保存独立快照，后续编辑和推送不能修改已排队的配置。
        void appearanceConfigApi.patch("bodyGradient", normalizeBodyGradient(config), (data) => {
            if (state.revision === revision) {
                state.editing = false;
                syncBodyGradient(data.bodyGradient);
                setBodyHighlight(config);
            }
        }).finally(() => {
            // 保存失败时解除编辑保护，恢复已确认的配置，后续推送仍可正常同步。
            if (state.revision === revision && state.editing) {
                state.editing = false;
                syncBodyGradient();
                setBodyHighlight(config);
            }
        });
    };
    element.querySelector<HTMLSelectElement>("[data-gradient-mode]").addEventListener("change", (event) => {
        config.mode = (event.target as HTMLSelectElement).value as typeof config.mode;
        element.querySelector("[data-gradient-colors]").classList.toggle("fn__none", config.mode !== "custom");
        preview();
        save();
    });
    element.querySelectorAll<HTMLInputElement>("input").forEach(input => {
        input.addEventListener("input", () => {
            const row = input.closest<HTMLElement>("[data-gradient-theme]");
            const theme = row.dataset.gradientTheme as "light" | "dark";
            if (input.type === "color") {
                config[theme].color = input.value;
            } else {
                config[theme].opacity = Number(input.value);
                row.querySelector("output").textContent = `${input.value}%`;
            }
            preview();
        });
        input.addEventListener("change", save);
    });
};
