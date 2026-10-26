import type {AVAutomationBlockSourceInput} from "../../../types/api";
import {openInputDialog} from "../../../dialog/inputDialog";
import {fetchSyncPost} from "../../../util/fetch";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {BlockPanel} from "../../../block/Panel";

export const parseCollectionReference = (value: string) => {
    const match = /^(?:siyuan:\/\/blocks\/)?(\d{14}-[a-z0-9]{7})(?:\?[^\s]*)?$/.exec(value.trim());
    return match?.[1];
};

export const mountCollectionReference = (host: HTMLElement, source: AVAutomationBlockSourceInput,
                                         protyle: IProtyle, save: () => void, resize: () => void) => {
    const lang = window.siyuan.languages;
    let revision = 0;
    let selectionRevision = 0;
    const render = async () => {
        const version = ++revision;
        const id = source.referenceID;
        host.className = "av__automation-control";
        host.innerHTML = `<span class="av__automation-control-label">${lang.automationCollectionReference}</span>
<div class="av__automation-row">${id ? `<button type="button" class="b3-button b3-button--cancel b3-button--wrap fn__flex-1 av__automation-source-action" data-preview-reference data-id="${escapeAttr(id)}">${escapeHtml(id)}</button><svg class="b3-menu__action b3-menu__action--show b3-menu__action--warning fn__pointer ariaLabel" data-clear-reference role="button" tabindex="0" data-position="north" aria-label="${escapeAttr(lang.delete)}"><use xlink:href="#iconClose"></use></svg>` : ""}</div>
<div class="av__automation-row"><button type="button" class="b3-button b3-button--cancel b3-button--wrap av__automation-source-action" data-reference>${lang.select}</button><button type="button" class="b3-button b3-button--cancel b3-button--wrap av__automation-source-action" data-reference-document>${lang.filterCurrentDocument}</button></div>
<div class="ft__on-surface ft__smaller av__automation-tip">${lang.automationCollectionReferenceTip}</div>`;
        resize();
        if (id) {
            const result = await fetchSyncPost("/api/block/getRefText", {id});
            if (version === revision && result.code === 0) {
                host.querySelector("[data-preview-reference]").textContent = result.data || id;
                if (host.isConnected) { resize(); }
            }
        }
    };
    const setReference = async (id: string): Promise<boolean> => {
        const version = ++selectionRevision;
        const result = await fetchSyncPost("/api/block/getBlockInfo", {id});
        if (version !== selectionRevision || !host.isConnected || result.code !== 0) { return false; }
        source.referenceID = id;
        save();
        void render();
        return true;
    };
    host.addEventListener("click", event => {
        const target = (event.target as Element).closest("button, [data-clear-reference]");
        if (!target) { return; }
        if (target.hasAttribute("data-clear-reference")) {
            selectionRevision++;
            delete source.referenceID;
            save();
            void render();
        } else if (target instanceof HTMLButtonElement && target.hasAttribute("data-preview-reference")) {
            window.siyuan.blockPanels.push(new BlockPanel({app: protyle.app, targetElement: target,
                isBacklink: false, refDefs: [{refID: source.referenceID}]}));
        } else if (target.hasAttribute("data-reference-document")) {
            void setReference(protyle.block.rootID);
        } else if (target.hasAttribute("data-reference")) {
            openInputDialog({title: lang.automationCollectionReference, value: source.referenceID || "",
                description: lang.automationCollectionReferenceTip,
                onConfirm: async (value, dialog) => {
                    const id = parseCollectionReference(value);
                    const input = dialog.element.querySelector<HTMLInputElement>("[data-dialog-input]");
                    if (!id) {
                        input.setCustomValidity(lang.invalid);
                        input.reportValidity();
                        return;
                    }
                    input.setCustomValidity("");
                    if (await setReference(id)) { dialog.destroy(); }
                }});
        }
    });
    host.addEventListener("keydown", event => {
        const target = (event.target as Element).closest("[data-clear-reference]");
        if (!target || event.isComposing || event.repeat || !["Enter", " "].includes(event.key)) { return; }
        event.preventDefault();
        event.stopPropagation();
        target.dispatchEvent(new MouseEvent("click", {bubbles: true}));
    });
    void render();
};
