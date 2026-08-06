export type AgentHistoryEntry = {
    id?: string;
    type: string;
    status?: string;
    content?: string;
    reasoningContent?: string;
    roundID?: string;
    duration?: number;
    steps?: AgentHistoryThinkingStep[];
    toolCalls?: Array<{
        name?: string;
        result?: string;
        state?: string;
        [key: string]: unknown
    }>;
    [key: string]: unknown;
};

export type AgentHistoryThinkingStep = {
    reasoning?: string;
    reasoningContent?: string;
    roundID?: string;
    toolNames?: string[];
    content?: string;
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

const sameToolNames = (left: string[] | undefined, right: string[]): boolean => {
    if (!left || left.length !== right.length) {
        return false;
    }
    return left.every((name, index) => name === right[index]);
};

const enrichThinkingStep = (step: AgentHistoryThinkingStep, entry: AgentHistoryEntry, includeContent: boolean) => {
    if (includeContent && entry.content?.trim()) {
        step.content = entry.content;
    }
    if (entry.reasoningContent?.trim()) {
        step.reasoningContent = entry.reasoningContent;
    }
    const toolNames = entry.toolCalls?.map(call => call.name || "").filter(Boolean) || [];
    if (toolNames.length > 0) {
        step.toolNames = toolNames;
    }
    if (entry.roundID) {
        step.roundID = entry.roundID;
    }
};

const buildRecoveredThinkingStep = (entry: AgentHistoryEntry, includeContent: boolean): AgentHistoryThinkingStep => ({
    reasoning: "processing",
    reasoningContent: entry.reasoningContent || "",
    roundID: entry.roundID,
    toolNames: entry.toolCalls?.map(call => call.name || "").filter(Boolean),
    content: includeContent ? entry.content : undefined,
});

const prepareAgentTurnPresentation = (entries: AgentHistoryEntry[]): AgentHistoryEntry[] => {
    const prepared: AgentHistoryEntry[] = entries.map(entry => ({
        ...entry,
        steps: entry.steps?.map(step => ({
            ...step,
            toolNames: step.toolNames?.slice(),
        })),
        toolCalls: entry.toolCalls?.map(call => ({...call})),
    }));
    const thinkingSteps = prepared.flatMap(entry => entry.type === "thinking" ? (entry.steps || []) : []);
    const matchedSteps = new Set<AgentHistoryThinkingStep>();
    const recovered: Array<{ entry: AgentHistoryEntry; step: AgentHistoryThinkingStep }> = [];

    for (const entry of prepared) {
        if (entry.type !== "assistant") {
            continue;
        }
        const isProcess = !!entry.toolCalls?.length;
        const toolNames = entry.toolCalls?.map(call => call.name || "").filter(Boolean) || [];
        let step: AgentHistoryThinkingStep | undefined;
        if (entry.roundID) {
            step = thinkingSteps.find(item => item.roundID === entry.roundID && !matchedSteps.has(item));
        }
        if (!step && (isProcess || entry.reasoningContent?.trim())) {
            step = thinkingSteps.find(item => !item.roundID && !matchedSteps.has(item) && (
                (isProcess && !!entry.content?.trim() && item.content === entry.content) ||
                sameToolNames(item.toolNames, toolNames) ||
                (!!entry.reasoningContent?.trim() && item.reasoningContent === entry.reasoningContent)
            ));
        }
        if (step) {
            enrichThinkingStep(step, entry, isProcess);
            matchedSteps.add(step);
        } else if (isProcess || entry.reasoningContent?.trim()) {
            recovered.push({entry, step: buildRecoveredThinkingStep(entry, isProcess)});
        }
        if (isProcess) {
            // 带工具调用的 assistant 是模型协议过程，不单独渲染为回答气泡。
            entry.content = undefined;
        }
    }

    if (recovered.length === 0) {
        return prepared;
    }

    const roundOrder = new Map<string, number>();
    let order = 0;
    for (const entry of prepared) {
        if (entry.type === "assistant" && entry.roundID && !roundOrder.has(entry.roundID)) {
            roundOrder.set(entry.roundID, order++);
        }
    }
    const synthetic: Array<{ entry: AgentHistoryEntry; step: AgentHistoryThinkingStep }> = [];
    for (const item of recovered) {
        const itemOrder = item.entry.roundID ? roundOrder.get(item.entry.roundID) : undefined;
        let nextEntry: AgentHistoryEntry | undefined;
        let nextStep: AgentHistoryThinkingStep | undefined;
        let nextOrder = Number.MAX_SAFE_INTEGER;
        if (itemOrder !== undefined) {
            for (const entry of prepared) {
                if (entry.type !== "thinking") {
                    continue;
                }
                for (const step of entry.steps || []) {
                    const stepOrder = step.roundID ? roundOrder.get(step.roundID) : undefined;
                    if (stepOrder !== undefined && stepOrder > itemOrder && stepOrder < nextOrder) {
                        nextEntry = entry;
                        nextStep = step;
                        nextOrder = stepOrder;
                    }
                }
            }
        }
        if (nextEntry && nextStep) {
            const nextIndex = nextEntry.steps?.indexOf(nextStep) ?? -1;
            nextEntry.steps?.splice(Math.max(nextIndex, 0), 0, item.step);
        } else {
            synthetic.push(item);
        }
    }
    if (synthetic.length > 0) {
        const firstUnmatched = prepared.indexOf(synthetic[0].entry);
        prepared.splice(firstUnmatched, 0, {
            type: "thinking",
            steps: synthetic.map(item => item.step),
        });
    }
    return prepared;
};

// 将持久化协议消息投影为 UI 条目：同一用户轮次中的工具调用消息归入思考卡片，
// 只有不带工具调用的 assistant 作为最终回答展示。
export const buildAgentPresentationEntries = (entries: AgentHistoryEntry[]): AgentHistoryEntry[] => {
    const result: AgentHistoryEntry[] = [];
    let turnEntries: AgentHistoryEntry[] = [];
    const flushTurn = () => {
        if (turnEntries.length > 0) {
            result.push(...prepareAgentTurnPresentation(turnEntries));
            turnEntries = [];
        }
    };
    for (const entry of entries) {
        if (entry.type === "user") {
            flushTurn();
            result.push({...entry});
        } else {
            turnEntries.push(entry);
        }
    }
    flushTurn();
    return result;
};

export const isAgentRegenerateStateCurrent = (requestSessionID: string, currentSessionID: string,
                                               requestRevision: number, currentRevision: number,
                                               isStreaming: boolean, mirrorLocked: boolean): boolean => {
    return requestSessionID === currentSessionID && requestRevision === currentRevision &&
        !isStreaming && !mirrorLocked;
};
