const getNextBlockElement = (element: Element) => {
    let nextElement = element.nextElementSibling;
    while (nextElement && !nextElement.getAttribute("data-node-id")) {
        nextElement = nextElement.nextElementSibling;
    }
    return nextElement;
};

export const getVisibleMoveElements = (sourceElement: Element, blockIDs?: string[]) => {
    const elements = [sourceElement];
    if (!blockIDs?.length) {
        return elements;
    }

    let blockIndex = 0;
    let nextElement = getNextBlockElement(sourceElement);
    while (nextElement) {
        const id = nextElement.getAttribute("data-node-id");
        if (!id) {
            break;
        }
        const matchedIndex = blockIDs.indexOf(id, blockIndex);
        if (matchedIndex < 0) {
            break;
        }
        elements.push(nextElement);
        blockIndex = matchedIndex + 1;
        if (blockIndex === blockIDs.length) {
            break;
        }
        nextElement = getNextBlockElement(nextElement);
    }
    return elements;
};

export const cloneMoveElements = (elements: Element[], pendingMapElements?: Set<Element>) =>
    elements.map(item => {
        const clone = item.cloneNode(true) as Element;
        const maps = Array.from(clone.querySelectorAll('[data-type="NodeAttributeView"][data-av-type="map"]'));
        if (clone.matches('[data-type="NodeAttributeView"][data-av-type="map"]')) maps.unshift(clone);
        maps.forEach(map => {
            // 宿主连接和临时分区不能随块 DOM 复制，插入完成后重新创建地图。
            map.querySelector(":scope > .av__container > .av__map")?.remove();
            map.removeAttribute("data-render");
            pendingMapElements?.add(map);
        });
        return clone;
    });
