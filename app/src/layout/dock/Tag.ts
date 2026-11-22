import {toggleMenu} from "../../menus/menuToggle";
import {Tab} from "../Tab";
import {bindPanelSearch} from "./panelSearch";
import {Model} from "../Model";
import {TagTree} from "./TagTree";
import {setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {updateHotkeyAfterTip} from "../../protyle/util/compatibility";
import {openGlobalSearch} from "../../search/util";
import type {App} from "../../index";
import {openTagMenu} from "../../menus/tag";
import {appendTagSortMenu} from "./tagSortMenu";

export class Tag extends Model {
    private tree: TagTree;
    private element: Element;

    constructor(app: App, tab: Tab) {
        super({app});
        this.connect({
            id: tab.id,
            type: "tag",
            msgCallback: this.handleMsgCallback.bind(this)
        });

        this.element = tab.panelElement;
        this.element.classList.add("fn__flex-column", "file-tree", "sy__tag", "dockPanel");

        this.element.innerHTML = `<div class="block__icons">
    <div class="block__logo fn__flex-1">${window.siyuan.languages.tag}</div>
    <input spellcheck="false" class="b3-text-field search__label fn__none fn__size200" placeholder="${window.siyuan.languages.searchPlaceholder}" />
    <span data-type="search" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.search}"><svg><use xlink:href='#iconSearch'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="refresh" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="sort" class="block__icon ariaLabel${window.siyuan.config.readonly ? " fn__none" : ""}" data-position="north" aria-label="${window.siyuan.languages.sort}">
        <svg><use xlink:href="#iconSort"></use></svg>
    </span>
    <span class="fn__space${window.siyuan.config.readonly ? " fn__none" : ""}"></span>
    <span data-type="expand" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.expand}${updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.expand.custom)}">
        <svg><use xlink:href="#iconExpand"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.collapse}${updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.collapse.custom)}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.min}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="fn__flex-1" style="margin-bottom: 8px"></div>`;
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        const showSearch = bindPanelSearch(inputElement,
            this.element.querySelector('[data-type="search"]') as HTMLElement, () => this.tree.filter());

        const refresh = this.element.querySelector('[data-type="refresh"] svg');
        this.tree = new TagTree({
            element: this.element.lastElementChild as HTMLElement,
            input: inputElement,
            open: label => openGlobalSearch(app, `#${label}#`, false, {
                method: 0,
                tagPanel: !window.siyuan.ctrlIsPressed,
            }),
            menu: openTagMenu,
            setLoading: loading => refresh.classList.toggle("fn__rotate", loading),
        });
        // 为了快捷键的 dispatch
        this.element.querySelector('[data-type="collapse"]').addEventListener("click", () => {
            this.tree.collapseAll();
        });
        this.element.querySelector('[data-type="expand"]').addEventListener("click", () => {
            this.tree.expandAll();
        });
        this.element.addEventListener("click", (event: MouseEvent) => {
            if ((event.target as HTMLElement).tagName === "INPUT") {
                return;
            }
            setPanelFocus(this.element);
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("block__icon")) {
                    const type = target.getAttribute("data-type");
                    switch (type) {
                        case "min":
                            getDockByType("tag").toggleModel("tag", false, true);
                            break;
                        case "sort": {
                            toggleMenu({
                                target: target,
                                build: (_menu, session) => {
                                    appendTagSortMenu(() => this.update());
                                    const rect = target.getBoundingClientRect();
                                    session.show(() => window.siyuan.menus.menu.popup({x: rect.left, y: rect.bottom, h: rect.height}));

                                },
                            });
                        event.preventDefault();
                            event.stopPropagation();
                            break;
                        }
                        case "refresh":
                            this.update();
                            break;
                        case "search":
                            showSearch();
                            break;
                    }
                }
                target = target.parentElement;
            }
        });
        this.update();
    }

    private handleMsgCallback(data: IWebSocketData) {
        if (data) {
            switch (data.cmd) {
                case "closeBox":
                case "removeBox":
                case "removeDoc":
                case "mount":
                    if (data.cmd !== "mount" || data.code !== 1) {
                        this.update();
                    }
                    break;
            }
        }
    }

    public update() {
        void this.tree.update();
    }

    public destroy() {
        this.tree.destroy();
        super.destroy();
    }
}
