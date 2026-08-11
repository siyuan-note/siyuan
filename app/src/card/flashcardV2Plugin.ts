import type {IFlashcardV2RenderModel, IFlashcardV2RevealController} from "./flashcardV2Render";

export interface IFlashcardV2PluginAnswerController {
    check: () => unknown;
}

export interface IFlashcardV2PluginRenderResult {
    hasAnswer?: boolean;
    revealController?: IFlashcardV2RevealController;
    answerController?: IFlashcardV2PluginAnswerController;
}

export interface IFlashcardV2PluginContext {
    sourceType: string;
    model: IFlashcardV2RenderModel;
    doms: Record<string, string>;
}

export interface IFlashcardV2PluginRenderContext extends IFlashcardV2PluginContext {
    frontElement: Element;
    backElement: Element;
}

export interface IFlashcardV2PluginRegistration {
    typeName: string;
    displayName?: string;
    render?: (context: IFlashcardV2PluginRenderContext) => IFlashcardV2PluginRenderResult | void;
    create?: (context: { blockIDs: string[], reviewSetIDs: string[] }) => void | Promise<void>;
    edit?: (context: IFlashcardV2PluginContext) => void | Promise<void>;
}

const registrations = new Map<string, { namespace: string, registration: IFlashcardV2PluginRegistration }>();

export const flashcardV2PluginSourceType = (namespace: string, typeName: string) =>
    `plugin:${namespace}:${typeName}`;

export const registerFlashcardV2PluginType = (namespace: string,
    registration: IFlashcardV2PluginRegistration) => {
    if (!/^[A-Za-z0-9._-]+$/.test(namespace) || !/^[A-Za-z0-9._-]+$/.test(registration.typeName)) {
        throw new Error("Flashcard plugin namespace and type name may only contain letters, numbers, dot, underscore, and hyphen");
    }
    const sourceType = flashcardV2PluginSourceType(namespace, registration.typeName);
    const existing = registrations.get(sourceType);
    if (existing) {
        throw new Error(`Flashcard plugin type [${sourceType}] is already registered`);
    }
    registrations.set(sourceType, {namespace, registration});
    return () => {
        if (registrations.get(sourceType)?.registration === registration) {
            registrations.delete(sourceType);
        }
    };
};

export const getFlashcardV2PluginType = (sourceType: string) => registrations.get(sourceType)?.registration;

export const listFlashcardV2PluginTypes = () => [...registrations.entries()].map(([sourceType, value]) => ({
    sourceType,
    namespace: value.namespace,
    registration: value.registration,
})).sort((left, right) => left.sourceType.localeCompare(right.sourceType));

export const unregisterFlashcardV2PluginTypes = (namespace: string) => {
    registrations.forEach((value, sourceType) => {
        if (value.namespace === namespace) {
            registrations.delete(sourceType);
        }
    });
};

export const snapshotFlashcardV2AnswerResult = (value: unknown) => {
    if (value === undefined) {
        return;
    }
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? undefined : JSON.parse(serialized) as unknown;
    } catch (error) {
        console.error("Flashcard plugin answer result is not JSON serializable", error);
    }
};
