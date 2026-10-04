const resolvePictureImageURL = (value: string, sourceURL?: string) => {
    if (!value?.trim()) {
        return "";
    }
    try {
        const url = sourceURL ? new URL(value, sourceURL) : new URL(value);
        return /^https?:$/.test(url.protocol) ? url.href : "";
    } catch (_error) {
        return "";
    }
};

// 保留 URL 内部的逗号，按候选描述符选择同一来源中的最大图片。
export const getPictureImageSource = (srcset: string, sourceURL?: string) => {
    let remaining = srcset;
    let selected = "";
    let selectedSize = 0;
    while (remaining) {
        remaining = remaining.replace(/^[\s,]+/, "");
        const token = remaining.match(/^\S+/)?.[0];
        if (!token) {
            break;
        }
        remaining = remaining.substring(token.length);
        let source = token;
        let descriptor = "";
        if (source.endsWith(",")) {
            source = source.replace(/,+$/, "");
        } else {
            const end = remaining.indexOf(",");
            descriptor = (end < 0 ? remaining : remaining.substring(0, end)).trim();
            remaining = end < 0 ? "" : remaining.substring(end + 1);
        }
        if (descriptor && !/^(?:[1-9]\d*w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(descriptor)) {
            continue;
        }
        const size = descriptor ? Number.parseFloat(descriptor) : 1;
        const url = resolvePictureImageURL(source, sourceURL);
        if (url && Number.isFinite(size) && size > selectedSize) {
            selected = url;
            selectedSize = size;
        }
    }
    return selected;
};

// 在收集附件前展开 picture 的真实来源，避免将其回退图片当成内嵌附件上传。
export const normalizePictureImages = (root: ParentNode, sourceURL?: string,
                                       sourceImages?: HTMLImageElement[]) => {
    root.querySelectorAll<HTMLImageElement>("img").forEach((image, index) => {
        const original = sourceImages?.[index] || image;
        const picture = original.closest("picture");
        if (!picture) {
            return;
        }
        let source = resolvePictureImageURL(original.currentSrc, sourceURL);
        const src = image.getAttribute("src")?.trim() || "";
        if (!source && src && !/^data:image\//i.test(src)) {
            return;
        }
        if (!source) {
            for (const element of Array.from(picture.children)) {
                if (element.tagName !== "SOURCE") {
                    continue;
                }
                const type = element.getAttribute("type")?.trim().toLowerCase();
                if (type && !/^image\/(?:avif|webp|png|jpeg|gif|svg\+xml)$/.test(type)) {
                    continue;
                }
                const media = element.getAttribute("media");
                if (media && !window.matchMedia(media).matches) {
                    continue;
                }
                source = getPictureImageSource(element.getAttribute("srcset") ||
                    element.getAttribute("data-srcset") || "", sourceURL);
                if (source) {
                    break;
                }
            }
        }
        source = source || getPictureImageSource(original.getAttribute("srcset") ||
            original.getAttribute("data-srcset") || "", sourceURL);
        if (source) {
            image.setAttribute("src", source);
            // 清除会覆盖已选来源的懒加载属性，后续转换与资源下载使用同一地址。
            ["srcset", "data-src", "data-srcset", "data-original", "data-origin-src", "data-lazy-src"].forEach(attribute =>
                image.removeAttribute(attribute));
        }
    });
};
