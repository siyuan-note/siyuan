import {setStorageVal} from "../../../protyle/util/compatibility";
import {getReasoningEffortOptions, type ReasoningEffort} from "../../../ai/reasoningEffort";

export const AGENT_REASONING_EFFORT_KEY = "siyuan-agent-reasoning-effort";

export const getAgentReasoningEffort = (): ReasoningEffort => {
    const value = window.siyuan.storage[AGENT_REASONING_EFFORT_KEY];
    return getReasoningEffortOptions({}).find(option => option.value === value)?.value ?? "";
};

export const setAgentReasoningEffort = (value: ReasoningEffort): void => {
    window.siyuan.storage[AGENT_REASONING_EFFORT_KEY] = value;
    setStorageVal(AGENT_REASONING_EFFORT_KEY, value);
};
