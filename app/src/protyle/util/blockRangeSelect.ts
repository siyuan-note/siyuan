type TGetBlock = (element: Node) => Element | false;

export const getBlockRangeSelectElements = (rangeStartElement: HTMLElement, rangeEndElement: HTMLElement,
                                             getBlock: TGetBlock) => {
    let startElement = rangeStartElement;
    let endElement = rangeEndElement;
    let toDown = true;
    const startRect = startElement.getBoundingClientRect();
    const endRect = endElement.getBoundingClientRect();
    let startTop = startRect.top;
    let endTop = endRect.top;
    if (startTop === endTop) {
        // 横排 https://ld246.com/article/1663036247544
        startTop = startRect.left;
        endTop = endRect.left;
    }
    if (startTop > endTop) {
        const tempElement = endElement;
        endElement = startElement;
        startElement = tempElement;
        const tempTop = endTop;
        endTop = startTop;
        startTop = tempTop;
        toDown = false;
    }
    let selectElements: HTMLElement[] = [];
    let currentElement: HTMLElement = startElement;
    let hasJump = false;
    while (currentElement) {
        if (currentElement.classList.contains("protyle-breadcrumb__bar")) {
            currentElement = currentElement.nextElementSibling as HTMLElement;
        }
        if (currentElement && !currentElement.classList.contains("protyle-attr")) {
            const currentRect = currentElement.getBoundingClientRect();
            if (startRect.top === endRect.top ? currentRect.left <= endTop : currentRect.top <= endTop) {
                if (hasJump) {
                    // 父节点的下个节点在选中范围内才可使用父节点作为选中节点
                    if (currentElement.nextElementSibling &&
                        !currentElement.nextElementSibling.classList.contains("protyle-attr")) {
                        const currentNextRect = currentElement.nextElementSibling.getBoundingClientRect();
                        if (startRect.top === endRect.top ?
                            currentNextRect.left <= endTop && currentNextRect.bottom <= endRect.bottom :
                            currentNextRect.top <= endTop) {
                            selectElements = [currentElement];
                            currentElement = currentElement.nextElementSibling as HTMLElement;
                            hasJump = false;
                        } else if (currentElement.parentElement.classList.contains("sb")) {
                            currentElement = getBlock(currentElement.parentElement) as HTMLElement;
                            hasJump = true;
                        } else {
                            break;
                        }
                    } else {
                        currentElement = getBlock(currentElement.parentElement) as HTMLElement;
                        hasJump = true;
                    }
                } else {
                    if (!currentElement.classList.contains("sb__resize")) {
                        selectElements.push(currentElement);
                    }
                    // 当前选择单元包含选区终点时停止，避免经过属性节点继续提升到父容器。
                    if (currentElement === endElement || currentElement.contains(endElement)) {
                        break;
                    }
                    const parentElement = currentElement.parentElement;
                    currentElement = currentElement.nextElementSibling as HTMLElement;
                    // 提示块内容使用无块 ID 的包装层，末尾需回到提示块后继续遍历同级块。
                    if (!currentElement && parentElement.classList.contains("callout-content")) {
                        currentElement = getBlock(parentElement) as HTMLElement;
                        hasJump = true;
                    }
                }
            } else if (currentElement.parentElement.classList.contains("sb")) {
                // 跳出超级块横向排版中的未选中元素
                currentElement = getBlock(currentElement.parentElement) as HTMLElement;
                hasJump = true;
            } else {
                break;
            }
        } else {
            currentElement = getBlock(currentElement.parentElement) as HTMLElement;
            hasJump = true;
        }
    }
    return {endElement, selectElements, startElement, toDown};
};
