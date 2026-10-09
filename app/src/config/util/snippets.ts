import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {Dialog} from "../../dialog";
import {showMessage} from "../../dialog/message";
import {isMobile, objEquals} from "../../util/functions";
import {confirmDialog} from "../../dialog/confirmDialog";
import {Constants} from "../../constants";
import {refreshHeadingNumberMeasurements} from "../../util/assets";
import {getExtensionScriptNonce, getHostCapabilities} from "../../util/hostCapabilities";

const snippetElements = new WeakSet<HTMLElement>();

export const renderSnippet = (timeout = 0, isActive = () => true, beforeJS?: () => Promise<void>, includeJS = true) => {
    if (!isActive() || !getHostCapabilities().customAppearance) {
        return Promise.resolve();
    }
    const abortController = timeout > 0 ? new AbortController() : undefined;
    const timeoutId = abortController ? window.setTimeout(() => {
        abortController.abort();
    }, timeout) : 0;
    let scriptsReady = Promise.resolve();
    return fetchPost("/api/snippet/getSnippet", {type: "all", enabled: 2}, (response) => {
        if (!isActive() || !getHostCapabilities().customAppearance) return;
        let cssChanged = false;
        const scripts: ISnippet[] = [];
        const appendScript = (item: ISnippet) => {
            if (!isActive() || !getHostCapabilities().customAppearance || !window.siyuan.config.snippet.enabledJS) return;
            const script = document.createElement("script");
            script.type = "text/javascript";
            const nonce = getExtensionScriptNonce();
            if (nonce) script.nonce = nonce;
            script.text = item.content;
            script.id = `snippetJS${item.id}`;
            snippetElements.add(script);
            document.head.appendChild(script);
        };
        const snippetIds = new Set(response.data.snippets.map((item: ISnippet) =>
            `snippet${item.type === "css" ? "CSS" : "JS"}${item.id}`));
        document.querySelectorAll<HTMLStyleElement | HTMLScriptElement>('style[id^="snippetCSS"], script[id^="snippetJS"]').forEach(element => {
            if (snippetElements.has(element) && !snippetIds.has(element.id)) {
                cssChanged ||= element.tagName === "STYLE";
                element.remove();
            }
        });
        response.data.snippets.forEach((item: ISnippet) => {
            if (!isActive()) return;
            if (item.type === "js" && !includeJS) return;
            const id = `snippet${item.type === "css" ? "CSS" : "JS"}${item.id}`;
            const exitElement = document.getElementById(id) as HTMLScriptElement | HTMLStyleElement;
            if ((!window.siyuan.config.snippet.enabledCSS && item.type === "css") ||
                (!window.siyuan.config.snippet.enabledJS && item.type === "js")) {
                if (exitElement) {
                    exitElement.remove();
                    cssChanged = cssChanged || item.type === "css";
                }
                return;
            }
            if (!item.enabled) {
                if (exitElement) {
                    exitElement.remove();
                    cssChanged = cssChanged || item.type === "css";
                }
                return;
            }
            if (exitElement) {
                if (exitElement.textContent === item.content) {
                    return;
                }
                exitElement.remove();
                cssChanged = cssChanged || item.type === "css";
            }
            if (item.type === "css") {
                const styleEl = document.createElement("style");
                styleEl.id = id;
                styleEl.textContent = item.content;
                snippetElements.add(styleEl);
                document.head.appendChild(styleEl);
                cssChanged = true;
            } else if (item.type === "js") {
                if (beforeJS) scripts.push(item);
                else appendScript(item);
            }
        });
        if (cssChanged) {
            refreshHeadingNumberMeasurements();
        }
        if (scripts.length) {
            // CSS 先独立生效，脚本依赖失败不阻塞样式更新或禁用。
            scriptsReady = Promise.resolve().then(async () => {
                if (!isActive() || !getHostCapabilities().customAppearance || !window.siyuan.config.snippet.enabledJS) return;
                await beforeJS();
                scripts.forEach(appendScript);
            }).catch(error => console.error("Could not initialize snippet scripts", error));
        }
    }, undefined, undefined, abortController?.signal).then(() => scriptsReady).finally(() => {
        window.clearTimeout(timeoutId);
    });
};

