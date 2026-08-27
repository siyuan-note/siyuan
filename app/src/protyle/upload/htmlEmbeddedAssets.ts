import {
    addBase64ImageBatchSize,
    assertBase64ImageItemSize,
    createBase64ImageFile,
    getBase64ImageDecodedSize,
} from "./base64File";

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

const getInlineSVGBlocks = (root: ParentNode) => new Set(Array.from(root.querySelectorAll("pre")).filter(element =>
    element.hasAttributes() && element.querySelector("svg")));

export const validateHTMLEmbeddedAssetSizes = (root: ParentNode, maxBytes?: number) => {
    const svgBlocks = getInlineSVGBlocks(root);
    let totalBytes = 0;
    svgBlocks.forEach(element => {
        const svg = element.querySelector("svg")!;
        const size = new Blob([svg.outerHTML]).size;
        assertBase64ImageItemSize(size, maxBytes);
        totalBytes = addBase64ImageBatchSize(totalBytes, size);
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
            const size = getBase64ImageDecodedSize(source.trim());
            if (size === undefined) {
                return;
            }
            assertBase64ImageItemSize(size, maxBytes);
            totalBytes = addBase64ImageBatchSize(totalBytes, size);
        });
    });
};

export const collectHTMLEmbeddedAssets = (root: ParentNode, maxBytes?: number) => {
    validateHTMLEmbeddedAssetSizes(root, maxBytes);
    const assets: IHTMLEmbeddedAsset[] = [];
    let base64Bytes = 0;
    const svgBlocks = getInlineSVGBlocks(root);
    svgBlocks.forEach(element => {
        const svg = element.querySelector("svg")!;
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
            base64Bytes = addBase64ImageBatchSize(base64Bytes, file.size);
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
