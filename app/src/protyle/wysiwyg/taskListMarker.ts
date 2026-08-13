interface ITaskListMarker {
    contentStartIndex: number;
    marker: string;
}

export const getTaskListMarker = (html: string, enableFullWidth: boolean): ITaskListMarker | undefined => {
    const dataTask = html.substring(0, 3).match(enableFullWidth ?
        /^[\[【]([^\x80-\uffff\[\]【】])[\]】]$/ :
        /^\[([^\x80-\uffff\[\]])\]$/);
    if (dataTask) {
        return {
            contentStartIndex: 3,
            marker: dataTask[1],
        };
    }
    if (html.startsWith("[]") || (enableFullWidth && html.startsWith("【】"))) {
        return {
            contentStartIndex: 2,
            marker: " ",
        };
    }
};
