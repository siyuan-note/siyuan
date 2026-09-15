interface ITaskListMarker {
    contentStartIndex: number;
    marker: string;
}

export const nextTaskListMarker = (marker: string | null) =>
    marker === null || marker === " " || marker === "/" ? "X" : " ";

export const nextTaskListStatus = (marker: string | null): string => {
    const states = [" ", "/", "X", "-"];
    return states[(states.indexOf(marker?.toUpperCase()) + 1) % states.length];
};

export const isTaskListMarker = (marker: string): boolean => marker.length === 1 &&
    getTaskListMarker(`[${marker}]`, false)?.marker === marker;

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