export const openSnippets = () => {
    fetchPost("/api/snippet/getSnippet", {type: "all", enabled: 2}, response => {
        openSnippetDialog(response.data.snippets, response.data.revision);
    });
};

const openSnippetDialog = (oldSnippets: ISnippet[], revision: string, draft = oldSnippets,
                           settings = {...window.siyuan.config.snippet}, initialSettings = settings) => {
    let cssHTML = "";
    let jsHTML = "";
    draft.forEach((item: ISnippet) => {
        if (item.type === "css") {
            cssHTML += genSnippet(item);
        } else {
            jsHTML += genSnippet(item);
        }
    });
    const dialog = new Dialog({
        width: isMobile() ? "100vw" : "50vw",
        height: isMobile() ? "100vh" : "80vh",
        content: `<div class="layout-tab-bar fn__flex fn__flex-shrink" style="${isMobile() ? "padding-right: 38px;" : ""}border-radius: var(--b3-border-radius-b) var(--b3-border-radius-b) 0 0">
    <div data-type="css" class="item item--full item--focus"><span class="fn__flex-1"></span><span class="item__text">CSS</span><span class="fn__flex-1"></span></div>
    <div data-type="js" class="item item--full"><span class="fn__flex-1"></span><span class="item__text">JS</span><span class="fn__flex-1"></span></div>
</div>
<div class="fn__flex-1" style="overflow:auto;padding: 16px 24px">
    <div>
        <div class="fn__flex">
            <input spellcheck="false" data-type="css" data-action="search" type="text" placeholder="${window.siyuan.languages.searchPlaceholder}" class="b3-text-field fn__block">
            <div class="fn__space"></div>
            <span aria-label="${window.siyuan.languages.addAttr} CSS" id="addCodeSnippetCSS" class="b3-tooltips b3-tooltips__sw block__icon block__icon--show">
                <svg><use xlink:href="#iconAdd"></use></svg>
            </span>
            <div class="fn__space"></div>
            <input data-action="toggleCSS" class="b3-switch fn__flex-center" type="checkbox"${settings.enabledCSS ? " checked" : ""}>
        </div>
        ${cssHTML}
    </div>
    <div class="fn__none">
        <div class="fn__flex">
            <input spellcheck="false" data-type="js" data-action="search" type="text" placeholder="${window.siyuan.languages.searchPlaceholder}" class="b3-text-field fn__block">
            <div class="fn__space"></div>
            <span aria-label="${window.siyuan.languages.addAttr} JS" id="addCodeSnippetJS" class="b3-tooltips b3-tooltips__sw block__icon block__icon--show">
                <svg><use xlink:href="#iconAdd"></use></svg>
            </span>
            <div class="fn__space"></div>
            <input data-action="toggleJS" class="b3-switch fn__flex-center" type="checkbox"${settings.enabledJS ? " checked" : ""}>
        </div>
        ${jsHTML}
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        destroyCallback: (options) => {
            if (options?.cancel === "true") {
                return;
            }
            setSnippet(dialog, oldSnippets, removeIds, revision, initialSettings, true);
        }
    });
    const positions: Record<string, number> = {css: 0, js: 0};
    draft.forEach((item: ISnippet) => {
        const row = dialog.element.querySelectorAll(`[data-id][data-type="${item.type}"]`)[positions[item.type]++];
        const nameElement = (row.querySelector("input.b3-text-field") as HTMLInputElement);
        nameElement.value = item.name;
        const contentElement = row.querySelector("textarea") as HTMLTextAreaElement;
        contentElement.textContent = item.content;
    });
    const removeIds = oldSnippets.filter(item => !draft.some(entry => entry.id === item.id))
        .map(item => `#snippet${item.type === "css" ? "CSS" : "JS"}${item.id}`);
    dialog.element.setAttribute("data-key", Constants.DIALOG_SNIPPETS);
    dialog.element.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && target !== dialog.element) {
            if (target.id === "addCodeSnippetCSS" || target.id === "addCodeSnippetJS") {
                target.parentElement.insertAdjacentHTML("afterend", genSnippet({
                    type: target.id === "addCodeSnippetCSS" ? "css" : "js",
                    name: "",
                    content: "",
                    enabled: true,
                    disabledInPublish: false,
                }));
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("b3-button--cancel")) {
                dialog.destroy({cancel: "true"});
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("b3-button--text")) {
                setSnippet(dialog, oldSnippets, removeIds, revision, initialSettings);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("item")) {
                if (target.getAttribute("data-type") === "css") {
                    target.classList.add("item--focus");
                    target.nextElementSibling.classList.remove("item--focus");
                    target.parentElement.nextElementSibling.firstElementChild.classList.remove("fn__none");
                    target.parentElement.nextElementSibling.lastElementChild.classList.add("fn__none");
                } else {
                    target.classList.add("item--focus");
                    target.previousElementSibling.classList.remove("item--focus");
                    target.parentElement.nextElementSibling.firstElementChild.classList.add("fn__none");
                    target.parentElement.nextElementSibling.lastElementChild.classList.remove("fn__none");
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.dataset.action === "remove") {
                const itemElement = target.parentElement.parentElement;
                removeIds.push("#snippet" + (itemElement.getAttribute("data-type") === "css" ? "CSS" : "JS") + itemElement.getAttribute("data-id"));
                itemElement.remove();
                event.stopPropagation();
                event.preventDefault();
                break;
            }
            target = target.parentElement;
        }
    });
    dialog.element.querySelectorAll('[data-action="search"]').forEach((inputItem: HTMLInputElement) => {
        inputItem.addEventListener("input", (event: KeyboardEvent) => {
            if (event.isComposing) {
                return;
            }
            filterSnippet(dialog, inputItem);
        });
        inputItem.addEventListener("compositionend", () => {
            filterSnippet(dialog, inputItem);
        });
    });
};

