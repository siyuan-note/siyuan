import {setBodyHighlight} from "../../util/assets";
import {normalizeBodyGradient} from "../../util/bodyGradient";
import {appearanceConfigApi} from "./appearanceRuntime";

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
    element.querySelector<HTMLSelectElement>("[data-gradient-mode]").addEventListener("change", (event) => {
        config.mode = (event.target as HTMLSelectElement).value as typeof config.mode;
        element.querySelector("[data-gradient-colors]").classList.toggle("fn__none", config.mode !== "custom");
        setBodyHighlight(config);
        appearanceConfigApi.patch("bodyGradient", config);
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
            setBodyHighlight(config);
        });
        input.addEventListener("change", () => appearanceConfigApi.patch("bodyGradient", config));
    });
};
