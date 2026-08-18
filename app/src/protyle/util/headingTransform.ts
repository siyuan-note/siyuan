export const getHeadingLevelUpdateOperations = (operations: IOperation[], excludedIDs = new Set<string>()) => {
    return operations.filter(operation => operation.action === "update" && !excludedIDs.has(operation.id));
};

export const applyHeadingLevelUpdates = (protyle: IProtyle, operations: IOperation[], render: (element: HTMLElement) => unknown) => {
    getHeadingLevelUpdateOperations(operations).forEach(operation => {
        protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
            itemElement.outerHTML = operation.data;
        });
        // 使用 outer 后元素需要重新查询
        protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
            render(itemElement);
        });
    });
};