const filterSnippet = (dialog: Dialog, inputItem: HTMLInputElement) => {
    dialog.element.querySelectorAll(`.fn__flex-1 > div > [data-type="${inputItem.dataset.type}"]`).forEach((snippetPanel: Element) => {
        const snippetName = (snippetPanel.querySelector("input.b3-text-field") as HTMLInputElement).value.toLowerCase();
        const snippetContent = snippetPanel.querySelector("textarea").value.toLowerCase();
        const searchValue = inputItem.value.toLowerCase();
        if (!searchValue ||
            (snippetName && (searchValue.includes(snippetName) || snippetName.includes(searchValue))) ||
            (snippetContent && (snippetContent.includes(searchValue) || searchValue.includes(snippetContent)))) {
            snippetPanel.classList.remove("fn__none");
        } else {
            snippetPanel.classList.add("fn__none");
        }
    });
};

const genSnippet = (options: ISnippet) => {
    return `<div data-id="${options.id || ""}" data-type="${options.type}">
    <div class="fn__hr--b"></div>
    <label class="fn__flex${window.siyuan.config.publish.enable ? "" : " fn__none"}">
        <input data-type="disabledInPublish" type="checkbox" class="b3-switch fn__flex-center" ${options.disabledInPublish ? "" : " checked"}>
        <div class="fn__space"></div>
        <span class="fn__flex-center">${window.siyuan.languages.publishService}</span>
    </label>
    <div class="fn__hr"></div>
    <div class="fn__flex">
        <input type="text" class="fn__flex-1 b3-text-field" placeholder="${window.siyuan.languages.title}">
        <div class="fn__space"></div>
        <span aria-label="${window.siyuan.languages.remove}" data-action="remove" class="b3-tooltips b3-tooltips__sw block__icon block__icon--show">
            <svg><use xlink:href="#iconTrashcan"></use></svg>
        </span>
        <div class="fn__space"></div>
        <input data-type="snippet" class="b3-switch fn__flex-center" type="checkbox"${options.enabled ? " checked" : ""}>
    </div>
    <div class="fn__hr"></div>
    <textarea class="fn__block b3-text-field" placeholder="${window.siyuan.languages.codeSnippet}" style="resize: vertical;font-family:var(--b3-font-family-code)" spellcheck="false"></textarea>
    <div class="fn__hr--b"></div>
</div>`;
};

const savingSnippets = new WeakSet<Dialog>();
const completedSnippetSaves = new WeakSet<Dialog>();

