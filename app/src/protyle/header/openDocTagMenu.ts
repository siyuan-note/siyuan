import {MenuItem} from "../../menus/Menu";
import {Constants} from "../../constants";
import {genTagList, renameTag} from "../../util/noRelyPCFunction";
import {upDownHint} from "../../util/upDownHint";
import {setPosition} from "../../util/setPosition";
import {encodeBase64, writeText} from "../util/compatibility";
import {removeZWJ} from "../util/normalizeText";
import {hasClosestByClassName} from "../util/hasClosest";
import {openGlobalSearch} from "../../search/util";

interface IOpenDocTagMenuOptions {
    protyle: IProtyle;
    tagElement: HTMLElement;
    position: IPosition;
    update: (tag: string) => void;
    remove: () => void;
}

const copyTag = async (protyle: IProtyle, tag: string) => {
    const textSiyuan = `<span data-type="tag">${Constants.ZWSP}${Lute.EscapeHTMLStr(tag)}</span>`;
    const textHTML = `<!--data-siyuan='${encodeBase64(textSiyuan)}'-->${removeZWJ(protyle.lute.BlockDOM2HTML(textSiyuan))}`;
    try {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/plain": new Blob([tag], {type: "text/plain"}),
                "text/html": new Blob([textHTML], {type: "text/html"}),
            })
        ]);
    } catch (e) {
        writeText(tag);
    }
};

export const openDocTagMenu = (options: IOpenDocTagMenuOptions) => {
    window.siyuan.menus.menu.remove();
    const tagName = options.tagElement.textContent.trim();
    let inputElement: HTMLInputElement;
    let skipUpdate = false;
    window.siyuan.menus.menu.removeCB = () => {
        if (!skipUpdate) {
            options.update(inputElement.value.trim());
        }
    };
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_DOC_TAG);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "tag",
        iconHTML: "",
        type: "readonly",
        label: `<input ${Constants.ATTRIBUTE_MENU_KEYMAP}="true" class="b3-text-field fn__block" style="margin: 4px 0" placeholder="${window.siyuan.languages.tag}">
<div class="fn__none b3-list fn__flex-1 b3-list--background protyle-hint" style="position: fixed"></div>`,
        bind(element) {
            const listElement = element.querySelector(".b3-list") as HTMLElement;
            inputElement = element.querySelector("input");
            inputElement.value = tagName;
            const renderTagList = () => {
                genTagList(listElement, inputElement.value.trim());
                const inputRect = inputElement.getBoundingClientRect();
                setPosition(listElement, inputRect.right + 8, inputRect.top, inputRect.height);
            };
            inputElement.addEventListener("compositionend", renderTagList);
            inputElement.addEventListener("input", (event: InputEvent) => {
                event.stopPropagation();
                if (!event.isComposing) {
                    renderTagList();
                }
            });
            inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }
                if (!listElement.classList.contains("fn__none")) {
                    upDownHint(listElement, event);
                    if (event.key === "Enter" || event.key === "Escape") {
                        listElement.classList.add("fn__none");
                    }
                    if (event.key === "Enter") {
                        const currentElement = listElement.querySelector(".b3-list-item--focus") as HTMLElement;
                        if (currentElement) {
                            inputElement.value = currentElement.dataset.type === "new" ?
                                currentElement.querySelector("mark").textContent.trim() : currentElement.textContent.trim();
                        }
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                if (event.key === "Enter") {
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                } else if (event.key === "Escape") {
                    window.siyuan.menus.menu.removeCB = null;
                }
            });
            listElement.addEventListener("click", (event) => {
                const listItemElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item");
                if (!listItemElement) {
                    return;
                }
                inputElement.value = listItemElement.dataset.type === "new" ?
                    listItemElement.querySelector("mark").textContent.trim() : listItemElement.textContent.trim();
                listElement.classList.add("fn__none");
                inputElement.focus();
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "search",
        label: window.siyuan.languages.search,
        accelerator: window.siyuan.languages.click,
        icon: "iconSearch",
        click() {
            openGlobalSearch(options.protyle.app, `#${tagName}#`, false, {method: 0});
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "rename",
        label: window.siyuan.languages.rename,
        icon: "iconEdit",
        click() {
            window.siyuan.menus.menu.remove();
            renameTag(tagName);
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "copy",
        label: window.siyuan.languages.copy,
        icon: "iconCopy",
        click() {
            void copyTag(options.protyle, tagName);
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        id: "remove",
        label: window.siyuan.languages.remove,
        icon: "iconTrashcan",
        click() {
            skipUpdate = true;
            options.remove();
        }
    }).element);
    window.siyuan.menus.menu.popup(options.position);
    inputElement.focus();
    inputElement.select();
};
