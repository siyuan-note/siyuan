import {fetchPost} from "../../util/fetch";
import {Dialog} from "../../dialog";
import {objEquals} from "../../util/functions";
import {confirmDialog} from "../../dialog/confirmDialog";
import {Constants} from "../../constants";

export const renderSnippet = () => {
    fetchPost("/api/snippet/getSnippet", {type: "all", enabled: 2}, (response) => {
        response.data.snippets.forEach((item: ISnippet) => {
            const id = `snippet${item.type === "css" ? "CSS" : "JS"}${item.id}`;
            let exitElement = document.getElementById(id) as HTMLScriptElement;
            if ((!window.siyuan.config.snippet.enabledCSS && item.type === "css") ||
                (!window.siyuan.config.snippet.enabledJS && item.type === "js")) {
                if (exitElement) {
                    exitElement.remove();
                }
                return;
            }
            if (!item.enabled) {
                if (exitElement) {
                    exitElement.remove();
                }
                return;
            }
            if (exitElement) {
                if (exitElement.innerHTML === item.content) {
                    return;
                }
                exitElement.remove();
            }
            if (item.type === "css") {
                document.head.insertAdjacentHTML("beforeend", `<style id="${id}">${item.content}</style>`);
            } else if (item.type === "js") {
                exitElement = document.createElement("script");
                exitElement.type = "text/javascript";
                exitElement.text = item.content;
                exitElement.id = id;
                document.head.appendChild(exitElement);
            }
        });
    });
};

