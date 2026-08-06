export type AgentHistoryEntry = {
    id?: string;
    type: string;
    status?: string;
    content?: string;
    result?: string;
    callID?: string;
    reasoningContent?: string;
    roundID?: string;
    duration?: number;
    steps?: AgentHistoryThinkingStep[];
    toolCalls?: Array<{
        id?: string;
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
    toolCallIDs?: string[];
    content?: string;
};

export const getAgentThinkingToolGroups = (steps: AgentHistoryThinkingStep[]): string[][] => {
    return steps.map(step => (step.toolNames || []).filter(Boolean));
};

export const getAgentThinkingDisplaySeconds = (duration?: number): number | undefined => {
    if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
        return undefined;
    }
    return Math.max(1, Math.round(duration));
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
    if (entry.roundID) {
        step.roundID = entry.roundID;
    }
};

const enrichThinkingStepTools = (step: AgentHistoryThinkingStep, relatedSteps: AgentHistoryThinkingStep[],
                                 entry: AgentHistoryEntry) => {
    const calls = entry.toolCalls || [];
    const toolNames = calls.map(call => call.name || "").filter(Boolean);
    if (toolNames.length === 0) {
        return;
    }

    const hasCallIDs = relatedSteps.some(item => item.toolCallIDs && item.toolCallIDs.length > 0);
    if (hasCallIDs) {
        const assignedCallIndexes = new Set<number>();
        for (const relatedStep of relatedSteps) {
            if (!relatedStep.toolCallIDs || relatedStep.toolCallIDs.length === 0) {
                continue;
            }
            const resolvedNames: string[] = [];
            for (const callID of relatedStep.toolCallIDs) {
                const callIndex = calls.findIndex((call, index) =>
                    !assignedCallIndexes.has(index) && call.id === callID);
                if (callIndex >= 0 && calls[callIndex].name) {
                    assignedCallIndexes.add(callIndex);
                    resolvedNames.push(calls[callIndex].name!);
                }
            }
            if (resolvedNames.length > 0) {
                relatedStep.toolNames = resolvedNames;
            }
        }
        // 兼容一部分步骤尚未写入调用 ID 的过渡数据，先用已有名称认领对应调用。
        for (const relatedStep of relatedSteps) {
            if (relatedStep.toolCallIDs?.length || !relatedStep.toolNames?.length) {
                continue;
            }
            for (const name of relatedStep.toolNames) {
                const callIndex = calls.findIndex((call, index) =>
                    !assignedCallIndexes.has(index) && call.name === name);
                if (callIndex >= 0) {
                    assignedCallIndexes.add(callIndex);
                }
            }
        }
        const remainingCalls = calls.filter((call, index) => !assignedCallIndexes.has(index) && !!call.name);
        if (remainingCalls.length > 0) {
            step.toolNames = (step.toolNames || []).concat(remainingCalls.map(call => call.name!));
            const remainingIDs = remainingCalls.map(call => call.id || "").filter(Boolean);
            if (remainingIDs.length > 0) {
                step.toolCallIDs = (step.toolCallIDs || []).concat(remainingIDs);
            }
        }
        return;
    }

    // 一个模型轮次可能被确认卡片拆成多个思考步骤。老数据没有调用 ID 时保留已有子集，
    // 避免把整轮工具列表覆盖到第一个步骤后造成重复。
    if (relatedSteps.length > 1 && relatedSteps.some(item => item.toolNames && item.toolNames.length > 0)) {
        return;
    }
    step.toolNames = toolNames;
    const toolCallIDs = calls.map(call => call.id || "").filter(Boolean);
    if (toolCallIDs.length > 0) {
        step.toolCallIDs = toolCallIDs;
    }
};

const buildRecoveredThinkingStep = (entry: AgentHistoryEntry, includeContent: boolean): AgentHistoryThinkingStep => {
    const step: AgentHistoryThinkingStep = {
        reasoning: "processing",
        reasoningContent: entry.reasoningContent || "",
        roundID: entry.roundID,
        toolNames: entry.toolCalls?.map(call => call.name || "").filter(Boolean),
        content: includeContent ? entry.content : undefined,
    };
    const toolCallIDs = entry.toolCalls?.map(call => call.id || "").filter(Boolean) || [];
    if (toolCallIDs.length > 0) {
        step.toolCallIDs = toolCallIDs;
    }
    return step;
};

