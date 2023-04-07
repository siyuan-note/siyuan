import {openModel} from "../menu/model";
import {fetchPost} from "../../util/fetch";
import {reloadProtyle} from "../../protyle/util/reload";
import {setInlineStyle} from "../../util/assets";

const reloadEditor = (data: IEditor) => {
    window.siyuan.config.editor = data;
    reloadProtyle(window.siyuan.mobile.editor.protyle);
    setInlineStyle();
}

export const initEditor = () => {
    openModel({
        title: window.siyuan.languages.riffCard,
        icon: "iconRiffCard",
        html: `<div class="b3-label">
    ${window.siyuan.languages.fontSize} <span id="fontSize" class="ft__on-surface">${window.siyuan.config.editor.fontSize}px</span>
    <div class="fn__hr"></div>
    <input class="b3-slider fn__block" max="72" min="9" step="1" type="range" value="${window.siyuan.config.editor.fontSize}">
    <div class="b3-label__text">${window.siyuan.languages.fontSizeTip}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.katexMacros}
    <div class="fn__hr"></div>
    <textarea class="b3-text-field fn__block" id="katexMacros">${window.siyuan.config.editor.katexMacros}</textarea>
    <div class="b3-label__text">${window.siyuan.languages.katexMacrosTip}</div>
</div>`,
        bindEvent(modelMainElement: HTMLElement) {
            modelMainElement.querySelector(".b3-slider").addEventListener("input", (event: InputEvent & {
                target: HTMLInputElement
            }) => {
                modelMainElement.querySelector("#fontSize").textContent = event.target.value + "px";
                window.siyuan.config.editor.fontSize = parseInt(event.target.value);
                fetchPost("/api/setting/setEditor", window.siyuan.config.editor, (response) => {
                    reloadEditor(response.data)
                });
            });
            const katexMacrosElement = modelMainElement.querySelector("#katexMacros") as HTMLTextAreaElement;
            katexMacrosElement.addEventListener("blur", () => {
                window.siyuan.config.editor.katexMacros = katexMacrosElement.value;
                fetchPost("/api/setting/setEditor", window.siyuan.config.editor, (response) => {
                    reloadEditor(response.data)
                });
            })
        }
    });
};
