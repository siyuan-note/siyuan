import {fetchPost} from "../../util/fetch";
import {Dialog} from "../../dialog";
import * as Pickr from "@simonwep/pickr";

export const openColorPicker = () => {
    const theme = window.siyuan.config.appearance.mode === 0 ? window.siyuan.config.appearance.themeLight : window.siyuan.config.appearance.themeDark;
    fetchPost("/api/setting/getCustomCSS", {
        theme
    }, response => {
        let customHTML = '<div class="fn__hr"></div>';
        Object.keys(response.data).forEach((item) => {
            customHTML += `<div class="fn__hr"></div><div>${window.siyuan.languages[item]}</div><div class="fn__hr"></div>`;
            Object.keys(response.data[item]).forEach(subItem => {
                customHTML += `<div class="fn__flex">
    <span class="colorPicker" data-key="${item}" data-subkey="${subItem}" data-value="${response.data[item][subItem]}"></span>
    <span class="fn__space"></span>
    <span class="ft__on-surface fn__flex-center">${window.siyuan.languages[subItem]}</span>
</div><div class="fn__hr"></div>`;
            });
        });
        const dialog = new Dialog({
            width: "70vw",
            title: `${window.siyuan.languages.theme13}  <b>${theme}</b>`,
            content: `<div class="b3-dialog__content" style="height: 60vh;overflow: auto" id="appearanceCustomPanel">${customHTML}</div>
   <div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`
        });
        const pickrs: Record<string, Record<string, any>> = {};
        dialog.element.querySelectorAll(".colorPicker").forEach((item: HTMLInputElement) => {
            // @ts-ignore
            const pickr = Pickr.create({
                container: "#appearanceCustomPanel",
                el: item,
                theme: "nano",
                default: item.getAttribute("data-value"),
                comparison: false,
                components: {
                    preview: true,
                    opacity: true,
                    hue: true,
                    interaction: {
                        input: true,
                    }
                }
            });
            const key = item.getAttribute("data-key");
            if (!pickrs[key]) {
                pickrs[key] = {};
            }
            pickrs[key][item.getAttribute("data-subkey")] = pickr;
        });
        dialog.element.querySelector(".b3-button--cancel").addEventListener("click", () => {
            dialog.destroy();
        });
        dialog.element.querySelector(".b3-button--text").addEventListener("click", () => {
            const css: Record<string, Record<string, string>> = {};
            Object.keys(pickrs).forEach((item) => {
                css[item] = {};
                Object.keys(pickrs[item]).forEach(subItem => {
                    css[item][subItem] = pickrs[item][subItem].getColor().toRGBA().toString(0);
                });
            });
            fetchPost("/api/setting/setCustomCSS", {
                theme,
                css
            });
            dialog.destroy();
        });
    });
};
