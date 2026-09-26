export const buildListConversionOperations = (source: Element, options: {
    itemIDs: Set<string>,
    parentID: string,
    previousID?: string,
    convert?: (html: string) => string,
    newID: () => string,
}) => {
    const list = source.cloneNode(true) as Element;
    const container = document.createElement("div");
    container.append(list);
    const id = list.getAttribute("data-node-id");
    const items = Array.from(list.children).filter(item => item.getAttribute("data-type") === "NodeListItem");
    const selected = items.filter(item => options.itemIDs.has(item.getAttribute("data-node-id")));
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    const undoUpdates: IOperation[] = [];
    const restoreChildren = new Map<string, IOperation[]>();
    const shells = new Map<string, string>();
    const splitLists: Element[] = [];
    let anchor = list;
    let keptList: Element;
    let hasKeptList = false;
    let listMoved = false;
    items.forEach(item => {
        const itemID = item.getAttribute("data-node-id");
        if (!options.itemIDs.has(itemID)) {
            if (!keptList) {
                if (!hasKeptList) {
                    keptList = list;
                    hasKeptList = true;
                    if (anchor !== list) {
                        doOperations.push({action: "move", id, previousID: anchor.getAttribute("data-node-id"),
                            parentID: options.parentID});
                        anchor.after(list);
                        listMoved = true;
                    }
                } else {
                    // 拆分出的列表仅继承外观，不复制原列表的数据库或其他绑定属性。
                    keptList = document.createElement("div");
                    keptList.className = "list";
                    keptList.setAttribute("data-type", "NodeList");
                    keptList.setAttribute("data-subtype", list.getAttribute("data-subtype"));
                    keptList.setAttribute("data-node-id", options.newID());
                    if (list.hasAttribute("style")) {
                        keptList.setAttribute("style", list.getAttribute("style"));
                    }
                    const attr = document.createElement("div");
                    attr.className = "protyle-attr";
                    attr.setAttribute("contenteditable", "false");
                    keptList.append(attr);
                    doOperations.push({action: "insert", id: keptList.getAttribute("data-node-id"),
                        data: keptList.outerHTML, previousID: anchor.getAttribute("data-node-id"), parentID: options.parentID});
                    anchor.after(keptList);
                    splitLists.push(keptList);
                }
                anchor = keptList;
            }
            if (keptList !== list) {
                const previous = Array.from(keptList.children).filter(child => child.hasAttribute("data-node-id")).pop();
                doOperations.push({action: "move", id: itemID, parentID: keptList.getAttribute("data-node-id"),
                    previousID: previous?.getAttribute("data-node-id")});
                keptList.lastElementChild.before(item);
            }
            return;
        }
        keptList = undefined;
        const children = Array.from(item.children).filter(child => child.hasAttribute("data-node-id"));
        let previousID: string;
        const restore: IOperation[] = [];
        children.forEach((child, index) => {
            const childID = child.getAttribute("data-node-id");
            doOperations.push({action: "move", id: childID, previousID: anchor.getAttribute("data-node-id"),
                parentID: options.parentID});
            restore.push({action: "move", id: childID, parentID: itemID, previousID});
            previousID = childID;
            anchor.after(child);
            anchor = child;
            if (index === 0 && options.convert) {
                const oldHTML = child.outerHTML;
                const html = options.convert(oldHTML);
                undoUpdates.push({action: "update", id: childID, data: oldHTML});
                doOperations.push({action: "update", id: childID, data: html});
                const template = document.createElement("template");
                template.innerHTML = html;
                child.replaceWith(template.content);
                anchor = container.querySelector(`[data-node-id="${childID}"]`);
            }
        });
        restoreChildren.set(itemID, restore);
        shells.set(itemID, item.outerHTML);
    });
    if (selected.length === items.length) {
        doOperations.push({action: "delete", id});
        undoOperations.push({action: "insert", id, data: list.outerHTML,
            parentID: options.parentID, previousID: options.previousID});
        items.forEach(item => undoOperations.push(...restoreChildren.get(item.getAttribute("data-node-id"))));
        list.remove();
    } else {
        if (listMoved) {
            undoOperations.push({action: "move", id, parentID: options.parentID, previousID: options.previousID});
        }
        let previousID: string;
        items.forEach(item => {
            const itemID = item.getAttribute("data-node-id");
            if (options.itemIDs.has(itemID)) {
                doOperations.push({action: "delete", id: itemID});
                undoOperations.push({action: "insert", id: itemID, data: shells.get(itemID), parentID: id, previousID},
                    ...restoreChildren.get(itemID));
                item.remove();
            } else if (item.parentElement !== list) {
                undoOperations.push({action: "move", id: itemID, parentID: id, previousID});
            }
            previousID = itemID;
        });
        // 内容已移动到位，更新列表起始编号；撤销时先归位列表项，再恢复原编号。
        [list, ...splitLists].forEach(element => doOperations.push({action: "update",
            id: element.getAttribute("data-node-id"), data: element.outerHTML}));
        undoOperations.push({action: "update", id, data: source.outerHTML});
    }
    return {html: container.innerHTML, doOperations, undoOperations: undoOperations.concat(undoUpdates)};
};
