type TableCellContext = {owner: IProtyle, cell: HTMLTableCellElement, finish: () => void};

const contexts = new WeakMap<IProtyle, TableCellContext>();
const cellContexts = new WeakMap<HTMLTableCellElement, TableCellContext>();
const forwardedEventTargets = new WeakMap<Event, HTMLElement>();

export const setTableCellRichEventTarget = (event: Event, host: HTMLElement) => {
    forwardedEventTargets.set(event, host);
};

const getInlineEditor = (node: EventTarget | null) => {
    const element = node instanceof Element ? node : node instanceof Node ? node.parentElement : undefined;
    return element?.closest<HTMLElement>(".table__cell-editor.table__cell--inline");
};

export const getTableCellRichEventTarget = (event: Event) =>
    getInlineEditor(forwardedEventTargets.get(event) || event.target);

export const getTableCellRichSelectionHost = (selection: Selection) => {
    const host = getInlineEditor(selection?.anchorNode);
    return selection?.rangeCount === 1 && host?.contains(selection.focusNode) ? host : undefined;
};

export const setTableCellRichContext = (protyle: IProtyle, context: TableCellContext) => {
    contexts.set(protyle, context);
    cellContexts.set(context.cell, context);
};

// 结构和选区操作必须先提交单元格；组合输入尚未结束时保留编辑器和原始内容。
export const finishTableCellEditing = (cell: HTMLTableCellElement) => {
    cellContexts.get(cell)?.finish();
    return cell.isConnected && !cell.querySelector(".table__cell-editor");
};

export const getTableCellRichContext = (protyle: IProtyle) => {
    const context = contexts.get(protyle);
    return context?.cell.contains(protyle.element) ? context : undefined;
};

// 菜单展示期间保留文字选区，执行表格操作前再提交单元格内容。
export const prepareTableCellMenuItems = (items: IMenu[], prepare: () => boolean | void) => {
    items.forEach(item => {
        if (item.click) {
            const click = item.click;
            item.click = (...args) => {
                if (prepare() === false) {
                    return;
                }
                return click(...args);
            };
        }
        if (item.bind) {
            const bind = item.bind;
            item.bind = element => {
                element.addEventListener("click", event => {
                    if (!(event.target instanceof HTMLInputElement)) {
                        if (prepare() === false) {
                            event.preventDefault();
                            event.stopImmediatePropagation();
                        }
                    }
                }, {capture: true});
                element.addEventListener("keydown", event => {
                    if (event.key === "Enter" && !event.isComposing) {
                        if (prepare() === false) {
                            event.preventDefault();
                            event.stopImmediatePropagation();
                        }
                    }
                }, {capture: true});
                bind(element);
            };
        }
        if (item.submenu) {
            prepareTableCellMenuItems(item.submenu, prepare);
        }
    });
};
