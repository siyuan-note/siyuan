import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {focusByRange, focusByWbr} from "../util/selection";
import {writeText} from "../util/compatibility";

export const previewTemplate = (pathString: string, element: Element, parentId: string) => {
    if (!pathString) {
        element.innerHTML = "";
        return;
    }
    fetchPost("/api/template/render", {
        id: parentId,
        path: pathString,
        preview: true
    }, (response) => {
        element.innerHTML = `<div class="protyle-wysiwyg" style="padding: 8px">${response.data.content.replace(/contenteditable="true"/g, "")}</div>`;
    });
};

const mergeElement = (a: Element, b: Element, after = true) => {
    if (!a.getAttribute("data-type") || !b.getAttribute("data-type")) {
        return false;
    }
    a.setAttribute("data-type", a.getAttribute("data-type").replace("search-mark", "").trim());
    b.setAttribute("data-type", b.getAttribute("data-type").replace("search-mark", "").trim());
    const attributes = a.attributes;
    let isMatch = true;
    for (let i = 0; i < attributes.length; i++) {
        if (b.getAttribute(attributes[i].name) !== attributes[i].value) {
            isMatch = false;
        }
    }

    if (isMatch) {
        if (after) {
            a.innerHTML = a.innerHTML + b.innerHTML;
        } else {
            a.innerHTML = b.innerHTML + a.innerHTML;
        }
        b.remove();
    }
    return isMatch;
};

export const removeSearchMark = (element: HTMLElement) => {
    let previousElement = element.previousSibling as HTMLElement;
    while (previousElement && previousElement.nodeType !== 3) {
        if (!mergeElement(element, previousElement, false)) {
            break;
        } else {
            previousElement = element.previousSibling as HTMLElement;
        }
    }
    let nextElement = element.nextSibling as HTMLElement;
    while (nextElement && nextElement.nodeType !== 3) {
        if (!mergeElement(element, nextElement)) {
            break;
        } else {
            nextElement = element.nextSibling as HTMLElement;
        }
    }

    if ((element.getAttribute("data-type") || "").includes("search-mark")) {
        element.setAttribute("data-type", element.getAttribute("data-type").replace("search-mark", "").trim());
    }
};

export const removeInlineType = (inlineElement: HTMLElement, type: string, range?: Range) => {
    const types = inlineElement.getAttribute("data-type").split(" ");
    if (types.length === 1) {
        const linkParentElement = inlineElement.parentElement;
        inlineElement.outerHTML = inlineElement.innerHTML.replace(Constants.ZWSP, "") + "<wbr>";
        if (range) {
            focusByWbr(linkParentElement, range);
        }
    } else {
        types.find((itemType, index) => {
            if (type === itemType) {
                types.splice(index, 1);
                return true;
            }
        });
        inlineElement.setAttribute("data-type", types.join(" "));
        if (type === "a") {
            inlineElement.removeAttribute("data-href");
        } else if (type === "file-annotation-ref") {
            inlineElement.removeAttribute("data-id");
        } else if (type === "block-ref") {
            inlineElement.removeAttribute("data-id");
            inlineElement.removeAttribute("data-subtype");
        }
        if (range) {
            range.selectNodeContents(inlineElement);
            range.collapse(false);
            focusByRange(range);
        }
    }
};