const snippetSettings = (dialog: Dialog) => ({
    enabledCSS: (dialog.element.querySelector('.b3-switch[data-action="toggleCSS"]') as HTMLInputElement).checked,
    enabledJS: (dialog.element.querySelector('.b3-switch[data-action="toggleJS"]') as HTMLInputElement).checked,
});

const setSnippetPost = async (dialog: Dialog, snippets: ISnippet[], removeIds: string[], revision: string,
                              oldSnippets: ISnippet[], initialSettings: ReturnType<typeof snippetSettings>) => {
    if (savingSnippets.has(dialog)) return;
    savingSnippets.add(dialog);
    const settings = snippetSettings(dialog);
    const restoreDraft = () => {
        if (!dialog.element.isConnected) {
            openSnippetDialog(oldSnippets, revision, readSnippetDraft(dialog), snippetSettings(dialog), initialSettings);
        }
    };
    try {
        // 缺少版本号时不退回无条件覆盖，保留草稿以便重新加载兼容的内核。
        if (!revision) {
            restoreDraft();
            showMessage(window.siyuan.languages.snippetConflict, 0, "error");
            return;
        }
        const response = await fetchSyncPost("/api/snippet/setSnippet", {
            snippets: snippets.map(item => ({...item, id: item.id || ""})), revision,
        }, undefined, false);
        if (response.code !== 0) {
            restoreDraft();
            showMessage(response.msg === "snippet revision conflict" ? window.siyuan.languages.snippetConflict : response.msg, 0, "error");
            return;
        }
        let cssChanged = false;
        removeIds.forEach(item => {
            const rmElement = document.querySelector(item);
            if (rmElement) {
                rmElement.remove();
                cssChanged = cssChanged || item.startsWith("#snippetCSS");
            }
        });
        if (cssChanged) {
            refreshHeadingNumberMeasurements();
        }
        window.siyuan.config.snippet.enabledCSS = settings.enabledCSS;
        window.siyuan.config.snippet.enabledJS = settings.enabledJS;
        fetchPost("/api/setting/setSnippet", window.siyuan.config.snippet);
        completedSnippetSaves.add(dialog);
        dialog.destroy({cancel: "true"});
    } catch (error) {
        restoreDraft();
        showMessage(String(error), 0, "error");
    } finally {
        savingSnippets.delete(dialog);
    }
};

const readSnippetDraft = (dialog: Dialog): ISnippet[] => {
    const snippets: ISnippet[] = [];
    dialog.element.querySelectorAll("[data-id]").forEach((item) => {
        snippets.push({
            disabledInPublish: !(item.querySelector('.b3-switch[data-type="disabledInPublish"]') as HTMLInputElement).checked,
            id: item.getAttribute("data-id"),
            name: (item.querySelector("input.b3-text-field") as HTMLInputElement).value,
            type: item.getAttribute("data-type"),
            content: item.querySelector("textarea").value,
            enabled: (item.querySelector('.b3-switch[data-type="snippet"]') as HTMLInputElement).checked
        });
    });
    return snippets;
};

const setSnippet = (dialog: Dialog, oldSnippets: ISnippet[], removeIds: string[], revision: string,
                    initialSettings: ReturnType<typeof snippetSettings>, confirm = false) => {
    if (savingSnippets.has(dialog) || completedSnippetSaves.has(dialog)) return;
    const snippets = readSnippetDraft(dialog);
    if (objEquals(oldSnippets, snippets) &&
        initialSettings.enabledCSS === (dialog.element.querySelector('.b3-switch[data-action="toggleCSS"]') as HTMLInputElement).checked &&
        initialSettings.enabledJS === (dialog.element.querySelector('.b3-switch[data-action="toggleJS"]') as HTMLInputElement).checked) {
        dialog.destroy({cancel: "true"});
    } else {
        if (confirm) {
            confirmDialog(window.siyuan.languages.save, window.siyuan.languages.snippetsTip, () => {
                void setSnippetPost(dialog, snippets, removeIds, revision, oldSnippets, initialSettings);
            });
        } else {
            void setSnippetPost(dialog, snippets, removeIds, revision, oldSnippets, initialSettings);
        }
    }
};
