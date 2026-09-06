export interface AVCellOverflowMetrics {
    clientHeight: number;
    clientWidth: number;
    scrollHeight: number;
    scrollWidth: number;
}

export const hasAVCellContentOverflow = (cell: AVCellOverflowMetrics,
                                         richText?: AVCellOverflowMetrics | null) =>
    cell.scrollWidth > cell.clientWidth + 2 || Boolean(richText &&
        (richText.scrollWidth > richText.clientWidth + 0.5 ||
            richText.scrollHeight > richText.clientHeight + 0.5));

export const shouldMeasureAVCellContentOverflow = (wrap: string | undefined, richText: boolean) =>
    wrap !== "true" || richText;