export const openSnippets = () => {
    fetchPost("/api/snippet/getSnippet", {type: "all", enabled: 2}, (response) => {
        let cssHTML = "";
        let jsHTML = "";
        response.data.snippets.forEach((item: ISnippet) => {
            if (item.type === "css") {
                cssHTML += genSnippet(item);
            } else {
                jsHTML += genSnippet(item);
            }
        });
        const dialog = new Dialog({
            width: "70vw",
            height: "80vh",
            content: `<div class="layout-tab-bar fn__flex fn__flex-shrink" style="border-radius: var(--b3-border-radius-b) var(--b3-border-radius-b) 0 0">
    <div data-type="css" class="item item--full item--focus"><span class="fn__flex-1"></span><span class="item__text">CSS</span><span class="fn__flex-1"></span></div>
    <div data-type="js" class="item item--full"><span class="fn__flex-1"></span><span class="item__text">JS</span><span class="fn__flex-1"></span></div>
</div>
<div class="fn__flex-1" style="overflow:auto;padding: 16px 24px">
    <div>
        <div class="fn__flex">
            <div class="fn__flex-1"></div>
            <div class="b3-form__icon">
                <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
                <input data-type="css" data-action="search" type="text" placeholder="Enter ${window.siyuan.languages.search}" class="b3-text-field b3-form__icon-input">
            </div>
            <div class="fn__space"></div>
            <span aria-label="${window.siyuan.languages.addAttr} CSS" id="addCodeSnippetCSS" class="b3-tooltips b3-tooltips__sw block__icon block__icon--show">
                <svg><use xlink:href="#iconAdd"></use></svg>
            </span>
            <div class="fn__space"></div>
            <input data-action="toggleCSS" class="b3-switch b3-switch--side fn__flex-center" type="checkbox"${window.siyuan.config.snippet.enabledCSS ? " checked" : ""}>
        </div>
        ${cssHTML}
    </div>
    <div class="fn__none">
        <div class="fn__flex">
            <div class="fn__flex-1"></div>
             <div class="b3-form__icon">
                <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
                <input data-type="js" data-action="search" type="text" placeholder="Enter ${window.siyuan.languages.search}" class="b3-text-field b3-form__icon-input">
            </div>
            <div class="fn__space"></div>
            <span aria-label="${window.siyuan.languages.addAttr} JS" id="addCodeSnippetJS" class="b3-tooltips b3-tooltips__sw block__icon block__icon--show">
                <svg><use xlink:href="#iconAdd"></use></svg>
            </span>
            <div class="fn__space"></div>
            <input data-action="toggleJS" class="b3-switch b3-switch--side fn__flex-center" type="checkbox"${window.siyuan.config.snippet.enabledJS ? " checked" : ""}>
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
                setSnippet(dialog, response.data.snippets, removeIds, true);
            }
        });
        response.data.snippets.forEach((item: ISnippet) => {
            const nameElement = (dialog.element.querySelector(`[data-id="${item.id}"] input`) as HTMLInputElement);
            nameElement.value = item.name;
            const contentElement = dialog.element.querySelector(`[data-id="${item.id}"] textarea`) as HTMLTextAreaElement;
            contentElement.textContent = item.content;
        });
        const removeIds: string[] = [];
        dialog.element.setAttribute("data-key", Constants.DIALOG_SNIPPETS);
        dialog.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isSameNode(dialog.element)) {
                if (target.id === "addCodeSnippetCSS" || target.id === "addCodeSnippetJS") {
                    target.parentElement.insertAdjacentHTML("afterend", genSnippet({
                        type: target.id === "addCodeSnippetCSS" ? "css" : "js",
                        name: "",
                        content: "",
                        enabled: false
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
                    setSnippet(dialog, response.data.snippets, removeIds);
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
            inputItem.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key === "Enter" && !event.isComposing) {
                    fetchPost("/api/snippet/getSnippet", {
                        type: "all",
                        enabled: 2,
                        keyword: inputItem.value
                    }, (searchResponse) => {
                        dialog.element.querySelectorAll(`.fn__flex-1 > div > [data-type="${inputItem.dataset.type}"]`).forEach((snipeetPanel: Element) => {
                            snipeetPanel.classList.add("fn__none");
                        });
                        searchResponse.data.snippets.forEach((snippetItem: ISnippet) => {
                            if (snippetItem.type === inputItem.dataset.type) {
                                dialog.element.querySelector(`[data-id="${snippetItem.id}"]`).classList.remove("fn__none");
                            }
                        });
                    });
                }
            });
        });
    });
};

const genSnippet = (options: ISnippet) => {
    return `<div data-id="${options.id || ""}" data-type="${options.type}">
    <div class="fn__hr--b"></div>
    <div class="fn__flex">
        <input type="text" class="fn__size200 b3-text-field" placeholder="${window.siyuan.languages.title}">
        <div class="fn__flex-1"></div>
        <div class="fn__space"></div>
        <span aria-label="${window.siyuan.languages.remove}" data-action="remove" class="b3-tooltips b3-tooltips__sw block__icon block__icon--show">
            <svg><use xlink:href="#iconTrashcan"></use></svg>
        </span>
        <div class="fn__space"></div>
        <input data-type="snippet" class="b3-switch b3-switch--side fn__flex-center" type="checkbox"${options.enabled ? " checked" : ""}>
    </div>
    <div class="fn__hr"></div>
    <textarea class="fn__block b3-text-field" placeholder="${window.siyuan.languages.codeSnippet}" style="resize: vertical;font-family:var(--b3-font-family-code)" spellcheck="false"></textarea>
    <div class="fn__hr--b"></div>
</div>`;
};

const setSnippetPost = (dialog: Dialog, snippets: ISnippet[], removeIds: string[]) => {
    fetchPost("/api/snippet/setSnippet", {snippets}, () => {
        removeIds.forEach(item => {
            const rmElement = document.querySelector(item);
            if (rmElement) {
                rmElement.remove();
            }
        });
        window.siyuan.config.snippet.enabledCSS = (dialog.element.querySelector('.b3-switch[data-action="toggleCSS"]') as HTMLInputElement).checked;
        window.siyuan.config.snippet.enabledJS = (dialog.element.querySelector('.b3-switch[data-action="toggleJS"]') as HTMLInputElement).checked;
        fetchPost("/api/setting/setSnippet", window.siyuan.config.snippet);
        renderSnippet();
        dialog.destroy({cancel: "true"});
    });
};

const setSnippet = (dialog: Dialog, oldSnippets: ISnippet[], removeIds: string[], confirm = false) => {
    const snippets: ISnippet[] = [];
    dialog.element.querySelectorAll("[data-id]").forEach((item) => {
        snippets.push({
            id: item.getAttribute("data-id"),
            name: item.querySelector("input").value,
            type: item.getAttribute("data-type"),
            content: item.querySelector("textarea").value,
            enabled: (item.querySelector(".b3-switch") as HTMLInputElement).checked
        });
    });
    if (objEquals(oldSnippets, snippets) &&
        window.siyuan.config.snippet.enabledCSS === (dialog.element.querySelector('.b3-switch[data-action="toggleCSS"]') as HTMLInputElement).checked &&
        window.siyuan.config.snippet.enabledJS === (dialog.element.querySelector('.b3-switch[data-action="toggleJS"]') as HTMLInputElement).checked) {
        dialog.destroy({cancel: "true"});
    } else {
        if (confirm) {
            confirmDialog(window.siyuan.languages.save, window.siyuan.languages.snippetsTip, () => {
                setSnippetPost(dialog, snippets, removeIds);
            });
        } else {
            setSnippetPost(dialog, snippets, removeIds);
        }
    }
};
