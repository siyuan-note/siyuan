import {toggleMenu} from "../../menus/menuToggle";
import {bindPanelSearch} from "../../layout/dock/panelSearch";
import {TagTree} from "../../layout/dock/TagTree";
import {popSearch} from "../menu/search";
import type {App} from "../../index";
import {openTagMenu} from "../../menus/tag";
import {appendTagSortMenu} from "../../layout/dock/tagSortMenu";
import {showMobileFilterInput} from "./mobileFilterInput";

export class MobileTags {
    public element: HTMLElement;
    private tree: TagTree;

    constructor(app: App, element: HTMLElement) {
        this.element = element;
        this.element.innerHTML = `<div class="toolbar toolbar--dark">
    <div class="fn__space"></div>
    <div class="toolbar__text">
        ${window.siyuan.languages.tag}
    </div>
    <span class="fn__space"></span>
    <input spellcheck="false" class="b3-text-field search__label fn__none fn__size200" placeholder="${window.siyuan.languages.searchPlaceholder}" />
    <svg data-type="search" class="toolbar__icon"><use xlink:href='#iconSearch'></use></svg>
    <span class="fn__space"></span>
    <svg data-type="expand" class="toolbar__icon"><use xlink:href="#iconExpand"></use></svg>
    <span class="fn__space"></span>
    <svg data-type="collapse" class="toolbar__icon"><use xlink:href="#iconContract"></use></svg>
    <span class="fn__space${window.siyuan.config.readonly ? " fn__none" : ""}"></span>
    <svg data-type="sort" class="toolbar__icon${window.siyuan.config.readonly ? " fn__none" : ""}"><use xlink:href="#iconSort"></use></svg>
</div>
<div class="fn__flex-1 tagList"></div>
<div class="fn__loading" style="left:0"><span class="b3-loading b3-loading--large" aria-hidden="true"></span></div>`;
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        bindPanelSearch(inputElement,
            this.element.querySelector('[data-type="search"]'), () => this.tree.filter(), {
                activeClass: "toolbar__icon--active", updateLabel: false,
            });

        const loadingElement = this.element.lastElementChild;
        this.tree = new TagTree({
            element: this.element.querySelector<HTMLElement>(".tagList"),
            input: inputElement,
            mobile: true,
            open: label => popSearch(app, {
                hasReplace: false,
                method: 0,
                hPath: "",
                idPath: [],
                k: `#${label}#`,
                r: "",
                page: 1,
            }),
            menu: openTagMenu,
            setLoading: loading => loadingElement.classList.toggle("fn__none", !loading),
        });
        this.element.addEventListener("click", (event) => {
            if ((event.target as HTMLElement).tagName === "INPUT") {
                return;
            }
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("toolbar__icon")) {
                    const type = target.getAttribute("data-type");
                    switch (type) {
                        case "collapse":
                            this.tree.collapseAll();
                            event.preventDefault();
                            event.stopPropagation();
                            break;
                        case "expand":
                            this.tree.expandAll();
                            event.preventDefault();
                            event.stopPropagation();
                            break;
                        case "search":
                            showMobileFilterInput(inputElement, target);
                            break;
                        case "sort":

                            toggleMenu({
                                target: target,
                                build: (_menu, session) => {
                                    appendTagSortMenu(() => this.update());
                                    session.show(() => window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY}));

                                },
                            });
                           event.preventDefault();
                            event.stopPropagation();
                            break;
                    }
                }
                target = target.parentElement;
            }
        });
        this.update();
    }

    public update() {
        void this.tree.update();
    }
}