export const toolbarKeyToMenu = (toolbar: Array<string | IMenuItem>) => {
    const toolbarItem: IMenuItem [] = [{
        name: "block-ref",
        hotkey: window.siyuan.config.keymap.editor.insert.ref.custom,
        lang: "ref",
        icon: "iconRef",
        tipPosition: "ne",
    }, {
        name: "a",
        hotkey: window.siyuan.config.keymap.editor.insert.link.custom,
        lang: "link",
        icon: "iconLink",
        tipPosition: "n",
    }, {
        name: "strong",
        lang: "bold",
        hotkey: window.siyuan.config.keymap.editor.insert.bold.custom,
        icon: "iconBold",
        tipPosition: "n",
    }, {
        name: "em",
        lang: "italic",
        hotkey: window.siyuan.config.keymap.editor.insert.italic.custom,
        icon: "iconItalic",
        tipPosition: "n",
    }, {
        name: "u",
        lang: "underline",
        hotkey: window.siyuan.config.keymap.editor.insert.underline.custom,
        icon: "iconUnderline",
        tipPosition: "n",
    }, {
        name: "s",
        lang: "strike",
        hotkey: window.siyuan.config.keymap.editor.insert.strike.custom,
        icon: "iconStrike",
        tipPosition: "n",
    }, {
        name: "mark",
        lang: "mark",
        hotkey: window.siyuan.config.keymap.editor.insert.mark.custom,
        icon: "iconMark",
        tipPosition: "n",
    }, {
        name: "sup",
        lang: "sup",
        hotkey: window.siyuan.config.keymap.editor.insert.sup.custom,
        icon: "iconSup",
        tipPosition: "n",
    }, {
        name: "sub",
        lang: "sub",
        hotkey: window.siyuan.config.keymap.editor.insert.sub.custom,
        icon: "iconSub",
        tipPosition: "n",
    }, {
        name: "kbd",
        lang: "kbd",
        hotkey: window.siyuan.config.keymap.editor.insert.kbd.custom,
        icon: "iconKeymap",
        tipPosition: "n",
    }, {
        name: "tag",
        lang: "tag",
        hotkey: window.siyuan.config.keymap.editor.insert.tag.custom,
        icon: "iconTags",
        tipPosition: "n",
    }, {
        name: "code",
        lang: "inline-code",
        hotkey: window.siyuan.config.keymap.editor.insert["inline-code"].custom,
        icon: "iconInlineCode",
        tipPosition: "n",
    }, {
        name: "inline-math",
        lang: "inline-math",
        hotkey: window.siyuan.config.keymap.editor.insert["inline-math"].custom,
        icon: "iconMath",
        tipPosition: "n",
    }, {
        name: "inline-memo",
        lang: "memo",
        hotkey: window.siyuan.config.keymap.editor.insert.memo.custom,
        icon: "iconM",
        tipPosition: "n",
    }, {
        name: "text",
        lang: "appearance",
        hotkey: window.siyuan.config.keymap.editor.insert.appearance.custom,
        icon: "iconFont",
        tipPosition: "n",
    }, {
        name: "clear",
        lang: "clearInline",
        hotkey: window.siyuan.config.keymap.editor.insert.clearInline.custom,
        icon: "iconClear",
        tipPosition: "n",
    }, {
        name: "|",
    }];
    const toolbarResult: IMenuItem[] = [];
    toolbar.forEach((menuItem: IMenuItem) => {
        let currentMenuItem = menuItem;
        toolbarItem.find((defaultMenuItem: IMenuItem) => {
            if (typeof menuItem === "string" && defaultMenuItem.name === menuItem) {
                currentMenuItem = defaultMenuItem;
                return true;
            }
            if (typeof menuItem === "object" && defaultMenuItem.name === menuItem.name) {
                currentMenuItem = Object.assign({}, defaultMenuItem, menuItem);
                return true;
            }
        });
        toolbarResult.push(currentMenuItem);
    });
    return toolbarResult;
};

export const copyTextByType = async (ids: string[],
                                     type: "ref" | "blockEmbed" | "protocol" | "protocolMd" | "hPath" | "id" | "webURL") => {
    let text = "";
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (ids.length > 1) {
            text += "- ";
        }
        if (type === "ref") {
            const response = await fetchSyncPost("/api/block/getRefText", {id});
            text += `((${id} '${response.data}'))`;
        } else if (type === "blockEmbed") {
            text += `{{select * from blocks where id='${id}'}}`;
        } else if (type === "protocol") {
            text += `siyuan://blocks/${id}`;
        } else if (type === "protocolMd") {
            const response = await fetchSyncPost("/api/block/getRefText", {id});
            text += `[${response.data}](siyuan://blocks/${id})`;
        } else if (type === "hPath") {
            const response = await fetchSyncPost("/api/filetree/getHPathByID", {id});
            text += response.data;
        } else if (type === "webURL") {
            text += `${window.location.origin}?id=${id}`;
        } else if (type === "id") {
            text += id;
        }
        if (ids.length > 1 && i !== ids.length - 1) {
            text += "\n";
        }
    }
    writeText(text);
};