const prepareAgentTurnPresentation = (entries: AgentHistoryEntry[]): AgentHistoryEntry[] => {
    const prepared: AgentHistoryEntry[] = entries.map(entry => ({
        ...entry,
        steps: entry.steps?.map(step => ({
            ...step,
            toolNames: step.toolNames?.slice(),
            ...(step.toolCallIDs ? {toolCallIDs: step.toolCallIDs.slice()} : {}),
        })),
        toolCalls: entry.toolCalls?.map(call => ({...call})),
    }));
    const thinkingSteps = prepared.flatMap(entry => entry.type === "thinking" ? (entry.steps || []) : []);
    const matchedSteps = new Set<AgentHistoryThinkingStep>();
    const recovered: Array<{ entry: AgentHistoryEntry; step: AgentHistoryThinkingStep }> = [];
    const todoInsertions: Array<{
        sourceEntry: AgentHistoryEntry;
        anchorStep?: AgentHistoryThinkingStep;
        todoEntry: AgentHistoryEntry
    }> = [];

    for (const entry of prepared) {
        if (entry.type !== "assistant") {
            continue;
        }
        const isProcess = !!entry.toolCalls?.length;
        const toolNames = entry.toolCalls?.map(call => call.name || "").filter(Boolean) || [];
        let step: AgentHistoryThinkingStep | undefined;
        let relatedSteps: AgentHistoryThinkingStep[] = [];
        if (entry.roundID) {
            relatedSteps = thinkingSteps.filter(item => item.roundID === entry.roundID);
            step = relatedSteps.find(item => !matchedSteps.has(item));
        }
        if (!step && (isProcess || entry.reasoningContent?.trim())) {
            step = thinkingSteps.find(item => !item.roundID && !matchedSteps.has(item) && (
                (isProcess && !!entry.content?.trim() && item.content === entry.content) ||
                sameToolNames(item.toolNames, toolNames) ||
                (!!entry.reasoningContent?.trim() && item.reasoningContent === entry.reasoningContent)
            ));
        }
        let presentationStep = step;
        if (step) {
            enrichThinkingStep(step, entry, isProcess);
            enrichThinkingStepTools(step, relatedSteps.length > 0 ? relatedSteps : [step], entry);
            matchedSteps.add(step);
        } else if (isProcess || entry.reasoningContent?.trim()) {
            presentationStep = buildRecoveredThinkingStep(entry, isProcess);
            recovered.push({entry, step: presentationStep});
        }
        if (isProcess) {
            // 带工具调用的 assistant 是模型协议过程，不单独渲染为回答气泡。
            entry.content = undefined;
            const remainingToolCalls: NonNullable<AgentHistoryEntry["toolCalls"]> = [];
            for (const call of entry.toolCalls || []) {
                if (call.name === "todo_write" && call.result?.trim()) {
                    const callStep = call.id
                        ? thinkingSteps.find(item => item.toolCallIDs?.includes(call.id!))
                        : undefined;
                    todoInsertions.push({
                        sourceEntry: entry,
                        anchorStep: callStep || presentationStep,
                        todoEntry: {
                            type: "todo",
                            result: call.result,
                            callID: call.id,
                            roundID: entry.roundID,
                        },
                    });
                } else {
                    remainingToolCalls.push(call);
                }
            }
            entry.toolCalls = remainingToolCalls;
        }
    }

    if (recovered.length > 0) {
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
    }

    const todoOffsets = new Map<AgentHistoryEntry, number>();
    for (const item of todoInsertions) {
        const anchorEntry = item.anchorStep
            ? prepared.find(entry => entry.type === "thinking" && entry.steps?.includes(item.anchorStep!))
            : undefined;
        if (anchorEntry) {
            const offset = todoOffsets.get(anchorEntry) || 0;
            prepared.splice(prepared.indexOf(anchorEntry) + 1 + offset, 0, item.todoEntry);
            todoOffsets.set(anchorEntry, offset + 1);
        } else {
            const sourceIndex = prepared.indexOf(item.sourceEntry);
            prepared.splice(sourceIndex >= 0 ? sourceIndex : prepared.length, 0, item.todoEntry);
        }
    }

    // snapshot 事件先于当前思考卡片落盘。按 roundID 将其移到对应思考卡片之后；
    // 老数据没有 roundID 时，优先使用原位置之后的第一张思考卡片。
    for (const snapshot of prepared.filter(entry => entry.type === "snapshot")) {
        const snapshotIndex = prepared.indexOf(snapshot);
        const thinkingEntries = prepared.filter(entry => entry.type === "thinking" && entry.steps?.length);
        let anchorEntry: AgentHistoryEntry | undefined;
        if (snapshot.roundID) {
            for (let i = thinkingEntries.length - 1; i >= 0; i--) {
                if (thinkingEntries[i].steps?.some(step => step.roundID === snapshot.roundID)) {
                    anchorEntry = thinkingEntries[i];
                    break;
                }
            }
        }
        if (!anchorEntry) {
            anchorEntry = thinkingEntries.find(entry => prepared.indexOf(entry) > snapshotIndex) || thinkingEntries[0];
        }
        if (!anchorEntry) {
            continue;
        }
        prepared.splice(snapshotIndex, 1);
        prepared.splice(prepared.indexOf(anchorEntry) + 1, 0, snapshot);
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
