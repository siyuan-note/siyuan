import {fetchPost} from "../../util/fetch";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {Dialog} from "../../dialog";

export const renderSnippet = () => {
    fetchPost("/api/snippet/getSnippet", {type: "all", enabled: 2}, (response) => {
        response.data.snippets.forEach((item: ISnippet) => {
            const id = `snippet${item.type === "css" ? "CSS" : "JS"}${item.id}`;
            let exitElement = document.getElementById(id) as HTMLScriptElement;
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
        ${cssHTML}
        <div class="fn__flex">
            <div class="fn__flex-1"></div>
            <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="addCodeSnippetCSS">
                <svg><use xlink:href="#iconAdd"></use></svg> ${window.siyuan.languages.addAttr} CSS
            </button>
        </div>
    </div>
    <div class="fn__none">
        ${jsHTML}
        <div class="fn__flex">
            <div class="fn__flex-1"></div>
            <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="addCodeSnippetJS">
                <svg><use xlink:href="#iconAdd"></use></svg> ${window.siyuan.languages.addAttr} JS
            </button>
        </div>
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`
        });
        response.data.snippets.forEach((item: ISnippet) => {
            const nameElement = (dialog.element.querySelector(`[data-id="${item.id}"] input`) as HTMLInputElement);
            nameElement.value = item.name;
            const contentElement = dialog.element.querySelector(`[data-id="${item.id}"] textarea`) as HTMLTextAreaElement;
            contentElement.textContent = item.content;
        });
        const removeIds: string[] = [];
        dialog.element.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            if (target.id === "addCodeSnippetCSS" || target.id === "addCodeSnippetJS") {
                target.parentElement.insertAdjacentHTML("beforebegin", genSnippet({
                    type: target.id === "addCodeSnippetCSS" ? "css" : "js",
                    name: "",
                    content: "",
                    enabled: false
                }));
                return;
            }
            if (target.classList.contains("b3-button--cancel")) {
                dialog.destroy();
                return;
            }
            if (target.classList.contains("b3-button--text")) {
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
                fetchPost("/api/snippet/setSnippet", {snippets}, () => {
                    removeIds.forEach(item => {
                        const rmElement = document.querySelector(item);
                        if (rmElement) {
                            rmElement.remove();
                        }
                    });
                    renderSnippet();
                    dialog.destroy();
                });
                return;
            }
            const tabElement = hasClosestByClassName(target, "item");
            if (tabElement) {
                if (tabElement.getAttribute("data-type") === "css") {
                    tabElement.classList.add("item--focus");
                    tabElement.nextElementSibling.classList.remove("item--focus");
                    tabElement.parentElement.nextElementSibling.firstElementChild.classList.remove("fn__none");
                    tabElement.parentElement.nextElementSibling.lastElementChild.classList.add("fn__none");
                } else {
                    tabElement.classList.add("item--focus");
                    tabElement.previousElementSibling.classList.remove("item--focus");
                    tabElement.parentElement.nextElementSibling.firstElementChild.classList.add("fn__none");
                    tabElement.parentElement.nextElementSibling.lastElementChild.classList.remove("fn__none");
                }
                return;
            }
            const removeElement = hasClosestByClassName(target, "b3-tooltips");
            if (removeElement) {
                const itemElement = removeElement.parentElement.parentElement;
                removeIds.push("#snippet" + (itemElement.getAttribute("data-type") === "css" ? "CSS" : "JS") + itemElement.getAttribute("data-id"));
                itemElement.nextElementSibling.remove();
                itemElement.remove();
            }
        });
    });
};

const genSnippet = (options: ISnippet) => {
    return `<div data-id="${options.id || ""}" data-type="${options.type}">
    <div class="fn__flex">
        <input type="text" class="fn__size200 b3-text-field" placeholder="${window.siyuan.languages.title}">
        <div class="fn__flex-1 fn__space"></div>
        <input data-type="snippet" class="b3-switch fn__flex-center" type="checkbox"${options.enabled ? " checked" : ""}>
        <div class="fn__space"></div>
        <span aria-label="${window.siyuan.languages.remove}" class="b3-tooltips b3-tooltips__sw block__icon block__icon--show">
            <svg><use xlink:href="#iconTrashcan"></use></svg>
        </span>
    </div>
    <div class="fn__hr"></div>
    <textarea class="fn__block b3-text-field" placeholder="${window.siyuan.languages.codeSnippet}" style="resize: vertical" spellcheck="false"></textarea>
</div><div class="fn__hr--b"></div>`;
};
