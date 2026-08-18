import {endsWithMultiCharHintPrefix} from "../../../protyle/hint/blockHintRange";

interface ISkillHintRequestState {
    requestID: number;
    currentRequestID: number | undefined;
    enableExtend: boolean;
    enableSlash: boolean;
    splitChar: string;
    hidden: boolean;
    connected: boolean;
}

export const isSkillHintRequestActive = (state: ISkillHintRequestState) => {
    return state.currentRequestID === state.requestID && state.enableExtend && state.enableSlash &&
        ["/", "、"].includes(state.splitChar) && !state.hidden && state.connected;
};

export const shouldYieldSkillHint = (key: string, hintKeys: string[]) => {
    return endsWithMultiCharHintPrefix(key, hintKeys);
};
