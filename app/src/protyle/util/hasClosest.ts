export const hasClosestByTag = (element: Node, nodeName: string) => {
    if (!element) {
        return false;
    }
    if (element.nodeType === 3) {
        element = element.parentElement;
    }
    let e = element as HTMLElement;
    let isClosest = false;
    while (e && !isClosest && !e.classList.contains("b3-typography")) {
        if (e.nodeName.indexOf(nodeName) === 0) {
            isClosest = true;
        } else {
            e = e.parentElement;
        }
    }
    return isClosest && e;
};

export const hasTopClosestByClassName = (element: Node, className: string, top = false) => {
    let closest = hasClosestByClassName(element, className, top);
    let parentClosest: boolean | HTMLElement = false;
    let findTop = false;
    while (closest && (top ? closest.tagName !== "BODY" : !closest.classList.contains("protyle-wysiwyg")) && !findTop) {
        parentClosest = hasClosestByClassName(closest.parentElement, className, top);
        if (parentClosest) {
            closest = parentClosest;
        } else {
            findTop = true;
        }
    }
    return closest || false;
};

export const hasTopClosestByTag = (element: Node, nodeName: string) => {
    let closest = hasClosestByTag(element, nodeName);
    let parentClosest: boolean | HTMLElement = false;
    let findTop = false;
    while (closest && !closest.classList.contains("protyle-wysiwyg") && !findTop) {
        parentClosest = hasClosestByTag(closest.parentElement, nodeName);
        if (parentClosest) {
            closest = parentClosest;
        } else {
            findTop = true;
        }
    }
    return closest || false;
};

export const hasTopClosestByAttribute = (element: Node, attr: string, value: string | null, top = false) => {
    let closest = hasClosestByAttribute(element, attr, value, top);
    let parentClosest: boolean | HTMLElement = false;
    let findTop = false;
    while (closest && !closest.classList.contains("protyle-wysiwyg") && !findTop) {
        parentClosest = hasClosestByAttribute(closest.parentElement, attr, value, top);
        if (parentClosest) {
            closest = parentClosest;
        } else {
            findTop = true;
        }
    }
    return closest || false;
};

export const hasClosestByAttribute = (element: Node, attr: string, value: string | null, top = false) => {
    if (!element) {
        return false;
    }
    if (element.nodeType === 3) {
        element = element.parentElement;
    }
    let e = element as HTMLElement;
    let isClosest = false;
    while (e && !isClosest && (top ? e.tagName !== "BODY" : !e.classList.contains("protyle-wysiwyg"))) {
        if (typeof value === "string" && e.getAttribute(attr)?.split(" ").includes(value)) {
            isClosest = true;
        } else if (typeof value !== "string" && e.hasAttribute(attr)) {
            isClosest = true;
        } else {
            e = e.parentElement;
        }
    }
    return isClosest && e;
};

export const hasClosestBlock = (element: Node) => {
    const nodeElement = hasClosestByAttribute(element, "data-node-id", null);
    if (nodeElement && nodeElement.tagName !== "BUTTON" && nodeElement.getAttribute("data-type")?.startsWith("Node")) {
        return nodeElement;
    }
    return false;
};

export const hasClosestByMatchTag = (element: Node, nodeName: string) => {
    if (!element) {
        return false;
    }
    if (element.nodeType === 3) {
        element = element.parentElement;
    }
    let e = element as HTMLElement;
    let isClosest = false;
    while (e && !isClosest && !e.classList.contains("protyle-wysiwyg")) {
        if (e.nodeName === nodeName) {
            isClosest = true;
        } else {
            e = e.parentElement;
        }
    }
    return isClosest && e;
};

export const hasClosestByClassName = (element: Node, className: string, top = false) => {
    if (!element) {
        return false;
    }
    if (element.nodeType === 3) {
        element = element.parentElement;
    }
    let e = element as HTMLElement;
    let isClosest = false;
    while (e && !isClosest && (top ? e.tagName !== "BODY" : !e.classList.contains("protyle-wysiwyg"))) {
        if (e.classList?.contains(className)) {
            isClosest = true;
        } else {
            e = e.parentElement;
        }
    }
    return isClosest && e;
};

export const isInEmbedBlock = (element: Element) => {
    const embedElement = hasTopClosestByAttribute(element, "data-type", "NodeBlockQueryEmbed");
    if (embedElement) {
        if (embedElement.isSameNode(element)) {
            return false;
        } else {
            return embedElement;
        }
    } else {
        return false;
    }
};
