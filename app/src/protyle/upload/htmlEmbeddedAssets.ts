import {createBase64ImageFile} from "./base64File";

export interface IHTMLEmbeddedAsset {
    file: File;
    apply(path: string): void;
}

export const isHTMLBase64Image = (value: string) => /^data:image\/[^,]+;base64,/i.test(value.trim());

export const hasHTMLEmbeddedAssets = (root: ParentNode) => {
    if (Array.from(root.querySelectorAll("pre")).some(element => element.hasAttributes() && element.querySelector("svg"))) {
        return true;
    }
    return Array.from(root.querySelectorAll("[href], [src]")).some(element =>
        ["href", "src"].some(attribute => {
            const source = element.getAttribute(attribute);
            return source ? isHTMLBase64Image(source) : false;
        }));
};

export const collectHTMLEmbeddedAssets = (root: ParentNode, maxBytes?: number) => {
    const assets: IHTMLEmbeddedAsset[] = [];
    const svgBlocks = new Set<Element>();
    root.querySelectorAll("pre").forEach(element => {
        if (!element.hasAttributes()) {
            return;
        }
        const svg = element.querySelector("svg");
        if (!svg) {
            return;
        }
        svgBlocks.add(element);
        const file = new File([svg.outerHTML], `inline-svg-${assets.length}.svg`, {type: "image/svg+xml"});
        assets.push({
            file,
            apply(path) {
                const image = element.ownerDocument.createElement("img");
                image.setAttribute("alt", "image");
                image.setAttribute("src", path);
                element.replaceWith(image);
            },
        });
    });
    root.querySelectorAll("[href], [src]").forEach(element => {
        if (Array.from(svgBlocks).some(block => block.contains(element))) {
            return;
        }
        (["href", "src"] as const).forEach(attribute => {
            const source = element.getAttribute(attribute);
            if (!source || !isHTMLBase64Image(source)) {
                return;
            }
            const file = createBase64ImageFile(source.trim(), `html-image-${assets.length}`, maxBytes);
            if (!file) {
                return;
            }
            assets.push({
                file,
                apply(path) {
                    element.setAttribute(attribute, path);
                },
            });
        });
    });
    return assets;
};

export const applyHTMLEmbeddedAssetPaths = (assets: IHTMLEmbeddedAsset[], paths: Array<string | undefined>) => {
    paths.forEach((path, index) => {
        if (path && assets[index]) {
            assets[index].apply(path);
        }
    });
};
