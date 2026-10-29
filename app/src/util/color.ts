// 复用一像素画布把浏览器能解析的颜色转成 sRGB 通道，供需要具体色值或 alpha 的功能共用。
let context: CanvasRenderingContext2D | null | undefined;

// 返回 0-255 的 RGBA 通道；颜色无效或画布不可用时返回 undefined，并在下次调用时重建画布。
export const parseCanvasColor = (color: string): [number, number, number, number] | undefined => {
    try {
        if (!CSS.supports("color", color)) {
            return;
        }
        if (!context) {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            context = canvas.getContext("2d", {willReadFrequently: true});
        }
        if (!context) {
            return;
        }
        context.clearRect(0, 0, 1, 1);
        // 先写入黑色，避免 fillStyle 被忽略时沿用上一次的颜色。
        context.fillStyle = "#000000";
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a];
    } catch {
        // 读取失败说明画布状态异常，丢弃上下文让后续调用重新创建。
        context = undefined;
    }
};
