export type AgentHistoryEntry = {
    id?: string;
    type: string;
    status?: string;
    reasoningContent?: string;
    steps?: Array<{ reasoningContent?: string }>;
    toolCalls?: Array<{ result?: string; state?: string }>;
};

export type AgentHistoryReference = { id: string; title: string };

export type AgentHistoryUserEntry = {
    content: string;
    blockHTML?: string;
    references?: AgentHistoryReference[];
};

export type AgentHistoryEditData = {
    text: string;
    blockHTML: string;
    references: AgentHistoryReference[];
};

export const applyAgentUserEdit = (entry: AgentHistoryUserEntry, data: AgentHistoryEditData) => {
    entry.content = data.text;
    entry.blockHTML = data.blockHTML;
    entry.references = data.references.length > 0 ? data.references.slice() : undefined;
};

export const findAgentUserEntryIndex = (entries: AgentHistoryEntry[], userEntryID?: string): number => {
    for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].type === "user" && (!userEntryID || entries[i].id === userEntryID)) {
            return i;
        }
    }
    return -1;
};

export const hasAgentExecutedToolsAfter = (entries: AgentHistoryEntry[], entryIndex: number): boolean => {
    return entries.slice(entryIndex + 1).some((entry) => {
        if (entry.type === "snapshot") {
            return true;
        }
        if (entry.type === "confirm") {
            return entry.status === "approved" || entry.status === "always";
        }
        return entry.type === "assistant" && !!entry.toolCalls?.some((call) =>
            call.state === "executing" || call.state === "completed" || call.result !== undefined);
    });
};

export const hasAgentModelSpecificContext = (entries: AgentHistoryEntry[]): boolean => {
    return entries.some((entry) => {
        if (entry.type === "assistant") {
            return !!entry.reasoningContent?.trim() || !!entry.toolCalls?.length;
        }
        return entry.type === "thinking" && !!entry.steps?.some(step => step.reasoningContent?.trim());
    });
};

export const isAgentRegenerateStateCurrent = (requestSessionID: string, currentSessionID: string,
                                               requestRevision: number, currentRevision: number,
                                               isStreaming: boolean, mirrorLocked: boolean): boolean => {
    return requestSessionID === currentSessionID && requestRevision === currentRevision &&
        !isStreaming && !mirrorLocked;
};
