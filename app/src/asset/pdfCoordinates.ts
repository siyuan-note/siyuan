interface IPdfPointViewport {
    convertToViewportPoint(x: number, y: number): number[];
}

export const pdfRectToViewport = (viewport: IPdfPointViewport, rect: number[]): number[] => {
    return viewport.convertToViewportPoint(rect[0], rect[1])
        .concat(viewport.convertToViewportPoint(rect[2], rect[3]));
};
