export type AgentHistoryEntry = {
    id?: string;
    type: string;
    status?: string;
    toolCalls?: Array<{ result?: string; state?: string }>;
};

export type AgentHistoryReference = { id: string; title: string };

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

export const isAgentRegenerateStateCurrent = (requestSessionID: string, currentSessionID: string,
                                               requestRevision: number, currentRevision: number,
                                               isStreaming: boolean, mirrorLocked: boolean): boolean => {
    return requestSessionID === currentSessionID && requestRevision === currentRevision &&
        !isStreaming && !mirrorLocked;
};

export const filterAgentReferencesForContent = (references: AgentHistoryReference[], content: string) => {
    return references.filter(reference => content.includes(reference.title));
};
