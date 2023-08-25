import {fetchPost} from "../../util/fetch";

export const previewTemplate = (pathString: string, element: Element, parentId: string) => {
    if (!pathString) {
        element.innerHTML = "";
        return;
    }
    fetchPost("/api/template/render", {
        id: parentId,
        path: pathString
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
