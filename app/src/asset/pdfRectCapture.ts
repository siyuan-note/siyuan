const PDF_POINTS_PER_INCH = 72;
export const PDF_RECT_CAPTURE_DPI = 288;
export const PDF_RECT_CAPTURE_SCALE = PDF_RECT_CAPTURE_DPI / PDF_POINTS_PER_INCH;
export const PDF_RECT_DISPLAY_SCALE = 2;
export const PDF_RECT_CAPTURE_MAX_EDGE = 8192;
export const PDF_RECT_CAPTURE_MAX_PIXELS = 16 * 1024 * 1024;
export const PDF_RECT_CAPTURE_PROFILE = "capture-v2";

interface IRectBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export const normalizePdfRect = (rect: number[]): IRectBounds => {
    const left = Math.min(rect[0], rect[2]);
    const top = Math.min(rect[1], rect[3]);
    const right = Math.max(rect[0], rect[2]);
    const bottom = Math.max(rect[1], rect[3]);
    return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
    };
};

export const getLimitedCaptureScale = (viewportRect: number[], targetScale = PDF_RECT_CAPTURE_SCALE,
                                        maxEdge = PDF_RECT_CAPTURE_MAX_EDGE,
                                        maxPixels = PDF_RECT_CAPTURE_MAX_PIXELS) => {
    const bounds = normalizePdfRect(viewportRect);
    if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
        return 0;
    }
    // 为取整产生的边缘像素预留空间，确保最终画布仍在限制内。
    const safeMaxEdge = Math.max(1, maxEdge - 2);
    const safeMaxPixels = Math.max(1, maxPixels - 4 * maxEdge - 4);
    const limitRatio = Math.min(
        1,
        safeMaxEdge / bounds.width,
        safeMaxEdge / bounds.height,
        Math.sqrt(safeMaxPixels / (bounds.width * bounds.height)),
    );
    return targetScale * limitRatio;
};

export const getCaptureCanvasBounds = (viewportRect: number[]) => {
    const bounds = normalizePdfRect(viewportRect);
    const left = Math.floor(bounds.left);
    const top = Math.floor(bounds.top);
    const right = Math.ceil(bounds.right);
    const bottom = Math.ceil(bounds.bottom);
    return {
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
    };
};

export const getCaptureDisplayWidth = (viewportRect: number[]) => {
    const width = normalizePdfRect(viewportRect).width;
    return Math.max(1, Math.round(width * 100) / 100);
};
