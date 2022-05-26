export const removeFoldHeading = (nodeElement: Element) => {
    const nodeH = parseInt(nodeElement.getAttribute("data-subtype").substr(1));
    let nextElement = nodeElement.nextElementSibling;
    while (nextElement) {
        if (nextElement.classList.contains("sb")) {
            let nextFirstElement = nextElement.firstElementChild;
            while (nextFirstElement && nextFirstElement.classList.contains("sb")) {
                nextFirstElement = nextFirstElement.firstElementChild;
            }
            if ((nextFirstElement.getAttribute("data-type") === "NodeHeading" &&
                    parseInt(nextFirstElement.getAttribute("data-subtype").substr(1)) > nodeH) ||
                nextFirstElement.getAttribute("data-type") !== "NodeHeading") {
                const tempElement = nextElement;
                nextElement = nextElement.nextElementSibling;
                tempElement.remove();
            } else {
                break;
            }
        } else {
            const currentH = parseInt(nextElement.getAttribute("data-subtype")?.substr(1));
            if (!nextElement.classList.contains("protyle-attr") && // 超级块末尾为属性
                (isNaN(currentH) || currentH > nodeH)) {
                const tempElement = nextElement;
                nextElement = nextElement.nextElementSibling;
                tempElement.remove();
            } else {
                break;
            }
        }
    }
};
