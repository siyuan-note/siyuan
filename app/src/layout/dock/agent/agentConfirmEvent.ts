export type IToolEffects = {
    localRead?: boolean;
    localWrite?: boolean;
    dataEgress?: boolean;
    externalCost?: boolean;
};

export const buildAgentConfirmEvent = (data: Record<string, unknown>) => ({
    type: "confirm" as const,
    name: data.name as string,
    arguments: (data.arguments || {}) as Record<string, unknown>,
    confirmID: data.confirmID as string,
    effects: data.effects as IToolEffects || undefined,
    forced: data.forced as boolean || false,
});
