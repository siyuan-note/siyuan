type TableCellContext = {owner: IProtyle, cell: HTMLTableCellElement, finish: () => void};

const contexts = new WeakMap<IProtyle, TableCellContext>();
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
};

export const getTableCellRichContext = (protyle: IProtyle) => {
    const context = contexts.get(protyle);
    return context?.cell.contains(protyle.element) ? context : undefined;
};

// 菜单展示期间保留文字选区，执行表格操作前再提交单元格内容。
export const prepareTableCellMenuItems = (items: IMenu[], prepare: () => void) => {
    items.forEach(item => {
        if (item.click) {
            const click = item.click;
            item.click = (...args) => {
                prepare();
                return click(...args);
            };
        }
        if (item.bind) {
            const bind = item.bind;
            item.bind = element => {
                element.addEventListener("click", event => {
                    if (!(event.target instanceof HTMLInputElement)) {
                        prepare();
                    }
                }, {capture: true});
                element.addEventListener("keydown", event => {
                    if (event.key === "Enter" && !event.isComposing) {
                        prepare();
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
