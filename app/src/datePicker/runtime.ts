interface IDateDialog {
    element: HTMLElement;
    destroy(): void;
    focusWhenReady?: (target: () => HTMLElement) => void;
}
interface IDateDialogOptions {
    title?: string;
    content: string;
    width?: string;
    beforeClose?: () => boolean;
    destroyCallback?: () => void;
}
interface IDateRuntime {
    document: Document;
    createDialog: (options: IDateDialogOptions) => IDateDialog;
    languages: () => Record<string, string>;
    sequence: number;
    current?: {cancel: () => void};
}
const runtimeKey = Symbol.for("siyuan.datePicker.runtime");

export const registerDatePickerRuntime = (doc: Document, createDialog: IDateRuntime["createDialog"],
                                          languages: IDateRuntime["languages"]) => {
    if (Reflect.get(doc.defaultView, runtimeKey)?.document === doc) { return; }
    Object.defineProperty(doc.defaultView, runtimeKey, {configurable: true,
        value: {document: doc, createDialog, languages, sequence: 0} satisfies IDateRuntime});
};

export const getDatePickerRuntime = (owner: HTMLElement): IDateRuntime => {
    try {
        const doc = owner?.ownerDocument;
        const view = doc?.defaultView;
        const runtime = view && Reflect.get(view, runtimeKey) as IDateRuntime;
        if (!owner?.isConnected || !view || view.closed || view.document !== doc || runtime?.document !== doc ||
            !runtime.languages()) { throw new Error(); }
        return runtime;
    } catch {
        throw new TypeError("Date picker owner must belong to a ready SiYuan window");
    }
};
