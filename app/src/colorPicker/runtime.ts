interface IColorDialog {
    element: HTMLElement;
    destroy(): void;
}
interface IColorDialogOptions {
    title?: string;
    content: string;
    width?: string;
    beforeClose?: () => boolean;
    destroyCallback?: () => void;
}
interface IColorRuntime {
    document: Document;
    createDialog: (options: IColorDialogOptions) => IColorDialog;
    languages: () => Record<string, string>;
    sequence: number;
    current?: {cancel: () => void};
}
const runtimeKey = Symbol.for("siyuan.colorPicker.runtime");

export const registerColorPickerRuntime = (doc: Document, createDialog: IColorRuntime["createDialog"],
                                           languages: IColorRuntime["languages"]) => {
    if (Reflect.get(doc.defaultView, runtimeKey)?.document === doc) { return; }
    Object.defineProperty(doc.defaultView, runtimeKey, {configurable: true,
        value: {document: doc, createDialog, languages, sequence: 0} satisfies IColorRuntime});
};

export const getColorPickerRuntime = (owner: HTMLElement): IColorRuntime => {
    try {
        const doc = owner?.ownerDocument;
        const view = doc?.defaultView;
        const runtime = view && Reflect.get(view, runtimeKey) as IColorRuntime;
        if (!owner?.isConnected || !view || view.closed || view.document !== doc || runtime?.document !== doc ||
            !runtime.languages()) { throw new Error(); }
        return runtime;
    } catch {
        throw new TypeError("Color picker owner must belong to a ready SiYuan window");
    }
};
