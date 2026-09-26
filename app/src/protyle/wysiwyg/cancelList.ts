export const buildCancelListOperations = (source: Element, options: {
    previousID?: string,
    parentID?: string,
    recursively?: boolean,
}) => {
    const root = source.cloneNode(true) as Element;
    const container = document.createElement("div");
    container.append(root);
    const lists = [root];
    if (options.recursively) {
        lists.push(...Array.from(root.querySelectorAll('[data-type="NodeList"]')).filter(item =>
            item.getAttribute("data-subtype") === root.getAttribute("data-subtype")));
    }
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    // 从内到外拆除列表，内容块始终通过移动保留数据库关联及属性。
    lists.reverse().forEach(list => {
        const id = list.getAttribute("data-node-id");
        const parentID = list === root ? options.parentID : list.parentElement.closest("[data-node-id]")?.getAttribute("data-node-id");
        let previous = list.previousElementSibling;
        while (previous && !previous.hasAttribute("data-node-id")) {
            previous = previous.previousElementSibling;
        }
        const previousID = list === root ? options.previousID : previous?.getAttribute("data-node-id");
        const restoreMoves: IOperation[] = [];
        let anchor = list;
        Array.from(list.children).filter(item => item.getAttribute("data-type") === "NodeListItem").forEach(item => {
            let childPreviousID: string;
            Array.from(item.children).filter(child => child.hasAttribute("data-node-id")).forEach(child => {
                const childID = child.getAttribute("data-node-id");
                doOperations.push({action: "move", id: childID, previousID: anchor.getAttribute("data-node-id"), parentID});
                restoreMoves.push({action: "move", id: childID, previousID: childPreviousID,
                    parentID: item.getAttribute("data-node-id")});
                childPreviousID = childID;
                anchor.after(child);
                anchor = child;
            });
        });
        // 撤销先恢复空列表外壳，再移回原内容，避免重新插入内容块时清除数据库属性。
        undoOperations.unshift({action: "insert", id, data: list.outerHTML, previousID, parentID}, ...restoreMoves);
        doOperations.push({action: "delete", id});
        list.remove();
    });
    return {doOperations, undoOperations};
};
