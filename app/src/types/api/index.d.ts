// 此文件由内核契约生成，请运行 pnpm run api:generate 更新。

export type AIActionRequestInput = { "action": string; "ids": Array<string>; };

export type AIAgentAttachment = { "detail"?: string; "documentId": string; "height"?: number; "mimeType"?: string; "path": string; "pdfImage"?: AIPDFImageSelection; "type": string; "width"?: number; };

export type AIAgentAttachmentInput = { "detail"?: string | null; "documentId"?: string | null; "height"?: number | null; "mimeType"?: string | null; "path"?: string | null; "pdfImage"?: AIPDFImageSelectionInput | null; "type"?: string | null; "width"?: number | null; };

export type AIAgentChatRequestInput = { "blockHTML"?: string | null; "contentRevision"?: number | null; "editorContext"?: AIEditorContextInput | null; "frontendCapabilities"?: Array<AIFrontendCapabilityInput> | null; "language"?: string | null; "message"?: string | null; "model"?: string | null; "reasoningEffort"?: string | null; "references"?: Array<AIReferenceInput> | null; "regenerate"?: boolean | null; "sessionID"?: string | null; "userEntryID"?: string | null; };

export type AIAgentGoogleToolCallProviderData = { "thoughtSignature"?: string; };

export type AIAgentGoogleToolCallProviderDataInput = { "thoughtSignature"?: string | null; };

export type AIAgentInstructionsData = { "content": string; "revision": string; };

export type AIAgentInstructionsSaveRequestInput = { "content": string; "revision": string; };

export type AIAgentMessage = { "content": string; "editorContext"?: AIEditorContext; "entryID"?: string; "nativeContent"?: AINativeContent; "reasoningContent"?: string; "references"?: Array<AIReference>; "responseOutput"?: Array<JSONValue>; "responseOutputTokens"?: number; "role": string; "roundID"?: string; "toolCalls"?: Array<AIAgentToolCall>; };

export type AIAgentMessageInput = { "content"?: string | null; "editorContext"?: AIEditorContextInput | null; "entryID"?: string | null; "nativeContent"?: AINativeContentInput | null; "reasoningContent"?: string | null; "references"?: Array<AIReferenceInput> | null; "responseOutput"?: Array<JSONValue> | null; "responseOutputTokens"?: number | null; "role"?: string | null; "roundID"?: string | null; "toolCalls"?: Array<AIAgentToolCallInput> | null; };

export type AIAgentToolCall = { "arguments": { [key: string]: JSONValue } | null; "argumentsJSON"?: string; "attachments"?: Array<AIAgentAttachment>; "id"?: string; "name": string; "providerData"?: AIAgentToolCallProviderData; "result"?: string; "state"?: string; };

export type AIAgentToolCallInput = { "arguments"?: { [key: string]: JSONValue } | null; "argumentsJSON"?: string | null; "attachments"?: Array<AIAgentAttachmentInput> | null; "id"?: string | null; "name"?: string | null; "providerData"?: AIAgentToolCallProviderDataInput | null; "result"?: string | null; "state"?: string | null; };

export type AIAgentToolCallProviderData = { "google"?: AIAgentGoogleToolCallProviderData; };

export type AIAgentToolCallProviderDataInput = { "google"?: AIAgentGoogleToolCallProviderDataInput | null; };

export type AIBrowserCapabilityResultRequestInput = { "callID"?: string | null; "isError"?: boolean | null; "result"?: string | null; "structuredContent"?: JSONValue | null; "structuredContentSet"?: boolean | null; };

export type AIBuiltinSkillInfo = { "description": string; "digest": string; "enabled": boolean; "id": string; "name": string; "source": string; "version": string; };

export type AICapabilityAction = { "effects": AIToolEffects; "name": string; };

export type AICapabilityManifest = { "actions"?: Array<AICapabilityAction>; "agentOnly"?: boolean; "available": boolean; "description": string; "effects": AIToolEffects; "id": string; "name": string; "ownerId"?: string; "ownerName"?: string; "runtime": string; "source": string; "title"?: string; };

export type AIConfirmRequestInput = { "always"?: boolean | null; "approved"?: boolean | null; "confirmID"?: string | null; };

export type AIDecisionTestData = { "matched": boolean; "msg"?: string; };

export type AIDecisionTestRequestInput = { "profile"?: SettingDecisionProfileInput | null; "provider"?: string; };

export type AIEditorAction = { "action": string; "id": string; "name": string; };

export type AIEditorActionIDRequestInput = { "id": string; };

export type AIEditorActionSaveRequestInput = { "action": string; "id"?: string | null; "name": string; };

export type AIEditorChatRequestInput = { "action"?: string | null; "history"?: Array<AIEditorMessageInput> | null; "ids"?: Array<string> | null; "input"?: string | null; "taskID"?: string | null; };

export type AIEditorContext = { "activeDocID"?: string; "activeDocTitle"?: string; "focusedBlockID"?: string; "notebookID"?: string; "selectedBlockIDs"?: Array<string>; "visibleBlockIDs"?: Array<string>; };

export type AIEditorContextInput = { "activeDocID"?: string | null; "activeDocTitle"?: string | null; "focusedBlockID"?: string | null; "notebookID"?: string | null; "selectedBlockIDs"?: Array<string> | null; "visibleBlockIDs"?: Array<string> | null; };

export type AIEditorMessageInput = { "content"?: string | null; "role"?: string | null; };

export type AIEmbeddingStat = { "enabled": boolean; "failed": number; "ignoredByConfig": number; "ignoredByLen": number; "indexed": number; "pending": number; "total": number; };

export type AIEmbeddingTestData = { "dimensions"?: number; "matched": boolean; "msg"?: string; };

export type AIFrontendCapabilityInput = { "actionEffects"?: Record<string, AIToolEffectsInput> | null; "description"?: string | null; "effects"?: AIToolEffectsInput | null; "generation"?: number | null; "id"?: string | null; "inputSchema"?: { [key: string]: JSONValue } | null; "outputSchema"?: { [key: string]: JSONValue } | null; "ownerId"?: string | null; "ownerName"?: string | null; "source"?: string | null; "title"?: string | null; };

export type AIMCPEnvironmentData = { "defaults": Array<string> | null; "names": Array<string> | null; };

export type AIMCPIDRequestInput = { "id"?: string | null; };

export type AIMCPStatus = { "authorizationURL"?: string; "authorized": boolean; "error"?: string; "id": string; "name": string; "status": string; "tools": number; };

export type AIMessageRequestInput = { "msg": string; };

export type AIModelRequestInput = { "model": string; "provider"?: string | null; "providerConfig"?: SettingProviderInput | null; };

export type AIModelTestData = { "available": Array<string> | null; "matched": boolean; "msg"?: string; };

export type AIModelsData = { "contextLengths": Record<string, number> | null; "displayNames"?: Record<string, string>; "models": Array<string> | null; "msg"?: string; };

export type AINativeContent = { "blocks": Array<JSONValue> | null; "protocol": string; "version": number; };

export type AINativeContentInput = { "blocks": Array<JSONValue>; "protocol": string; "version": number; };

export type AIPDFImageSelection = { "object": number; "page": number; "revision": string; };

export type AIPDFImageSelectionInput = { "object"?: number | null; "page"?: number | null; "revision"?: string | null; };

export type AIPermissionData = { "permissionMode": string; };

export type AIPermissionRequestInput = { "permissionMode"?: string | null; "sessionID"?: string | null; };

export type AIProviderRequestInput = { "provider"?: string | null; "providerConfig"?: SettingProviderInput | null; };

export type AIQuestionRequestInput = { "answers"?: Array<string> | null; "questionID"?: string | null; };

export type AIReference = { "id": string; "title": string; };

export type AIReferenceInput = { "id"?: string | null; "title"?: string | null; };

export type AIRerankTestData = { "matched": boolean; "msg"?: string; };

export type AISSEBrowserCapabilityCall = { "arguments": { [key: string]: JSONValue } | null; "callID": string; "capabilityID": string; "generation": number; "name": string; };

export type AISSEConfirm = { "arguments": { [key: string]: JSONValue } | null; "confirmID": string; "effects": AIToolEffects; "forced": boolean; "name": string; };

export type AISSEFinish = { "finishReason": string; };

export type AISSEMessage = { "message": string; };

export type AISSEQuestion = { "arguments": { [key: string]: JSONValue } | null; "questionID": string; "roundID": string; };

export type AISSERetry = { "attempt": number; "maxRetries": number; };

export type AISSESnapshot = { "roundID": string; "snapshotID": string; };

export type AISSEStart = { "taskID": string; };

export type AISSEThinking = { "reasoning": string; "roundID": string; };

export type AISSEToken = { "token": string; };

export type AISSEToolCall = { "arguments": { [key: string]: JSONValue } | null; "callID": string; "name": string; "roundID": string; };

export type AISSEToolResult = { "callID": string; "name": string; "result": string; "roundID": string; };

export type AISSETurn = { "turnID": string; };

export type AISSEUsage = { "cachedTokens": number; "completionTokens": number; "contextLimit": number; "lastPromptTokens": number; "promptTokens": number; "tokenBreakdown": Record<string, number> | null; };

export type AISessionEntry = { "answers"?: Array<string>; "args"?: { [key: string]: JSONValue }; "blockHTML"?: string; "completionTokens"?: number; "confirmID"?: string; "content"?: string; "duration"?: number; "editorContext"?: AIEditorContext; "id"?: string; "name"?: string; "nativeContent"?: AINativeContent; "promptTokens"?: number; "questionID"?: string; "questions"?: Array<{ [key: string]: JSONValue } | null>; "reasoningContent"?: string; "references"?: Array<AIReference>; "responseOutput"?: Array<JSONValue>; "responseOutputTokens"?: number; "roundID"?: string; "snapshotID"?: string; "status"?: string; "steps"?: Array<AISessionEntryStep>; "timestamp"?: number; "toolCalls"?: Array<AIAgentToolCall>; "type": string; };

export type AISessionEntryInput = { "answers"?: Array<string> | null; "args"?: { [key: string]: JSONValue } | null; "blockHTML"?: string | null; "completionTokens"?: number | null; "confirmID"?: string | null; "content"?: string | null; "duration"?: number | null; "editorContext"?: AIEditorContextInput | null; "id"?: string | null; "name"?: string | null; "nativeContent"?: AINativeContentInput | null; "promptTokens"?: number | null; "questionID"?: string | null; "questions"?: Array<{ [key: string]: JSONValue } | null> | null; "reasoningContent"?: string | null; "references"?: Array<AIReferenceInput> | null; "responseOutput"?: Array<JSONValue> | null; "responseOutputTokens"?: number | null; "roundID"?: string | null; "snapshotID"?: string | null; "status"?: string | null; "steps"?: Array<AISessionEntryStepInput> | null; "timestamp"?: number | null; "toolCalls"?: Array<AIAgentToolCallInput> | null; "type"?: string | null; };

export type AISessionEntryStep = { "content"?: string; "reasoning": string; "reasoningContent"?: string; "roundID"?: string; "toolCallIDs"?: Array<string>; "toolNames"?: Array<string>; };

export type AISessionEntryStepInput = { "content"?: string | null; "reasoning"?: string | null; "reasoningContent"?: string | null; "roundID"?: string | null; "toolCallIDs"?: Array<string> | null; "toolNames"?: Array<string> | null; };

export type AISessionExtensionAIAgentAttachment = ({ "detail"?: string | null; "documentId"?: string | null; "height"?: number | null; "mimeType"?: string | null; "path"?: string | null; "pdfImage"?: AISessionExtensionAIPDFImageSelection | null; "type"?: string | null; "width"?: number | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAIAgentAttachmentInput = ({ "detail"?: string | null; "documentId"?: string | null; "height"?: number | null; "mimeType"?: string | null; "path"?: string | null; "pdfImage"?: AISessionExtensionAIPDFImageSelectionInput | null; "type"?: string | null; "width"?: number | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAIAgentGoogleToolCallProviderData = ({ "thoughtSignature"?: string | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAIAgentGoogleToolCallProviderDataInput = ({ "thoughtSignature"?: string | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAIAgentMessage = ({ "content"?: string | null; "editorContext"?: AISessionExtensionAIEditorContext | null; "entryID"?: string | null; "nativeContent"?: AISessionExtensionAINativeContent | null; "reasoningContent"?: string | null; "references"?: Array<AISessionExtensionAIReference> | null; "responseOutput"?: Array<JSONValue> | null; "responseOutputTokens"?: number | null; "role"?: string | null; "roundID"?: string | null; "toolCalls"?: Array<AISessionExtensionAIAgentToolCall> | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAIAgentMessageInput = ({ "content"?: string | null; "editorContext"?: AISessionExtensionAIEditorContextInput | null; "entryID"?: string | null; "nativeContent"?: AISessionExtensionAINativeContentInput | null; "reasoningContent"?: string | null; "references"?: Array<AISessionExtensionAIReferenceInput> | null; "responseOutput"?: Array<JSONValue> | null; "responseOutputTokens"?: number | null; "role"?: string | null; "roundID"?: string | null; "toolCalls"?: Array<AISessionExtensionAIAgentToolCallInput> | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAIAgentToolCall = ({ "arguments"?: { [key: string]: JSONValue } | null; "argumentsJSON"?: string | null; "attachments"?: Array<AISessionExtensionAIAgentAttachment> | null; "id"?: string | null; "name"?: string | null; "providerData"?: AISessionExtensionAIAgentToolCallProviderData | null; "result"?: string | null; "state"?: string | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAIAgentToolCallInput = ({ "arguments"?: { [key: string]: JSONValue } | null; "argumentsJSON"?: string | null; "attachments"?: Array<AISessionExtensionAIAgentAttachmentInput> | null; "id"?: string | null; "name"?: string | null; "providerData"?: AISessionExtensionAIAgentToolCallProviderDataInput | null; "result"?: string | null; "state"?: string | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAIAgentToolCallProviderData = ({ "google"?: AISessionExtensionAIAgentGoogleToolCallProviderData | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAIAgentToolCallProviderDataInput = ({ "google"?: AISessionExtensionAIAgentGoogleToolCallProviderDataInput | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAIEditorContext = ({ "activeDocID"?: string | null; "activeDocTitle"?: string | null; "focusedBlockID"?: string | null; "notebookID"?: string | null; "selectedBlockIDs"?: Array<string> | null; "visibleBlockIDs"?: Array<string> | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAIEditorContextInput = ({ "activeDocID"?: string | null; "activeDocTitle"?: string | null; "focusedBlockID"?: string | null; "notebookID"?: string | null; "selectedBlockIDs"?: Array<string> | null; "visibleBlockIDs"?: Array<string> | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAINativeContent = ({ "blocks"?: Array<JSONValue> | null; "protocol"?: string | null; "version"?: number | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAINativeContentInput = ({ "blocks"?: Array<JSONValue> | null; "protocol"?: string | null; "version"?: number | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAIPDFImageSelection = ({ "object"?: number | null; "page"?: number | null; "revision"?: string | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAIPDFImageSelectionInput = ({ "object"?: number | null; "page"?: number | null; "revision"?: string | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAIReference = ({ "id"?: string | null; "title"?: string | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAIReferenceInput = ({ "id"?: string | null; "title"?: string | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAISessionEntry = ({ "answers"?: Array<string> | null; "args"?: { [key: string]: JSONValue } | null; "blockHTML"?: string | null; "completionTokens"?: number | null; "confirmID"?: string | null; "content"?: string | null; "duration"?: number | null; "editorContext"?: AISessionExtensionAIEditorContext | null; "id"?: string | null; "name"?: string | null; "nativeContent"?: AISessionExtensionAINativeContent | null; "promptTokens"?: number | null; "questionID"?: string | null; "questions"?: Array<{ [key: string]: JSONValue } | null> | null; "reasoningContent"?: string | null; "references"?: Array<AISessionExtensionAIReference> | null; "responseOutput"?: Array<JSONValue> | null; "responseOutputTokens"?: number | null; "roundID"?: string | null; "snapshotID"?: string | null; "status"?: string | null; "steps"?: Array<AISessionExtensionAISessionEntryStep> | null; "timestamp"?: number | null; "toolCalls"?: Array<AISessionExtensionAIAgentToolCall> | null; "type"?: string | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAISessionEntryInput = ({ "answers"?: Array<string> | null; "args"?: { [key: string]: JSONValue } | null; "blockHTML"?: string | null; "completionTokens"?: number | null; "confirmID"?: string | null; "content"?: string | null; "duration"?: number | null; "editorContext"?: AISessionExtensionAIEditorContextInput | null; "id"?: string | null; "name"?: string | null; "nativeContent"?: AISessionExtensionAINativeContentInput | null; "promptTokens"?: number | null; "questionID"?: string | null; "questions"?: Array<{ [key: string]: JSONValue } | null> | null; "reasoningContent"?: string | null; "references"?: Array<AISessionExtensionAIReferenceInput> | null; "responseOutput"?: Array<JSONValue> | null; "responseOutputTokens"?: number | null; "roundID"?: string | null; "snapshotID"?: string | null; "status"?: string | null; "steps"?: Array<AISessionExtensionAISessionEntryStepInput> | null; "timestamp"?: number | null; "toolCalls"?: Array<AISessionExtensionAIAgentToolCallInput> | null; "type"?: string | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAISessionEntryStep = ({ "content"?: string | null; "reasoning"?: string | null; "reasoningContent"?: string | null; "roundID"?: string | null; "toolCallIDs"?: Array<string> | null; "toolNames"?: Array<string> | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAISessionEntryStepInput = ({ "content"?: string | null; "reasoning"?: string | null; "reasoningContent"?: string | null; "roundID"?: string | null; "toolCallIDs"?: Array<string> | null; "toolNames"?: Array<string> | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAISessionFields = ({ "agentRunning"?: boolean | null; "alwaysAllow"?: boolean | null; "commitTurnID"?: string | null; "completionTokens"?: number | null; "contextCachedTokens"?: number | null; "contextLimit"?: number | null; "contextTokenBreakdown"?: Record<string, number> | null; "contextTokens"?: number | null; "createdAt"?: number | null; "entries"?: Array<AISessionExtensionAISessionEntry> | null; "expectedRevision"?: number | null; "id": string; "lastCommittedTurnID"?: string | null; "messageHistory"?: Array<string> | null; "messages"?: Array<AISessionExtensionAIAgentMessage> | null; "model"?: string | null; "permissionMode"?: string | null; "pinnedAt"?: number | null; "promptTokens"?: number | null; "recoveryRevision"?: number | null; "recoveryState"?: string | null; "recoveryTurnID"?: string | null; "revision"?: number | null; "snapshots"?: Array<string> | null; "title"?: string | null; "titled"?: boolean | null; "totalDuration"?: number | null; "updatedAt"?: number | null; } & { [key: string]: JSONValue });

export type AISessionExtensionAISessionFieldsInput = ({ "agentRunning"?: boolean | null; "alwaysAllow"?: boolean | null; "commitTurnID"?: string | null; "completionTokens"?: number | null; "contextCachedTokens"?: number | null; "contextLimit"?: number | null; "contextTokenBreakdown"?: Record<string, number> | null; "contextTokens"?: number | null; "createdAt"?: number | null; "entries"?: Array<AISessionExtensionAISessionEntryInput> | null; "expectedRevision"?: number | null; "id": string; "lastCommittedTurnID"?: string | null; "messageHistory"?: Array<string> | null; "messages"?: Array<AISessionExtensionAIAgentMessageInput> | null; "model"?: string | null; "permissionMode"?: string | null; "pinnedAt"?: number | null; "promptTokens"?: number | null; "recoveryRevision"?: number | null; "recoveryState"?: string | null; "recoveryTurnID"?: string | null; "revision"?: number | null; "snapshots"?: Array<string> | null; "title"?: string | null; "titled"?: boolean | null; "totalDuration"?: number | null; "updatedAt"?: number | null; } & { [key: string]: JSONValue });

export type AISessionFields = { "agentRunning"?: boolean; "alwaysAllow"?: boolean; "commitTurnID"?: string; "completionTokens"?: number; "contextCachedTokens"?: number; "contextLimit"?: number; "contextTokenBreakdown"?: Record<string, number>; "contextTokens"?: number; "createdAt"?: number; "entries"?: Array<AISessionEntry>; "expectedRevision"?: number; "id": string; "lastCommittedTurnID"?: string; "messageHistory"?: Array<string>; "messages"?: Array<AIAgentMessage>; "model"?: string; "permissionMode"?: string; "pinnedAt"?: number; "promptTokens"?: number; "recoveryRevision"?: number; "recoveryState"?: string; "recoveryTurnID"?: string; "revision"?: number; "snapshots"?: Array<string>; "title"?: string; "titled"?: boolean; "totalDuration"?: number; "updatedAt"?: number; };

export type AISessionFieldsInput = { "agentRunning"?: boolean | null; "alwaysAllow"?: boolean | null; "commitTurnID"?: string | null; "completionTokens"?: number | null; "contextCachedTokens"?: number | null; "contextLimit"?: number | null; "contextTokenBreakdown"?: Record<string, number> | null; "contextTokens"?: number | null; "createdAt"?: number | null; "entries"?: Array<AISessionEntryInput> | null; "expectedRevision"?: number | null; "id": string; "lastCommittedTurnID"?: string | null; "messageHistory"?: Array<string> | null; "messages"?: Array<AIAgentMessageInput> | null; "model"?: string | null; "permissionMode"?: string | null; "pinnedAt"?: number | null; "promptTokens"?: number | null; "recoveryRevision"?: number | null; "recoveryState"?: string | null; "recoveryTurnID"?: string | null; "revision"?: number | null; "snapshots"?: Array<string> | null; "title"?: string | null; "titled"?: boolean | null; "totalDuration"?: number | null; "updatedAt"?: number | null; };

export type AISessionIDRequestInput = { "id"?: string | null; };

export type AISessionIndex = { "agentRunning"?: boolean; "createdAt": number; "id": string; "pinnedAt"?: number; "title": string; "updatedAt": number; };

export type AISessionList = { "page": number; "pageSize": number; "sessions": Array<AISessionIndex | null> | null; "total": number; };

export type AISessionPinnedData = { "pinnedAt": number; };

export type AISessionPinnedRequestInput = { "id": string; "pinned": boolean; };

export type AISessionSaveData = { "revision": number; "session"?: AISessionExtensionAISessionFields; };

export type AISessionsRequestInput = { "keyword"?: string | null; "page"?: number | null; "pageSize"?: number | null; };

export type AISkillData = { "content": string; "name": string; };

export type AISkillFileData = { "content"?: string; "entries"?: Array<AISkillFileEntry> | null; "readOnlyReason"?: "binary" | "encoding" | "tooLarge"; "revision"?: string; };

export type AISkillFileEntry = { "editable": boolean; "isDir": boolean; "path": string; };

export type AISkillFileRequestInput = { "action": string; "content"?: string; "path"?: string; "revision"?: string; "target"?: string; };

export type AISkillInfo = { "description": string; "name": string; };

export type AISkillNameRequestInput = { "name"?: string | null; "source"?: string | null; };

export type AISkillRenameRequestInput = { "newName"?: string | null; "oldName"?: string | null; "source"?: string | null; };

export type AISkillSaveRequestInput = { "content"?: string | null; "name"?: string | null; "source"?: string | null; };

export type AITitleRequestInput = { "language"?: string | null; "message"?: string | null; "model"?: string | null; };

export type AIToolEffects = { "dataEgress"?: boolean; "externalCost"?: boolean; "localRead"?: boolean; "localWrite"?: boolean; };

export type AIToolEffectsInput = { "dataEgress"?: boolean | null; "externalCost"?: boolean | null; "localRead"?: boolean | null; "localWrite"?: boolean | null; };

export type AIUserSkillInfo = { "description": string; "enabled": boolean; "id": string; "name": string; "shadowed": boolean; };

export type AVArchiveRenderData = { "colorOrder": Array<string> | null; "customColors": Array<AVAttributeViewCustomColor | null> | null; "defaultTemplateID": string; "id": string; "isMirror": boolean; "name": string; "newItemTemplates": Array<AVNewItemTemplate | null> | null; "usedCustomColorIndexes": Array<number> | null; "view": AVViewInstance; "viewID": string; "viewType": "table" | "list" | "gallery" | "kanban" | "calendar"; "views": Array<AVViewData | null> | null; };

export type AVAttributeViewBacklink = { "avID": string; "avName": string; "blockIDs": Array<string> | null; "boundBlockID": string; "boxID": string; "databaseBlockID": string; "databasePath": string; "icon": string; "isDetached": boolean; "itemID": string; "relations": Array<AVAttributeViewBacklinkRelation | null> | null; "title": string; "valueID": string; };

export type AVAttributeViewBacklinkRelation = { "keyID": string; "keyName": string; "targetAvID": string; "targetItemID": string; };

export type AVAttributeViewBacklinks = { "items": Array<AVAttributeViewBacklink | null> | null; "total": number; };

export type AVAttributeViewColor = { "dark": AVAttributeViewColorTheme; "light": AVAttributeViewColorTheme; };

export type AVAttributeViewColorInput = { "dark"?: AVAttributeViewColorThemeInput | null; "light"?: AVAttributeViewColorThemeInput | null; };

export type AVAttributeViewColorTheme = { "backgroundColor": string; "color": string; };

export type AVAttributeViewColorThemeInput = { "backgroundColor"?: string | null; "color"?: string | null; };

export type AVAttributeViewContextFilter = { "keyID": string; "spec": 1; };

export type AVAttributeViewContextFilterField = { "icon": string; "id": string; "name": string; "targetAvID": string; };

export type AVAttributeViewCustomColor = { "dark": AVAttributeViewColorTheme; "hidden"?: boolean; "index": number; "light": AVAttributeViewColorTheme; };

export type AVAttributeViewCustomColorInput = { "dark"?: AVAttributeViewColorThemeInput | null; "hidden"?: boolean | null; "index"?: number | null; "light"?: AVAttributeViewColorThemeInput | null; };

export type AVAttributeViewData = { "automations"?: AVAutomationConfig; "cardCoverPositions"?: Record<string, Record<string, AVCardCoverPosition | null> | null>; "customColors": Array<AVAttributeViewCustomColor | null> | null; "defaultTemplateID"?: string; "id": string; "keyIDs": Array<string> | null; "keyValues": Array<AVKeyValues | null> | null; "name": string; "newItemTemplates"?: Array<AVNewItemTemplate | null>; "spec": number; "viewID": string; "views": Array<AVView | null> | null; };

export type AVAttributeViewFieldView = { "hidden": boolean; "icon": string; "id": string; "name": string; "type": "table" | "list" | "gallery" | "kanban" | "calendar"; };

export type AVAttributeViewGroupItemPosition = { "groupID": string; "previousID": string; };

export type AVAttributeViewItemPosition = { "groups": Array<AVAttributeViewGroupItemPosition | null> | null; "previousID": string; "viewID": string; };

export type AVAttributeViewRenderTarget = { "groupID"?: string; "index": number; "itemID": string; "offset": number; "pageSize": number; "status": "visible" | "filtered" | "itemNotFound" | "groupHidden"; };

export type AVAttributeViewSearchTarget = { "avID": string; "boundBlockID": string; "databaseBlockID": string; "groupID"?: string; "isDetached": boolean; "itemID": string; "keywords": Array<string> | null; "matchedKeyID": string; "matchedValueID": string; "notebookID": string; "title": string; "valueID": string; "viewID"?: string; };

export type AVAutomationAction = { "avID"?: string; "fields": Record<string, AVAutomationValue | null> | null; "filters"?: Array<AVViewFilter | null>; "relationKeyID"?: string; "target": "current" | "related" | "filtered"; "type": "add" | "edit" | "collect"; };

export type AVAutomationActionInput = { "avID"?: string; "fields": Record<string, AVAutomationValueInput | null>; "filters"?: Array<AVViewFilterInput | null>; "relationKeyID"?: string; "target": "current" | "related" | "filtered"; "type": "add" | "edit" | "collect"; };

export type AVAutomationBlockAttribute = { "name": string; "nameOperator"?: "" | "equals" | "contains" | "regex"; "operator": "equals" | "contains" | "exists" | "notExists"; "value"?: string; };

export type AVAutomationBlockAttributeInput = { "name": string; "nameOperator"?: "" | "equals" | "contains" | "regex"; "operator": "equals" | "contains" | "exists" | "notExists"; "value"?: string; };

export type AVAutomationBlockSource = { "attributeMatch"?: "" | "and" | "or"; "attributes"?: Array<AVAutomationBlockAttribute | null>; "documentDepth"?: number; "documentIDs"?: Array<string>; "includeSelectedDocuments"?: boolean; "notebookIDs"?: Array<string>; "referenceID"?: string; "tagMatch"?: "" | "and" | "or"; "tagTarget"?: "" | "block" | "container"; "tags"?: Array<string>; "types"?: Array<string>; };

export type AVAutomationBlockSourceInput = { "attributeMatch"?: "" | "and" | "or"; "attributes"?: Array<AVAutomationBlockAttributeInput | null>; "documentDepth"?: number | null; "documentIDs"?: Array<string>; "includeSelectedDocuments"?: boolean | null; "notebookIDs"?: Array<string>; "referenceID"?: string; "tagMatch"?: "" | "and" | "or"; "tagTarget"?: "" | "block" | "container"; "tags"?: Array<string>; "types"?: Array<string>; };

export type AVAutomationConfig = { "rules": Array<AVAutomationRule | null> | null; "spec": number; };

export type AVAutomationConfigInput = { "rules": Array<AVAutomationRuleInput | null>; "spec": number; };

export type AVAutomationRule = { "actions": Array<AVAutomationAction | null> | null; "blockSource"?: AVAutomationBlockSource; "conditions"?: Array<AVViewFilter | null>; "enabled": boolean; "id": string; "keyID"?: string; "name": string; "notifyOnSuccess"?: boolean; "timeZone"?: string; "trigger": "added" | "changed" | "block"; };

export type AVAutomationRuleInput = { "actions": Array<AVAutomationActionInput | null>; "blockSource"?: AVAutomationBlockSourceInput | null; "conditions"?: Array<AVViewFilterInput | null>; "enabled": boolean; "id": string; "keyID"?: string; "name": string; "notifyOnSuccess"?: boolean | null; "timeZone"?: string; "trigger": "added" | "changed" | "block"; };

export type AVAutomationTemplatePreviewRequestInput = { "avID": string; "inputs"?: Record<string, string>; "itemID": string; "keyID": string; "targetAvID"?: string; "template": string; "timeZone": string; "triggerTime"?: string; };

export type AVAutomationValue = { "keyID"?: string; "mode": "static" | "source" | "currentTime" | "triggerItem" | "template"; "template"?: string; "value"?: AVValue; };

export type AVAutomationValueInput = { "keyID"?: string; "mode": "static" | "source" | "currentTime" | "triggerItem" | "template"; "template"?: string; "value"?: AVValueInput | null; };

export type AVAvSearchResult = { "avID": string; "avName": string; "blockID": string; "children"?: Array<AVAvSearchResult | null>; "hPath": string; "matched"?: boolean; "viewID": string; "viewLayout": "" | "table" | "list" | "gallery" | "kanban" | "calendar"; "viewName": string; };

export type AVBlockAttributeViewKeys = { "avID": string; "avName": string; "blockIDs": Array<string> | null; "customColors": Array<AVAttributeViewCustomColor | null> | null; "itemPositions": Array<AVAttributeViewItemPosition | null> | null; "keyValues": Array<AVKeyValues | null> | null; };

export type AVBlockCollectionMatch = { "collected": boolean; "content": string; "hPath": string; "id": string; "rootID": string; };

export type AVBlockCollectionPreview = { "blocks": Array<AVBlockCollectionMatch | null> | null; "hasMore": boolean; };

export type AVBlockCollectionPreviewRequestInput = { "avID": string; "page"?: number; "ruleID": string; };

export type AVBlockSourceInput = { "content"?: string | null; "id"?: string | null; "isDetached": boolean; "itemID"?: string | null; };

export type AVCalendarRange = { "end": number; "start": number; "timeZone": string; };

export type AVCalendarRangeInput = { "end": number; "start": number; "timeZone": string; };

export type AVCalendarSettings = { "colorKeyID": string; "dateKeyID": string; "displayFieldName"?: boolean; "rowLimit"?: number; "weekStart": number; };

export type AVCalendarSettingsInput = { "colorKeyID": string; "dateKeyID": string; "displayFieldName"?: boolean; "rowLimit"?: number; "weekStart": number; };

export type AVCalendarUndatedData = { "rows": Array<AVTableRow | null> | null; "total": number; };

export type AVCalendarUndatedRequestInput = { "blockID"?: string | null; "id": string; "page"?: number | null; "pageSize"?: number | null; "query"?: string | null; "search"?: string | null; "viewID": string; };

export type AVCardCoverPosition = { "image": string; "x": number; "y": number; };

export type AVCardCoverPositionInput = { "image"?: string | null; "x"?: number | null; "y"?: number | null; };

export type AVCellUpdateInput = { "itemID"?: string | null; "keyID": string; "rowID"?: string | null; "value"?: AVValueInput | null; };

export type AVCollectBlocksInput = { "blockIDs": Array<string>; "ruleID": string; };

export type AVCollectionCleanupInput = { "items": Array<AVCollectionCleanupItemInput | null>; "ruleVersion": string; };

export type AVCollectionCleanupItemInput = { "blockID": string; "itemID": string; };

export type AVCollectionReview = { "hasMore": boolean; "items": Array<AVCollectionReviewItem | null> | null; "matched": number; "ruleVersion": string; "unknown": number; "unmatched": number; };

export type AVCollectionReviewItem = { "blockID": string; "content": string; "hPath": string; "isDetached": boolean; "itemID": string; "reason"?: "invalidItem" | "detached" | "noRules" | "invalidRule" | "unavailable" | "unreadable"; "status": "matched" | "unmatched" | "unknown"; };

export type AVCollectionReviewRequestInput = { "avID": string; "page"?: number; "status"?: "" | "matched" | "unmatched" | "unknown"; };

export type AVConditionalColorRule = { "color": AVValueSelect | null; "filter": AVViewFilter | null; "id": string; "matchOption": boolean; "target": "item" | "property"; };

export type AVConditionalColorRuleInput = { "color": AVValueSelectInput | null; "filter": AVViewFilterInput | null; "id": string; "matchOption": boolean; "target": "item" | "property"; };

export type AVContextFilterData = { "contextFilter": AVAttributeViewContextFilter | null; };

export type AVCreateAttributeViewItemDocsResult = { "blockIDs": Array<string> | null; "itemIDs": Array<string> | null; "skippedItemIDs"?: Array<string>; "warnings"?: Array<string>; };

export type AVCreateAttributeViewItemResult = { "blockID": string; "content": string; "isDetached": boolean; "itemID": string; "openAfterCreate"?: boolean; "warnings"?: Array<string>; };

export type AVCreateItemDocsResult = (AVCreateAttributeViewItemDocsResult & { "unavailableNotebook"?: never; }) | (AVUnavailableNotebook & { "blockIDs"?: never; "itemIDs"?: never; "skippedItemIDs"?: never; "warnings"?: never; });

export type AVCreateItemResult = (AVCreateAttributeViewItemResult & { "unavailableNotebook"?: never; }) | (AVUnavailableNotebook & { "blockID"?: never; "content"?: never; "isDetached"?: never; "itemID"?: never; "openAfterCreate"?: never; "warnings"?: never; });

export type AVCreated = { "includeTime": boolean; };

export type AVData = { "av": AVAttributeViewData | null; };

export type AVDate = { "autoFillNow": boolean; "fillSpecificTime": boolean; };

export type AVDuplicateData = { "avID": string; "blockID": string; };

export type AVFieldCalc = { "operator": string; "result": AVValue | null; "template"?: string; };

export type AVFieldCalcInput = { "operator"?: string | null; "result"?: AVValueInput | null; "template"?: string | null; };

export type AVFieldViewsData = { "views": Array<AVAttributeViewFieldView | null> | null; };

export type AVFilterSortData = { "filters": Array<AVViewFilter | null> | null; "sorts": Array<AVViewSort | null> | null; };

export type AVGallery = { "cardAspectRatio": number; "cardAspectRatioValue": number; "cardCount": number; "cardLayout": number; "cardSize": number; "cardWidth": number; "cards": Array<AVGalleryCard | null> | null; "conditionalColors": Array<AVConditionalColorRule | null> | null; "coverFrom": number; "coverFromAssetKeyID"?: string; "desc": string; "displayEmptyFields": boolean; "displayFieldName": boolean; "fields": Array<AVGalleryField | null> | null; "filters": Array<AVViewFilter | null> | null; "fitImage": boolean; "group": AVViewGroup | null; "groupCalc"?: AVGroupCalc; "groupFolded": boolean; "groupHidden": number; "groupKey"?: AVKey; "groupValue"?: AVValue; "groups"?: Array<AVViewInstance>; "hideAttrViewName": boolean; "icon": string; "id": string; "name": string; "pageSize": number; "showIcon": boolean; "sorts": Array<AVViewSort | null> | null; "wrapField": boolean; } | ({ "cardAspectRatio": number; "cardAspectRatioValue": number; "cardCount": number; "cardLayout": number; "cardSize": number; "cardWidth": number; "cards": Array<AVGalleryCard | null> | null; "coverFrom": number; "coverFromAssetKeyID"?: string; "displayEmptyFields": boolean; "displayFieldName": boolean; "fields": Array<AVGalleryField | null> | null; "fitImage": boolean; } & { "conditionalColors"?: never; "desc"?: never; "filters"?: never; "group"?: never; "groupCalc"?: never; "groupFolded"?: never; "groupHidden"?: never; "groupKey"?: never; "groupValue"?: never; "groups"?: never; "hideAttrViewName"?: never; "icon"?: never; "id"?: never; "name"?: never; "pageSize"?: never; "showIcon"?: never; "sorts"?: never; "wrapField"?: never; });

export type AVGalleryCard = { "conditionalColors"?: AVItemConditionalColors; "coverContent": string; "coverPosition"?: AVCardCoverPosition; "coverURL": string; "id": string; "values": Array<AVGalleryFieldValue | null> | null; };

export type AVGalleryField = { "calc": AVFieldCalc | null; "created"?: AVCreated; "date"?: AVDate; "dateFormat"?: "" | "full" | "month-day-year" | "day-month-year" | "year-month-day" | "lunar"; "desc": string; "fullRow": boolean; "hidden": boolean; "icon": string; "id": string; "name": string; "numberFormat": string; "options"?: Array<AVSelectOption | null>; "relation"?: AVRelation; "renderTemplate"?: string; "rollup"?: AVRollup; "template": string; "type": "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "updated"?: AVUpdated; "wrap": boolean; } | ({ "fullRow": boolean; } & { "calc"?: never; "created"?: never; "date"?: never; "dateFormat"?: never; "desc"?: never; "hidden"?: never; "icon"?: never; "id"?: never; "name"?: never; "numberFormat"?: never; "options"?: never; "relation"?: never; "renderTemplate"?: never; "rollup"?: never; "template"?: never; "type"?: never; "updated"?: never; "wrap"?: never; });

export type AVGalleryFieldValue = { "id": string; "value": AVValue | null; "valueType": "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; } | (Record<string, never> & { "id"?: never; "value"?: never; "valueType"?: never; });

export type AVGroupCalc = { "calc": AVFieldCalc | null; "field": string; };

export type AVGroupPagingInput = { "page"?: number | null; "pageSize"?: number | null; };

export type AVGroupRange = { "numEnd": number; "numStart": number; "numStep": number; };

export type AVGroupRangeInput = { "numEnd"?: number | null; "numStart"?: number | null; "numStep"?: number | null; };

export type AVIDData = { "id": string; };

export type AVItemConditionalColors = { "background"?: AVValueSelect; "properties"?: Record<string, AVValueSelect | null>; };

export type AVKanban = { "cardAspectRatio": number; "cardAspectRatioValue": number; "cardCount": number; "cardLayout": number; "cardSize": number; "cardWidth": number; "cards": Array<AVKanbanCard | null> | null; "conditionalColors": Array<AVConditionalColorRule | null> | null; "coverFrom": number; "coverFromAssetKeyID"?: string; "desc": string; "displayEmptyFields": boolean; "displayFieldName": boolean; "fields": Array<AVKanbanField | null> | null; "fillColBackgroundColor": boolean; "filters": Array<AVViewFilter | null> | null; "fitImage": boolean; "group": AVViewGroup | null; "groupCalc"?: AVGroupCalc; "groupFolded": boolean; "groupHidden": number; "groupKey"?: AVKey; "groupValue"?: AVValue; "groups"?: Array<AVViewInstance>; "hideAttrViewName": boolean; "icon": string; "id": string; "name": string; "pageSize": number; "showIcon": boolean; "sorts": Array<AVViewSort | null> | null; "wrapField": boolean; } | ({ "cardAspectRatio": number; "cardAspectRatioValue": number; "cardCount": number; "cardLayout": number; "cardSize": number; "cardWidth": number; "cards": Array<AVKanbanCard | null> | null; "coverFrom": number; "coverFromAssetKeyID"?: string; "displayEmptyFields": boolean; "displayFieldName": boolean; "fields": Array<AVKanbanField | null> | null; "fillColBackgroundColor": boolean; "fitImage": boolean; } & { "conditionalColors"?: never; "desc"?: never; "filters"?: never; "group"?: never; "groupCalc"?: never; "groupFolded"?: never; "groupHidden"?: never; "groupKey"?: never; "groupValue"?: never; "groups"?: never; "hideAttrViewName"?: never; "icon"?: never; "id"?: never; "name"?: never; "pageSize"?: never; "showIcon"?: never; "sorts"?: never; "wrapField"?: never; });

export type AVKanbanCard = { "conditionalColors"?: AVItemConditionalColors; "coverContent": string; "coverPosition"?: AVCardCoverPosition; "coverURL": string; "id": string; "values": Array<AVKanbanFieldValue | null> | null; };

export type AVKanbanField = { "calc": AVFieldCalc | null; "created"?: AVCreated; "date"?: AVDate; "dateFormat"?: "" | "full" | "month-day-year" | "day-month-year" | "year-month-day" | "lunar"; "desc": string; "fullRow": boolean; "hidden": boolean; "icon": string; "id": string; "name": string; "numberFormat": string; "options"?: Array<AVSelectOption | null>; "relation"?: AVRelation; "renderTemplate"?: string; "rollup"?: AVRollup; "template": string; "type": "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "updated"?: AVUpdated; "wrap": boolean; } | ({ "fullRow": boolean; } & { "calc"?: never; "created"?: never; "date"?: never; "dateFormat"?: never; "desc"?: never; "hidden"?: never; "icon"?: never; "id"?: never; "name"?: never; "numberFormat"?: never; "options"?: never; "relation"?: never; "renderTemplate"?: never; "rollup"?: never; "template"?: never; "type"?: never; "updated"?: never; "wrap"?: never; });

export type AVKanbanFieldValue = { "id": string; "value": AVValue | null; "valueType": "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; } | (Record<string, never> & { "id"?: never; "value"?: never; "valueType"?: never; });

export type AVKey = { "attributePanelVisibility"?: "" | "always" | "hide-empty" | "hide"; "created"?: AVCreated; "date"?: AVDate; "dateFormat"?: "" | "full" | "month-day-year" | "day-month-year" | "year-month-day" | "lunar"; "desc": string; "icon": string; "id": string; "name": string; "numberFormat": string; "options"?: Array<AVSelectOption | null>; "relation"?: AVRelation; "renderTemplate"?: string; "rollup"?: AVRollup; "template": string; "type": "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "updated"?: AVUpdated; };

export type AVKeyValues = { "key": AVKey | null; "values"?: Array<AVValue | null>; };

export type AVKeysData = { "keys": Array<AVKey | null> | null; };

export type AVLayoutCalendar = { "columns": Array<AVViewTableColumn | null> | null; "id": string; "rowIds"?: Array<string>; "settings": AVCalendarSettings; "showIcon": boolean; "spec": number; "wrapField": boolean; } | ({ "columns": Array<AVViewTableColumn | null> | null; "rowIds"?: Array<string>; "settings": AVCalendarSettings; } & { "id"?: never; "showIcon"?: never; "spec"?: never; "wrapField"?: never; });

export type AVLayoutGallery = { "cardAspectRatio": number; "cardAspectRatioValue": number; "cardLayout": number; "cardSize": number; "cardWidth": number; "coverFrom": number; "coverFromAssetKeyID"?: string; "displayEmptyFields": boolean; "displayFieldName": boolean; "fields": Array<AVViewGalleryCardField | null> | null; "fitImage": boolean; "id": string; "showIcon": boolean; "spec": number; "wrapField": boolean; } | ({ "cardAspectRatio": number; "cardAspectRatioValue": number; "cardLayout": number; "cardSize": number; "cardWidth": number; "coverFrom": number; "coverFromAssetKeyID"?: string; "displayEmptyFields": boolean; "displayFieldName": boolean; "fields": Array<AVViewGalleryCardField | null> | null; "fitImage": boolean; } & { "id"?: never; "showIcon"?: never; "spec"?: never; "wrapField"?: never; });

export type AVLayoutKanban = { "cardAspectRatio": number; "cardAspectRatioValue": number; "cardLayout": number; "cardSize": number; "cardWidth": number; "coverFrom": number; "coverFromAssetKeyID"?: string; "displayEmptyFields": boolean; "displayFieldName": boolean; "fields": Array<AVViewKanbanField | null> | null; "fillColBackgroundColor": boolean; "fitImage": boolean; "id": string; "showIcon": boolean; "spec": number; "wrapField": boolean; } | ({ "cardAspectRatio": number; "cardAspectRatioValue": number; "cardLayout": number; "cardSize": number; "cardWidth": number; "coverFrom": number; "coverFromAssetKeyID"?: string; "displayEmptyFields": boolean; "displayFieldName": boolean; "fields": Array<AVViewKanbanField | null> | null; "fillColBackgroundColor": boolean; "fitImage": boolean; } & { "id"?: never; "showIcon"?: never; "spec"?: never; "wrapField"?: never; });

export type AVLayoutTable = { "columns": Array<AVViewTableColumn | null> | null; "id": string; "showIcon": boolean; "spec": number; "wrapField": boolean; } | ({ "columns": Array<AVViewTableColumn | null> | null; } & { "id"?: never; "showIcon"?: never; "spec"?: never; "wrapField"?: never; });

export type AVNewItemFieldValue = { "mode": "static" | "currentTime"; "value"?: AVValue; };

export type AVNewItemFieldValueInput = { "mode"?: "static" | "currentTime"; "value"?: AVValueInput | null; };

export type AVNewItemSaveLocation = { "boxID"?: string; "pathTemplate": string; };

export type AVNewItemSaveLocationInput = { "boxID"?: string | null; "pathTemplate"?: string | null; };

export type AVNewItemTemplate = { "contentTemplatePath"?: string; "fieldValues"?: Record<string, AVNewItemFieldValue | null>; "hideInFileTree"?: boolean; "icon"?: string; "id": string; "name": string; "openAfterCreate"?: boolean; "primaryKeyTemplate"?: string; "saveLocation"?: AVNewItemSaveLocation; "targetType": "detached" | "document"; };

export type AVNewItemTemplateInput = { "contentTemplatePath"?: string | null; "fieldValues"?: Record<string, AVNewItemFieldValueInput | null> | null; "hideInFileTree"?: boolean | null; "icon"?: string | null; "id"?: string | null; "name"?: string | null; "openAfterCreate"?: boolean | null; "primaryKeyTemplate"?: string | null; "saveLocation"?: AVNewItemSaveLocationInput | null; "targetType"?: "detached" | "document"; };

export type AVPasteRowsData = { "inferableKeyIDs": Array<string> | null; "view": AVTable | null; };

export type AVPathsData = { "paths": Array<string> | null; };

export type AVPrimaryValuesData = { "blockIDs": Array<string> | null; "name": string; "rows": AVKeyValues | null; "total": number; };

export type AVRelation = { "avID": string; "backKeyID": string; "candidateFilters"?: Array<AVViewFilter | null>; "isTwoWay": boolean; };

export type AVRelationCandidateSortInput = { "column": string; "order": string; };

export type AVRelationCandidatesData = { "blockIDs": Array<string> | null; "columns": Array<AVTableColumn | null> | null; "customColors": Array<AVAttributeViewCustomColor | null> | null; "name": string; "newItemPreview"?: AVRelationItemPreview; "notebookID": string; "rows": Array<AVTableRow | null> | null; "selectedRows": Array<AVTableRow | null> | null; "total": number; };

export type AVRelationItemCellInput = { "itemID": string; "relatedItemIDs": Array<string>; };

export type AVRelationItemPreview = { "createdAt": number; "error"?: string; "hasPrimaryKeyTemplate"?: boolean; "inputPrimaryKey": string; "primaryKey": string; "templateID": string; };

export type AVRelationItemPreviewInput = { "createdAt": number; "error"?: string | null; "hasPrimaryKeyTemplate"?: boolean | null; "inputPrimaryKey"?: string | null; "primaryKey": string; "templateID": string; };

export type AVRelativeDate = { "count": number; "direction": number; "unit": number; };

export type AVRelativeDateInput = { "count"?: number | null; "direction"?: number | null; "unit"?: number | null; };

export type AVRenderData = { "colorOrder": Array<string> | null; "contextFilter": AVAttributeViewContextFilter | null; "contextFilterFields": Array<AVAttributeViewContextFilterField | null> | null; "customColors": Array<AVAttributeViewCustomColor | null> | null; "defaultTemplateID": string; "id": string; "isMirror": boolean; "name": string; "newItemTemplates": Array<AVNewItemTemplate | null> | null; "target"?: AVAttributeViewRenderTarget; "usedCustomColorIndexes": Array<number> | null; "view": AVViewInstance; "viewID": string; "viewType": "table" | "list" | "gallery" | "kanban" | "calendar"; "views": Array<AVViewData | null> | null; };

export type AVRenderResult = (AVRenderData & { "error"?: never; }) | (AVViewNotFound & { "colorOrder"?: never; "contextFilter"?: never; "contextFilterFields"?: never; "customColors"?: never; "defaultTemplateID"?: never; "id"?: never; "isMirror"?: never; "name"?: never; "newItemTemplates"?: never; "target"?: never; "usedCustomColorIndexes"?: never; "view"?: never; "viewID"?: never; "viewType"?: never; "views"?: never; });

export type AVRollup = { "calc": AVRollupCalc | null; "filters"?: Array<AVViewFilter | null>; "keyID": string; "relationKeyID": string; };

export type AVRollupCalc = { "operator": string; "result": AVValue | null; };

export type AVRollupCalcInput = { "operator"?: string | null; "result"?: AVValueInput | null; };

export type AVRowOrder = { "groups": Record<string, Array<string> | null> | null; "itemIDs": Array<string> | null; "sorts": Array<AVViewSort | null> | null; };

export type AVRowOrderChange = { "expected": AVRowOrder | null; "rowOrder": AVRowOrder | null; "validateGroup"?: string; };

export type AVRowOrderChangeInput = { "expected": AVRowOrderInput | null; "rowOrder": AVRowOrderInput | null; "validateGroup": string | null; };

export type AVRowOrderInput = { "groups": Record<string, Array<string> | null>; "itemIDs": Array<string>; "sorts": Array<AVViewSortInput | null>; };

export type AVRowSortOperation = { "action": "sortAttrViewRow"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "context": Record<string, string> | null; "data": AVRowOrderChange | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": null; "targetGroupID": string; "type": ""; "viewID": string; "viewIDs"?: Array<string>; };

export type AVRowSortPreview = { "conflict": boolean; "doOperations": Array<AVRowSortOperation | null> | null; "undoOperations": Array<AVRowSortOperation | null> | null; };

export type AVSearchData = { "results": Array<AVAvSearchResult | null> | null; };

export type AVSelectOption = { "color": string; "desc": string; "name": string; "resolvedColor"?: AVAttributeViewColor; };

export type AVSelectOptionInput = { "color"?: string | null; "desc"?: string | null; "name"?: string | null; "resolvedColor"?: AVAttributeViewColorInput | null; };

export type AVTable = { "calendar"?: AVCalendarSettings; "calendarRange"?: AVCalendarRange; "calendarTargetDate"?: number; "columns": Array<AVTableColumn | null> | null; "conditionalColors": Array<AVConditionalColorRule | null> | null; "desc": string; "filters": Array<AVViewFilter | null> | null; "group": AVViewGroup | null; "groupCalc"?: AVGroupCalc; "groupFolded": boolean; "groupHidden": number; "groupKey"?: AVKey; "groupValue"?: AVValue; "groups"?: Array<AVViewInstance>; "hideAttrViewName": boolean; "icon": string; "id": string; "name": string; "pageSize": number; "rowCount": number; "rows": Array<AVTableRow | null> | null; "showIcon": boolean; "sorts": Array<AVViewSort | null> | null; "wrapField": boolean; } | ({ "calendar"?: AVCalendarSettings; "calendarRange"?: AVCalendarRange; "calendarTargetDate"?: number; "columns": Array<AVTableColumn | null> | null; "rowCount": number; "rows": Array<AVTableRow | null> | null; } & { "conditionalColors"?: never; "desc"?: never; "filters"?: never; "group"?: never; "groupCalc"?: never; "groupFolded"?: never; "groupHidden"?: never; "groupKey"?: never; "groupValue"?: never; "groups"?: never; "hideAttrViewName"?: never; "icon"?: never; "id"?: never; "name"?: never; "pageSize"?: never; "showIcon"?: never; "sorts"?: never; "wrapField"?: never; });

export type AVTableCell = { "bgColor": string; "color": string; "id": string; "value": AVValue | null; "valueType": "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; } | ({ "bgColor": string; "color": string; } & { "id"?: never; "value"?: never; "valueType"?: never; });

export type AVTableColumn = { "align": "" | "left" | "center" | "right"; "calc": AVFieldCalc | null; "created"?: AVCreated; "date"?: AVDate; "dateFormat"?: "" | "full" | "month-day-year" | "day-month-year" | "year-month-day" | "lunar"; "desc": string; "hidden": boolean; "icon": string; "id": string; "name": string; "numberFormat": string; "options"?: Array<AVSelectOption | null>; "pin": boolean; "relation"?: AVRelation; "renderTemplate"?: string; "rollup"?: AVRollup; "template": string; "type": "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "updated"?: AVUpdated; "width": string; "wrap": boolean; } | ({ "align": "" | "left" | "center" | "right"; "pin": boolean; "width": string; } & { "calc"?: never; "created"?: never; "date"?: never; "dateFormat"?: never; "desc"?: never; "hidden"?: never; "icon"?: never; "id"?: never; "name"?: never; "numberFormat"?: never; "options"?: never; "relation"?: never; "renderTemplate"?: never; "rollup"?: never; "template"?: never; "type"?: never; "updated"?: never; "wrap"?: never; });

export type AVTableRow = { "cells": Array<AVTableCell | null> | null; "conditionalColors"?: AVItemConditionalColors; "id": string; };

export type AVUnavailableNotebook = { "unavailableNotebook": true; };

export type AVUpdated = { "includeTime": boolean; };

export type AVValue = { "block"?: AVValueBlock; "blockID"?: string; "checkbox"?: AVValueCheckbox; "created"?: AVValueCreated; "createdAt"?: number; "date"?: AVValueDate; "email"?: AVValueEmail; "hasRenderTemplate"?: boolean; "id"?: string; "isDetached"?: boolean; "keyID"?: string; "location"?: AVValueLocation; "mAsset"?: Array<AVValueAsset | null>; "mSelect"?: Array<AVValueSelect | null>; "number"?: AVValueNumber; "phone"?: AVValuePhone; "relation"?: AVValueRelation; "renderedContent"?: string; "rollup"?: AVValueRollup; "template"?: AVValueTemplate; "text"?: AVValueText; "type"?: "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "updated"?: AVValueUpdated; "updatedAt"?: number; "url"?: AVValueURL; };

export type AVValueAsset = { "content": string; "name": string; "type": "file" | "image"; };

export type AVValueAssetInput = { "content"?: string | null; "name"?: string | null; "type"?: "file" | "image"; };

export type AVValueBlock = { "collectionRuleID"?: string; "content": string; "created"?: number; "icon"?: string; "id"?: string; "refSubtype"?: "s" | "d"; "updated"?: number; };

export type AVValueBlockInput = { "collectionRuleID"?: string; "content"?: string | null; "created"?: number | null; "icon"?: string | null; "id"?: string | null; "refSubtype"?: "s" | "d"; "updated"?: number | null; };

export type AVValueCheckbox = { "checked": boolean; };

export type AVValueCheckboxInput = { "checked"?: boolean | null; };

export type AVValueCreated = { "content": number; "content2": number; "formattedContent": string; "isNotEmpty": boolean; "isNotEmpty2": boolean; };

export type AVValueCreatedInput = { "content"?: number | null; "content2"?: number | null; "formattedContent"?: string | null; "isNotEmpty"?: boolean | null; "isNotEmpty2"?: boolean | null; };

export type AVValueData = { "value": AVValue | null; };

export type AVValueDate = { "content": number; "content2": number; "formattedContent": string; "hasEndDate": boolean; "isNotEmpty": boolean; "isNotEmpty2": boolean; "isNotTime": boolean; };

export type AVValueDateInput = { "content"?: number | null; "content2"?: number | null; "formattedContent"?: string | null; "hasEndDate"?: boolean | null; "isNotEmpty"?: boolean | null; "isNotEmpty2"?: boolean | null; "isNotTime"?: boolean | null; };

export type AVValueEmail = { "content": string; };

export type AVValueEmailInput = { "content"?: string | null; };

export type AVValueInput = { "block"?: AVValueBlockInput | null; "blockID"?: string | null; "checkbox"?: AVValueCheckboxInput | null; "created"?: AVValueCreatedInput | null; "createdAt"?: number | null; "date"?: AVValueDateInput | null; "email"?: AVValueEmailInput | null; "hasRenderTemplate"?: boolean | null; "id"?: string | null; "isDetached"?: boolean | null; "keyID"?: string | null; "location"?: AVValueLocationInput | null; "mAsset"?: Array<AVValueAssetInput | null> | null; "mSelect"?: Array<AVValueSelectInput | null> | null; "number"?: AVValueNumberInput | null; "phone"?: AVValuePhoneInput | null; "relation"?: AVValueRelationInput | null; "renderedContent"?: string | null; "rollup"?: AVValueRollupInput | null; "template"?: AVValueTemplateInput | null; "text"?: AVValueTextInput | null; "type"?: "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "updated"?: AVValueUpdatedInput | null; "updatedAt"?: number | null; "url"?: AVValueURLInput | null; };

export type AVValueLocation = { "latitude"?: number; "longitude"?: number; "name"?: string; "originalInput"?: string; };

export type AVValueLocationInput = { "latitude"?: number | null; "longitude"?: number | null; "name"?: string | null; "originalInput"?: string | null; };

export type AVValueNumber = { "content": number; "format": string; "formattedContent": string; "isNotEmpty": boolean; };

export type AVValueNumberInput = { "content"?: number | null; "format"?: string | null; "formattedContent"?: string | null; "isNotEmpty"?: boolean | null; };

export type AVValuePhone = { "content": string; };

export type AVValuePhoneInput = { "content"?: string | null; };

export type AVValueRelation = { "blockIDs": Array<string> | null; "contents": Array<AVValue | null> | null; };

export type AVValueRelationInput = { "blockIDs"?: Array<string> | null; "contents"?: Array<AVValueInput | null> | null; };

export type AVValueRollup = { "contents": Array<AVValue | null> | null; };

export type AVValueRollupInput = { "contents"?: Array<AVValueInput | null> | null; };

export type AVValueSelect = { "color": string; "content": string; "resolvedColor"?: AVAttributeViewColor; };

export type AVValueSelectInput = { "color"?: string | null; "content"?: string | null; "resolvedColor"?: AVAttributeViewColorInput | null; };

export type AVValueTemplate = { "content": string; };

export type AVValueTemplateInput = { "content"?: string | null; };

export type AVValueText = { "content": string; "rich"?: AVValueTextRich; };

export type AVValueTextInput = { "content"?: string | null; "rich"?: AVValueTextRichInput | null; };

export type AVValueTextRich = { "content": string; "format": "kramdown"; "spec": 1; };

export type AVValueTextRichInput = { "content"?: string | null; "format"?: "kramdown"; "spec"?: 1; };

export type AVValueURL = { "content": string; };

export type AVValueURLInput = { "content"?: string | null; };

export type AVValueUpdated = { "content": number; "content2": number; "formattedContent": string; "isNotEmpty": boolean; "isNotEmpty2": boolean; };

export type AVValueUpdatedInput = { "content"?: number | null; "content2"?: number | null; "formattedContent"?: string | null; "isNotEmpty"?: boolean | null; "isNotEmpty2"?: boolean | null; };

export type AVValuesData = { "values": Record<string, AVValue | null> | null; };

export type AVView = { "calendar"?: AVLayoutCalendar; "conditionalColors": Array<AVConditionalColorRule | null> | null; "desc": string; "filters"?: Array<AVViewFilter | null>; "gallery"?: AVLayoutGallery; "group"?: AVViewGroup; "groupCalc"?: AVGroupCalc; "groupCreated": number; "groupFolded": boolean; "groupHidden": number; "groupItemIds": Array<string> | null; "groupKey"?: AVKey; "groupSort": number; "groupVal"?: AVValue; "groups"?: Array<AVView | null>; "hideAttrViewName": boolean; "icon": string; "id": string; "itemIds"?: Array<string>; "kanban"?: AVLayoutKanban; "list"?: AVLayoutTable; "name": string; "pageSize": number; "sorts"?: Array<AVViewSort | null>; "table"?: AVLayoutTable; "type": "table" | "list" | "gallery" | "kanban" | "calendar"; };

export type AVViewData = { "desc": string; "hideAttrViewName": boolean; "icon": string; "id": string; "name": string; "pageSize": number; "type": "table" | "list" | "gallery" | "kanban" | "calendar"; };

export type AVViewFilter = { "column": string; "combination"?: "and" | "or"; "dateEndpoint"?: "start" | "end"; "filters"?: Array<AVViewFilter | null>; "operator": "" | "=" | "!=" | "\u003e" | "\u003e=" | "\u003c" | "\u003c=" | "Contains" | "Does not contains" | "Contains any item" | "Does not contain any item" | "Is empty" | "Is not empty" | "Starts with" | "Ends with" | "Is between" | "Is true" | "Is false"; "quantifier"?: string; "relativeDate"?: AVRelativeDate; "relativeDate2"?: AVRelativeDate; "value": AVValue | null; "valueSource"?: "stored" | "rendered"; };

export type AVViewFilterInput = { "column"?: string | null; "combination"?: "and" | "or"; "dateEndpoint"?: "start" | "end"; "filters"?: Array<AVViewFilterInput | null> | null; "operator"?: "" | "=" | "!=" | "\u003e" | "\u003e=" | "\u003c" | "\u003c=" | "Contains" | "Does not contains" | "Contains any item" | "Does not contain any item" | "Is empty" | "Is not empty" | "Starts with" | "Ends with" | "Is between" | "Is true" | "Is false"; "quantifier"?: string | null; "relativeDate"?: AVRelativeDateInput | null; "relativeDate2"?: AVRelativeDateInput | null; "value"?: AVValueInput | null; "valueSource"?: "stored" | "rendered"; };

export type AVViewGalleryCardField = { "calc"?: AVFieldCalc; "desc"?: string; "fullRow": boolean; "hidden": boolean; "id": string; "wrap": boolean; } | ({ "fullRow": boolean; } & { "calc"?: never; "desc"?: never; "hidden"?: never; "id"?: never; "wrap"?: never; });

export type AVViewGroup = { "field": string; "hideEmpty": boolean; "method": number; "order": number; "range"?: AVGroupRange; "valueSource"?: "stored" | "rendered"; };

export type AVViewGroupInput = { "field"?: string | null; "hideEmpty"?: boolean | null; "method"?: number | null; "order"?: number | null; "range"?: AVGroupRangeInput | null; "valueSource"?: "stored" | "rendered"; };

export type AVViewInstance = AVTable | AVGallery | AVKanban;

export type AVViewKanbanField = { "calc"?: AVFieldCalc; "desc"?: string; "fullRow": boolean; "hidden": boolean; "id": string; "wrap": boolean; } | ({ "fullRow": boolean; } & { "calc"?: never; "desc"?: never; "hidden"?: never; "id"?: never; "wrap"?: never; });

export type AVViewNotFound = { "error": "viewNotFound"; };

export type AVViewSort = { "column": string; "dateEndpoint"?: "start" | "end"; "order": "" | "ASC" | "DESC"; "valueSource"?: "stored" | "rendered"; };

export type AVViewSortInput = { "column"?: string | null; "dateEndpoint"?: "start" | "end"; "order"?: "" | "ASC" | "DESC"; "valueSource"?: "stored" | "rendered"; };

export type AVViewTableColumn = { "align"?: "" | "left" | "center" | "right"; "calc"?: AVFieldCalc; "desc"?: string; "hidden": boolean; "id": string; "pin": boolean; "width": string; "wrap": boolean; } | ({ "align"?: "" | "left" | "center" | "right"; "calc"?: AVFieldCalc; "pin": boolean; "width": string; } & { "desc"?: never; "hidden"?: never; "id"?: never; "wrap"?: never; });

export type AccountLoginData = { "needCaptcha": string | null; "token": string | null; "userName": string | null; };

export type AccountLoginRequestInput = { "captcha": string; "cloudRegion": number; "userName": string; "userPassword": string; };

export type ActivationCodeRequestInput = { "data": string; };

export type AddAttributeViewBlocksRequestInput = { "avID": string; "blockID"?: string | null; "groupID"?: string | null; "ignoreDefaultFill"?: boolean | null; "previousID"?: string | null; "srcs": Array<AVBlockSourceInput>; "viewID"?: string | null; };

export type AddAttributeViewKeyRequestInput = { "avID": string; "blockID"?: string | null; "keyID": string; "keyIcon": string; "keyName": string; "keyType": string; "previousKeyID": string; };

export type AppendAttributeViewDetachedBlocksWithValuesRequestInput = { "avID": string; "blocksValues": Array<Array<AVValueInput | null> | null>; };

export type AppendBlockRequestInput = { "data": string; "dataType": string; "parentID": string; };

export type AppendHeadingChildrenRequestInput = { "childrenDOM": string; "id": string; };

export type AssetAnnotationData = { "data": string; };

export type AssetCloudUploadRequestInput = { "id": string; "ignorePushMsg"?: boolean | null; };

export type AssetContent = { "content": string; "ext": string; "hSize": string; "id": string; "name": string; "path": string; "size": number; "updated": number; };

export type AssetContentData = { "assetContent": AssetContent | null; };

export type AssetContentRequestInput = { "id": string; "query": string; "queryMethod": number; };

export type AssetDocumentAssetsRequestInput = { "id": string; "retainQueryStr"?: boolean | null; };

export type AssetDocumentRequestInput = { "id": string; };

export type AssetInsertCoverData = { "succFiles": Array<AssetUploadSuccess> | null; "succMap": Record<string, string> | null; };

export type AssetOCRData = { "ocrJSON": Array<Record<string, string> | null> | null; "text": string; };

export type AssetOCRTextRequestInput = { "path"?: string | null; };

export type AssetPathData = { "path": string; };

export type AssetPathRequestInput = { "path": string; };

export type AssetPathsCloudUploadRequestInput = { "ignorePushMsg"?: boolean | null; "paths": Array<string>; };

export type AssetPathsData = { "paths": Array<string> | null; };

export type AssetReference = { "avID": string; "blockID": string; "notebook": string; "oldPath"?: string; "path": string; "reason": string; "reference": string; "relinkable": boolean; "replacement": string; "rootID": string; "type": string; "valueID": string; };

export type AssetReferencesData = { "dryRun": boolean; "historyPath": string; "items"?: Array<AssetRelinkItemResult>; "references": Array<AssetReference> | null; "skippedNotebooks": Array<string> | null; "unavailableAttributeViews"?: Array<UnavailableAssetAttributeView>; "updated": number; };

export type AssetRelinkItemResult = { "newPath": string; "ok": boolean; "oldPath": string; "reason": string; "references": Array<AssetReference> | null; "updated": number; };

export type AssetRelinkMappingInput = { "newPath": string; "oldPath": string; };

export type AssetRenameData = { "newPath": string; };

export type AssetStatData = { "created": number; "downloaded"?: false; "hCreated": string; "hSize": string; "hUpdated": string; "size": number; "updated": number; };

export type AssetTextData = { "text": string; };

export type AssetUnusedItem = { "blockIDs"?: Array<string>; "item": string; "name": string; "path"?: string; };

export type AssetUploadData = { "errFiles": Array<string> | null; "failedFiles": Array<AssetUploadFailure> | null; "succFiles": Array<AssetUploadSuccess> | null; "succMap": Record<string, string> | null; };

export type AssetUploadFailure = { "error": string; "index": number; "name": string; };

export type AssetUploadSuccess = { "index": number; "name": string; "path": string; };

export type AttributeViewColorTheme = { "backgroundColor": string; "color": string; };

export type AttributeViewColorThemeInput = { "backgroundColor"?: string | null; "color"?: string | null; };

export type AttributeViewCustomColor = { "dark": AttributeViewColorTheme; "hidden"?: boolean; "index": number; "light": AttributeViewColorTheme; };

export type AttributeViewCustomColorInput = { "dark"?: AttributeViewColorThemeInput | null; "hidden"?: boolean | null; "index"?: number | null; "light"?: AttributeViewColorThemeInput | null; };

export type AutoLaunchRequestInput = { "autoLaunch": number; };

export type BacklinkAttributeViewMatch = { "defIDs": Array<string> | null; "itemID": string; "keyID": string; "keyName": string; "title": string; "valueID": string; };

export type BacklinkAttributeViewTarget = { "blockID": string; "matches": Array<BacklinkAttributeViewMatch | null> | null; };

export type BacklinkContext = { "attributeViewTargets"?: Array<BacklinkAttributeViewTarget | null>; "blockPaths": Array<BlockPath | null> | null; "dom": string; "expand": boolean; "id": string; "referenceBlockID"?: string; "revision": string; "type"?: string; };

export type BacklinkContextData = { "backlinks": Array<BacklinkContext | null> | null; "backmentions": Array<BacklinkContext | null> | null; "keywords": Array<string> | null; "revision": string; "unchanged": boolean; };

export type BacklinkDatabase = { "id": string; "keys": Array<AVKey | null> | null; "name": string; };

export type BacklinkDatabaseFilterInput = { "avID": string; "filters": Array<AVViewFilterInput | null>; };

export type BacklinkDatabasesRequestInput = { "containChildren"?: boolean | null; "id": string; "keyword"?: string; "notebook"?: string; "sourceFilter"?: BacklinkSourceFilterInput | null; };

export type BacklinkDocumentRequestInput = { "blockSort"?: number; "containChildren"?: boolean | null; "defID": string; "highlight"?: boolean | null; "keyword": string; "knownRevision"?: string | null; "notebook"?: string; "refTreeID": string; "sourceFilter"?: BacklinkSourceFilterInput | null; };

export type BacklinkList = { "backlinks": Array<BacklinkPath | null> | null; "backmentions": Array<BacklinkPath | null> | null; "box": string; "k": string; "linkRefsCount": number; "mentionsCount": number; "mk": string; "revision": string; "unchanged": boolean; };

export type BacklinkListRequestInput = { "containChildren"?: boolean | null; "id"?: string | null; "includeBacklinks"?: boolean | null; "includeMentions"?: boolean | null; "k"?: string; "knownRevision"?: string | null; "mSort"?: string | null; "mk"?: string; "notebook"?: string | null; "refDefCandidates"?: boolean | null; "sort"?: string | null; "sourceFilter"?: BacklinkSourceFilterInput | null; };

export type BacklinkPath = { "blocks"?: Array<SearchBlock | null>; "box": string; "children"?: Array<SearchPath | null>; "count": number; "created": string; "depth": number; "folded": boolean; "hPath": string; "id": string; "name": string; "nameIsHTML"?: boolean; "nodeType": string; "number"?: string; "revision": string; "subType": string; "type": string; "updated": string; };

export type BacklinkRefDef = { "id": string; "path": string; "text": string; };

export type BacklinkRefDefs = { "refDefs": Array<BacklinkRefDef | null> | null; };

export type BacklinkSourceFilterInput = { "dailyNote"?: string | null; "database"?: BacklinkDatabaseFilterInput | null; "excludeSelf"?: boolean | null; "excludedNotebookIDs"?: Array<string> | null; "excludedRefDefIDs"?: Array<string> | null; };

export type BackmentionDocumentRequestInput = { "containChildren"?: boolean | null; "defID": string; "highlight"?: boolean | null; "keyword": string; "knownRevision"?: string | null; "notebook"?: string; "refTreeID": string; };

export type BatchInsertBlockRequestInput = { "blocks": Array<BlockInsertInputInput>; };

export type BatchParentBlockRequestInput = { "blocks": Array<PrependBlockRequestInput>; };

export type BatchReplaceAttributeViewBlocksRequestInput = { "avID": string; "isDetached": boolean; "oldNew": Array<Record<string, string> | null>; };

export type BatchSetAttributeViewBlockAttrsRequestInput = { "avID": string; "values": Array<AVCellUpdateInput>; };

export type BatchSetBlockAttrsRequestInput = { "blockAttrs": Array<SetBlockAttrsRequestInput>; };

export type BatchTaskListMarkerRequestInput = { "items": Array<TaskListMarkerRequestInput>; };

export type BatchUpdateBlockRequestInput = { "blocks": Array<UpdateBlockRequestInput>; };

export type BatchUpdatePackageRequestInput = { "frontend": string; };

export type BazaarAppearance = { "bodyGradient": BazaarBodyGradient | null; "closeButtonBehavior": number; "codeBlockThemeDark": string; "codeBlockThemeLight": string; "compactMode": boolean; "darkThemes": Array<BazaarAppearanceTheme | null> | null; "entryVisibility": BazaarEntryVisibility | null; "globalFontFamilies": Array<BazaarEditorFont | null> | null; "hideStatusBar": boolean; "hideToolbar": boolean; "icon": string; "iconVer": string; "icons": Array<BazaarAppearanceIcon | null> | null; "lang": string; "lightThemes": Array<BazaarAppearanceTheme | null> | null; "lockScreenWallpaper": boolean; "menuMouseScroll": boolean; "mobileBars": BazaarMobileBars | null; "mode": number; "modeOS": boolean; "notifications": BazaarNotifications | null; "outlineKeepCurrentExpand": boolean; "pdfTheme": BazaarPDFTheme | null; "statusBar": BazaarStatusBar | null; "themeDark": string; "themeJS": boolean; "themeLight": string; "themeVer": string; };

export type BazaarAppearanceIcon = { "label": string; "name": string; };

export type BazaarAppearancePackagesData = { "appearance": BazaarAppearance | null; "packages": Array<BazaarPackage | null> | null; };

export type BazaarAppearanceTheme = { "frontends"?: Array<string>; "label": string; "name": string; };

export type BazaarBodyGradient = { "dark": BazaarBodyGradientColor; "light": BazaarBodyGradientColor; "mode": string; };

export type BazaarBodyGradientColor = { "color": string; "opacity": number; };

export type BazaarEditorFont = { "displayName": string; "family": string; "weight": number; };

export type BazaarEntryVisibility = { "active": string; "profiles": Array<BazaarEntryVisibilityProfile | null> | null; "version": number; };

export type BazaarEntryVisibilityProfile = { "entries": Record<string, boolean> | null; "id": string; "name": string; "orders": Record<string, Array<string> | null> | null; };

export type BazaarFunding = { "custom": Array<string> | null; "github": string; "links"?: Array<BazaarFundingLink>; "openCollective": string; "patreon": string; };

export type BazaarFundingLink = { "label": string; "url": string; };

export type BazaarLocalInstallData = { "minAppVersion"?: string; "packageName": string; "packageType": string; "updated": boolean; };

export type BazaarLocalInstallError = { "minAppVersion": string; "packageName": string; "packageType": string; "reason": "install-failed" | "package-exists" | "package-incompatible"; };

export type BazaarLocalInstallResult = (BazaarLocalInstallData & { "reason"?: never; }) | (BazaarLocalInstallError & { "updated"?: never; });

export type BazaarMobileBars = { "autoHide": boolean | null; "sidebarButtons": boolean | null; "sidebarSwipe": boolean | null; };

export type BazaarNotifications = { "browserCompatibility": boolean; "docTreeMaxList": boolean; "formatPainterTip"?: boolean; "selectAllIncompleteTip"?: boolean; "selectAllTip"?: boolean; "tagMaxList": boolean; "workspaceNotSSD": boolean; };

export type BazaarPDFTheme = { "annoColor": string; "dark": string; "light": string; };

export type BazaarPackage = { "author": string; "backends": Array<string> | null; "bazaarIncompatible"?: boolean; "bootAppearances"?: Array<string>; "choices"?: Array<BazaarPackageChoice>; "current": boolean; "deprecated"?: boolean; "deprecatedReason"?: Record<string, string>; "description": Record<string, string> | null; "disabledInPublish": boolean; "disallowInstall": boolean; "disallowUpdate": boolean; "displayName": Record<string, string> | null; "downloads": number; "enabled"?: boolean; "frontends": Array<string> | null; "funding": BazaarFunding | null; "hInstallDate": string; "hInstallSize": string; "hSize": string; "hUpdated": string; "hasStorageData"?: boolean; "icon"?: string; "iconURL": string; "installSize": number; "installTime": number; "installed": boolean; "installedIncompatible"?: boolean; "invalidReason"?: "missing-manifest" | "invalid-manifest" | "name-mismatch"; "kernels": Array<string> | null; "keywords": Array<string> | null; "minAppVersion": string; "modes"?: Array<string> | null; "name": string; "openIssues": number; "outdated": boolean; "preferredDeprecatedReason"?: string; "preferredDesc": string; "preferredFunding": string; "preferredName": string; "preferredReadme": string; "preview"?: string; "previewURL": string; "rating"?: BazaarPackageRating; "ratingAvailable": boolean; "readme": Record<string, string> | null; "repoHash": string; "repoRef"?: string; "repoURL": string; "settingsWindow"?: boolean; "size": number; "stars": number; "updateRequiredMinAppVer"?: string; "updateTime": number; "updated": string; "url": string; "userDisabledInPublish"?: boolean; "version": string; };

export type BazaarPackageChoice = { "name": string; "packageType": string; };

export type BazaarPackageDetail = { "available": BazaarPackage | null; "installed": BazaarPackage | null; };

export type BazaarPackageRating = { "average": number; "count": number; "distribution": [number, number, number, number, number]; };

export type BazaarPackageSizeData = { "hInstallSize": string; "installSize": number; };

export type BazaarPackagesData = { "packages": Array<BazaarPackage | null> | null; };

export type BazaarREADMEData = { "html": string; };

export type BazaarRatingData = { "rating"?: BazaarPackageRating; "ratingAvailable": boolean; "userRating": number; };

export type BazaarRatingError = { "errorCode": "bazaarRatingRateLimited" | "bazaarPackagePending"; };

export type BazaarRatingResult = (BazaarRatingData & { "errorCode"?: never; }) | (BazaarRatingError & { "rating"?: never; "ratingAvailable"?: never; "userRating"?: never; });

export type BazaarRatingsData = { "eligiblePackageNames": Array<string> | null; "ratings": Record<string, BazaarPackageRating | null> | null; };

export type BazaarStatusBar = { "msgDataSyncDisabled": boolean; "msgTaskAssetDatabaseIndexCommitDisabled": boolean; "msgTaskDatabaseIndexCommitDisabled": boolean; "msgTaskHistoryDatabaseIndexCommitDisabled": boolean; "msgTaskHistoryGenerateFileDisabled": boolean; "version": number; };

export type BazaarUpdatedData = { "icons": Array<BazaarPackageDetail | null> | null; "plugins": Array<BazaarPackageDetail | null> | null; "templates": Array<BazaarPackageDetail | null> | null; "themes": Array<BazaarPackageDetail | null> | null; "widgets": Array<BazaarPackageDetail | null> | null; };

export type BazaarUserRatingsData = { "eligiblePackageNames": Array<string> | null; "userRatings": Record<string, number> | null; };

export type BazaarUserRatingsResult = (BazaarUserRatingsData & { "errorCode"?: never; }) | (BazaarRatingError & { "eligiblePackageNames"?: never; "userRatings"?: never; });

export type BlockBreadcrumbChildren = { "hasMore": boolean; "items": Array<BlockPath | null> | null; };

export type BlockBreadcrumbChildrenRequestInput = { "excludeTypes"?: Array<string> | null; "id": string; "ids"?: Array<string> | null; "limit"?: number | null; "notebook"?: string | null; "offset"?: number | null; };

export type BlockBreadcrumbRequestInput = { "excludeTypes"?: Array<string> | null; "id": string; "ids"?: Array<string> | null; "notebook"?: string | null; };

export type BlockDOMData = { "dom": string; "id": string; };

export type BlockDeleteData = { "createEmptyParagraph": boolean; };

export type BlockDeleteDataInput = { "createEmptyParagraph": boolean; };

export type BlockFoldData = { "isFolded": boolean; "isRoot": boolean; };

export type BlockIDRequestInput = { "id": string; };

export type BlockIDsRequestInput = { "ids": Array<string>; };

export type BlockInfoData = (FullBlockInfo & { "publishAccessRequired"?: never; }) | (PublishedBlockInfo & { "box"?: never; "path"?: never; "rootChildID"?: never; });

export type BlockInfoRequestInput = { "id": string; "ids"?: Array<string> | null; "notebook"?: string | null; };

export type BlockInsertInputInput = { "data": string; "dataType": string; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; };

export type BlockKramdownData = { "id": string; "kramdown": string; };

export type BlockKramdownRequestInput = { "id": string; "ids"?: Array<string> | null; "mode"?: string | null; "notebook"?: string | null; };

export type BlockOperation = { "action": "update"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "context": Record<string, string> | null; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": null; "targetGroupID": string; "type": ""; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "insert"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "context": Record<string, string> | null; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": null; "targetGroupID": string; "type": ""; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "delete"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "context": Record<string, string> | null; "data": BlockDeleteDataInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": null; "targetGroupID": string; "type": ""; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "moveOutlineHeading"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "context": Record<string, string> | null; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": null; "targetGroupID": string; "type": ""; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "appendInsert"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "context": Record<string, string> | null; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": null; "targetGroupID": string; "type": ""; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "prependInsert"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "context": Record<string, string> | null; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": null; "targetGroupID": string; "type": ""; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "foldHeading"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "context": Record<string, string> | null; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": null; "targetGroupID": string; "type": ""; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "unfoldHeading"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "context": Record<string, string> | null; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": null; "targetGroupID": string; "type": ""; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrs"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "context": Record<string, string> | null; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": null; "targetGroupID": string; "type": ""; "viewID": string; "viewIDs"?: Array<string>; };

export type BlockPath = { "children": Array<BlockPath | null> | null; "documentTitle"?: string; "hasChildren"?: boolean; "id": string; "name": string; "subType": string; "type": string; };

export type BlockQueryRequestInput = { "id": string; "ids"?: Array<string> | null; "notebook"?: string | null; };

export type BlockRelevantData = { "nextID": string; "parentID": string; "previousID": string; };

export type BlockReminderRequestInput = { "id": string; "timed": string; };

export type BlockSiblingData = { "next": string; "parent": string; "previous": string; };

export type BlockStat = { "blockCount": number; "imageCount": number; "linkCount": number; "refCount": number; "runeCount": number; "wordCount": number; };

export type BlockTransaction = { "doOperations": Array<BlockOperation | null> | null; "templateDocTreePlanID"?: string; "timestamp": number; "undoOperations": Array<BlockOperation | null> | null; };

export type BlockTreeInfo = { "headingChildren"?: boolean; "id": string; "nextID": string; "nextType": string; "parentID": string; "parentType": string; "previousID": string; "previousType": string; "type": string; };

export type BlocksKramdownRequestInput = { "id"?: string | null; "ids": Array<string>; "mode"?: string | null; "notebook"?: string | null; };

export type BlocksQueryRequestInput = { "id"?: string | null; "ids": Array<string>; "notebook"?: string | null; };

export type BlocksWordCountRequestInput = { "id"?: string | null; "ids": Array<string>; "notebook"?: string | null; "reqId"?: JSONValue | null; };

export type Bookmark = { "blocks": Array<SearchBlock | null> | null; "count": number; "depth": number; "name": string; "type": string; };

export type BootProgressData = { "details": string; "progress": number; };

export type BroadcastChannel = { "count": number; "name": string; };

export type BroadcastChannelData = { "channel": BroadcastChannel | null; };

export type BroadcastChannelRequestInput = { "name": string; };

export type BroadcastChannelsData = { "channels": Array<BroadcastChannel | null>; };

export type BroadcastMessageRequestInput = { "channel": string; "message": string; };

export type BroadcastPublishData = { "results": Array<BroadcastPublishResult | null>; };

export type BroadcastPublishMessage = { "filename": string; "size": number; "type": "string" | "binary"; };

export type BroadcastPublishResult = { "channel": BroadcastChannel; "code": number; "message": BroadcastPublishMessage; "msg": string; };

export type CancelSyncCheckoutData = { "requested": boolean; };

export type CancelSyncCheckoutRequestInput = { "taskID": string; };

export type ChangeAttrViewLayoutRequestInput = { "avID": string; "blockID": string; "layoutType": string; };

export type ChangeMasterPasswordRequestInput = { "newPassword": string; "oldPassword": string; };

export type ChangeSortNotebookRequestInput = { "notebooks": Array<string>; };

export type ChatGPTAccount = { "connected": boolean; "email": string; "id": string; "name": string; "sharing": boolean; };

export type ChatGPTAccountRequestInput = { "accountID"?: string; };

export type ChatGPTLogin = { "id": string; "url": string; };

export type ChatGPTLoginRequestInput = { "id": string; };

export type ChatGPTLoginStatus = { "accountID": string; "error": string; "state": string; };

export type ChatGPTLogoutResult = { "revoked": boolean; };

export type ChatGPTTransferRequestInput = { "accountID"?: string; "data"?: string; "password": string; };

export type CheckActivationCodeRequestInput = { "data": string; };

export type CheckBlockRefRequestInput = { "deletedIDs"?: Array<string>; "exactIDs"?: Array<string>; "id"?: string | null; "ids"?: Array<string>; "notebook"?: string | null; "paths"?: Array<string>; "scope"?: string; };

export type CheckBlocksExistRequestInput = { "id"?: string | null; "ids": Array<JSONValue>; "notebook"?: string | null; };

export type CheckSnapshotData = { "changed": boolean; };

export type CheckoutRepoRequestInput = { "id": string; "sessionID"?: string | null; };

export type ChildBlock = { "content"?: string; "id": string; "markdown"?: string; "subType"?: string; "type": string; };

export type CleanupRichTextRequestInput = { "batch": string; "groups": Array<string>; };

export type ClearSyncProviderConfigData = { "enabled": boolean; "local"?: SyncLocal; "s3"?: SyncS3; "webdav"?: SyncWebDAV; };

export type ClearSyncProviderConfigRequestInput = { "provider": number; };

export type ClipboardFile = { "isDir": boolean; "name": string; "path": string; "size": number; "updated": number; };

export type ClipboardPathRequestInput = { "path": string; };

export type CloseNotebookRequestInput = { "notebook": string; };

export type CloudBackup = { "hSize": string; "saveDir": string; "size": number; "updated": string; };

export type CloudReminderRequestInput = { "content": string; "id": string; "timed": string; };

export type CloudSpaceData = { "backup": CloudBackup | null; "hAssetSize": string; "hExchangeSize": string; "hSize": string; "hTotalSize": string; "hTrafficAPIGet": string; "hTrafficAPIPut": string; "hTrafficDownloadSize": string; "hTrafficUploadSize": string; "sync": CloudSync | null; };

export type CloudSync = { "cloudName": string; "hSize": string; "saveDir": string; "size": number; "updated": string; };

export type CloudSyncDir = { "cloudName": string; "hSize": string; "saveDir": string; "size": number; "updated": string; };

export type CloudSyncDirsData = { "checkedSyncDir": string; "hSize": string; "syncDirs": Array<CloudSyncDir | null> | null; };

export type CommitDataImportRequestInput = { "id": string; "mode": "skip" | "overwrite"; "password"?: string; };

export type CommitNotebookArchiveRequestInput = { "id": string; "saved": boolean; };

export type ConfirmSettingsResetRequestInput = { "saved": boolean; "token": string; };

export type ConfirmSyncCheckoutRequestInput = { "saved": boolean; "taskID": string; "token": string; };

export type ContentWordCountRequestInput = { "content": string; "reqId"?: JSONValue | null; };

export type ContinueImportSYRequestInput = { "notebook": string; "token": string; };

export type CopyExportFileRequestInput = { "dest": string; "srcPath": string; };

export type CopyFileRequestInput = { "dest": string; "src": string; };

export type CopyFilesRequestInput = { "destDir": string; "srcs": Array<string>; };

export type CopyStdMarkdownRequestInput = { "adjustHeadingLevel"?: boolean | null; "assetsDestSpace2Underscore"?: boolean | null; "fillCSSVar"?: boolean | null; "id": string; "imgTag"?: boolean | null; };

export type CreateAssetHistoryRequestInput = { "path": string; };

export type CreateAttributeViewItemDocsRequestInput = { "app"?: string | null; "avID": string; "blockID": string; "itemIDs": Array<string> | null; "saveMode": string; "session"?: string | null; };

export type CreateAttributeViewItemRequestInput = { "app"?: string | null; "avID": string; "blockID": string; "calendarDate"?: number | null; "groupID"?: string | null; "previousID"?: string | null; "session"?: string | null; "templateID"?: string | null; "viewID"?: string | null; };

export type CreateAttributeViewItemWithMarkdownRequestInput = { "app"?: string | null; "avID": string; "blockID": string; "clippingHref"?: string | null; "groupID"?: string | null; "listDocTree"?: boolean | null; "markdown": string; "previousID"?: string | null; "session"?: string | null; "tags"?: string | null; "templateID": string; "title": string; "viewID"?: string | null; "withMath"?: boolean | null; };

export type CreateAttributeViewRelationItemRequestInput = { "app"?: string | null; "avID": string; "blockID": string; "cells": Array<AVRelationItemCellInput | null>; "keyID": string; "keyword"?: string | null; "preview": AVRelationItemPreviewInput | null; "session"?: string | null; "useInputName"?: boolean | null; };

export type CreateDocByParentRequest = { "clippingHref"?: string; "docCreateTemplatePath"?: string; "expectedParentRevision"?: string; "expectedTarget"?: DocumentTargetRevision; "id": string; "listDocTree"?: boolean; "markdown": string; "nameConditions"?: Array<DocumentNameCondition>; "notebook": string; "parentID": string | null; "sortPosition"?: "before" | "after"; "sortTargetID"?: string; "sorts"?: Array<string>; "tags"?: string; "title": DocumentCreateTitle; "withMath"?: boolean; };

export type CreateDocByParentRequestInput = { "clippingHref"?: string; "docCreateTemplatePath"?: string; "expectedParentRevision"?: string; "expectedTarget"?: DocumentTargetRevisionInput; "id": string; "listDocTree"?: boolean; "markdown": string; "nameConditions"?: Array<DocumentNameConditionInput>; "notebook": string; "parentID": string | null; "sortPosition"?: "before" | "after"; "sortTargetID"?: string; "sorts"?: Array<string>; "tags"?: string; "title": DocumentCreateTitleInput; "withMath"?: boolean; };

export type CreateDocByParentResult = (CreatedDocumentData & { "commitState"?: never; "completed"?: never; "reason"?: never; "stage"?: never; }) | (DocumentCreateFailure & { "document"?: never; });

export type CreateDocHistoryRequestInput = { "id": string; };

export type CreateEncryptedNotebookRequestInput = { "name": string; "password": string; };

export type CreateNotebookData = { "notebook": Notebook | null; };

export type CreateNotebookRequestInput = { "name": string; };

export type CreateRiffDeckRequestInput = { "name": string; };

export type CreateSnapshotData = { "created": boolean; "id": string; };

export type CreateSnapshotRequestInput = { "fullCheck"?: boolean; "memo"?: string; };

export type CreatedDocumentData = { "document": DocumentPath; "id": string; };

export type Criterion = { "group": number; "hPath": string; "hasReplace": boolean; "idPath": Array<string> | null; "k": string; "method": number; "name": string; "r": string; "replaceTypes": CriterionReplaceTypes | null; "sort": number; "subTypes": SearchSubTypes; "types": CriterionTypes | null; };

export type CriterionInput = { "group"?: number | null; "hPath"?: string | null; "hasReplace"?: boolean | null; "idPath"?: Array<string> | null; "k"?: string | null; "method"?: number | null; "name"?: string | null; "r"?: string | null; "replaceTypes"?: CriterionReplaceTypesInput | null; "sort"?: number | null; "subTypes"?: SearchSubTypesInput | null; "types"?: CriterionTypesInput | null; };

export type CriterionReplaceTypes = { "aHref": boolean; "aText": boolean; "aTitle": boolean; "blockRef": boolean; "code": boolean; "codeBlock": boolean; "docTitle": boolean; "em": boolean; "fileAnnotationRef": boolean; "htmlBlock": boolean; "imgSrc": boolean; "imgText": boolean; "imgTitle": boolean; "inlineMath": boolean; "inlineMemo": boolean; "kbd": boolean; "mark": boolean; "mathBlock": boolean; "s": boolean; "strong": boolean; "sub": boolean; "sup": boolean; "tag": boolean; "text": boolean; "u": boolean; };

export type CriterionReplaceTypesInput = { "aHref"?: boolean | null; "aText"?: boolean | null; "aTitle"?: boolean | null; "blockRef"?: boolean | null; "code"?: boolean | null; "codeBlock"?: boolean | null; "docTitle"?: boolean | null; "em"?: boolean | null; "fileAnnotationRef"?: boolean | null; "htmlBlock"?: boolean | null; "imgSrc"?: boolean | null; "imgText"?: boolean | null; "imgTitle"?: boolean | null; "inlineMath"?: boolean | null; "inlineMemo"?: boolean | null; "kbd"?: boolean | null; "mark"?: boolean | null; "mathBlock"?: boolean | null; "s"?: boolean | null; "strong"?: boolean | null; "sub"?: boolean | null; "sup"?: boolean | null; "tag"?: boolean | null; "text"?: boolean | null; "u"?: boolean | null; };

export type CriterionTypes = { "audioBlock": boolean; "blockquote": boolean; "callout": boolean; "codeBlock": boolean; "customBlock"?: boolean; "databaseBlock": boolean; "document": boolean; "embedBlock": boolean; "heading": boolean; "htmlBlock": boolean; "iframeBlock": boolean; "list": boolean; "listItem": boolean; "mathBlock": boolean; "mindmap"?: boolean; "mindmapItem"?: boolean; "paragraph": boolean; "superBlock": boolean; "tabItem": boolean; "table": boolean; "tabs": boolean; "videoBlock": boolean; "widgetBlock": boolean; };

export type CriterionTypesInput = { "audioBlock"?: boolean | null; "blockquote"?: boolean | null; "callout"?: boolean | null; "codeBlock"?: boolean | null; "customBlock"?: boolean | null; "databaseBlock"?: boolean | null; "document"?: boolean | null; "embedBlock"?: boolean | null; "heading"?: boolean | null; "htmlBlock"?: boolean | null; "iframeBlock"?: boolean | null; "list"?: boolean | null; "listItem"?: boolean | null; "mathBlock"?: boolean | null; "mindmap"?: boolean | null; "mindmapItem"?: boolean | null; "paragraph"?: boolean | null; "superBlock"?: boolean | null; "tabItem"?: boolean | null; "table"?: boolean | null; "tabs"?: boolean | null; "videoBlock"?: boolean | null; "widgetBlock"?: boolean | null; };

export type DOMData = { "dom": string; };

export type DOMTextRequestInput = { "dom": string; };

export type DailyNoteBlockRequestInput = { "data": string; "dataType": string; "notebook": string; };

export type DailyNoteInfo = { "existed": boolean; "hPath": string; "id": string; "title": string; };

export type DailyNoteInfoRequestInput = { "date"?: string | null; "notebook": string; };

export type DataImportPlan = { "conflicts": Array<string> | null; "encrypted": Array<string> | null; "id": string; };

export type DataImportRequestInput = { "id": string; };

export type DataImportResult = { "skipped": Array<string> | null; };

export type DeleteBlockRequestInput = { "id": string; };

export type DiffDocVersionsRequestInput = { "left": DocVersionRefInput; "right": DocVersionRefInput; };

export type DiffRepoSnapshotsRequestInput = { "left": string; "right": string; };

export type DirectoryEntry = { "isDir": boolean; "isSymlink": boolean; "name": string; "updated": number; };

export type DocAttrView = { "id": string; "name": string; };

export type DocHeadingLevelData = { "counts": Array<number>; "title": string; "transaction": BlockTransaction | null; "withSubheadingCounts": Array<number>; };

export type DocHeadingLevelRequestInput = { "id"?: string | null; "notebook"?: string | null; "source"?: number | null; "target"?: number | null; "withSubheadings"?: boolean | null; };

export type DocHistoryContentData = { "content": string; "id": string; "isLargeDoc": boolean; "rootID": string; };

export type DocHistoryContentRequestInput = { "highlight"?: boolean | null; "historyPath": string; "k"?: string | null; };

export type DocHistorySnapshot = { "created": number; "fileID": string; "id": string; "memo": string; "tags": Array<string> | null; };

export type DocHistorySnapshotEntry = { "created": string; "historyPath": string; "snapshots": Array<DocHistorySnapshot | null> | null; };

export type DocHistorySnapshotsData = { "histories": Array<DocHistorySnapshotEntry | null> | null; };

export type DocHistorySnapshotsRequestInput = { "created": Array<string>; "id": string; "op"?: string; };

export type DocInfo = { "attrViews": Array<DocAttrView | null> | null; "ial": Record<string, string> | null; "icon": string; "id": string; "name": string; "refCount": number; "refIDs": Array<string> | null; "rootID": string; "subFileCount": number; };

export type DocOrdersRequestInput = { "id": string; };

export type DocVersionDiffContent = { "content": string; "id": string; "rootID": string; "title": string; };

export type DocVersionDiffResult = { "differences": Array<DocVersionDifference | null> | null; "fallback": boolean; "large": boolean; "left": DocVersionDiffContent | null; "message": string; "right": DocVersionDiffContent | null; "titleModified": boolean; };

export type DocVersionDifference = { "id": string; "statuses": Array<string> | null; };

export type DocVersionRefInput = { "id"?: string | null; "path"?: string | null; "snapshot"?: string | null; "type": string; };

export type DocsInfoRequestInput = { "av": boolean; "ids": Array<string>; "refCount": boolean; };

export type DocumentAddressingFailure = { "reason": "invalidTitle" | "parentUnavailable" | "planChanged" | "documentIDConflict" | "legacyPathUnsupported" | "pathAmbiguous" | "indexUnavailable" | "unsupportedTitleFormat" | "targetModeUnsupported" | "writeFailed"; };

export type DocumentCapabilities = { "indexState": "missing" | "building" | "ready" | "error"; "literalSlash": boolean; "revision": string; "structuredPaths": boolean; "titleFormats": Array<string> | null; };

export type DocumentCreateFailure = { "commitState": "none" | "committed" | "unknown"; "completed": Array<string> | null; "id"?: string; "reason": "invalidTitle" | "parentUnavailable" | "planChanged" | "documentIDConflict" | "indexUnavailable" | "unsupportedTitleFormat" | "writeFailed"; "stage": string; };

export type DocumentCreatePlan = { "existingID"?: string; "notebook": string; "steps": Array<CreateDocByParentRequest>; "title": string; };

export type DocumentCreateTarget = (LegacyDocumentTarget & { "anchor"?: never; "onMissingParent"?: never; "parents"?: never; "title"?: never; "up"?: never; }) | (StructuredDocumentTarget & { "path"?: never; });

export type DocumentCreateTargetData = { "docCreateTemplatePath": string; "revision": string; "target": DocumentCreateTarget; };

export type DocumentCreateTitle = { "format": string; "text": string; };

export type DocumentCreateTitleInput = { "format": string; "text": string; };

export type DocumentLocation = { "id": string | null; "notebook": string; "revision": string; };

export type DocumentNameCondition = { "expectedID": string | null; "parentID": string | null; "title": string; };

export type DocumentNameConditionInput = { "expectedID": string | null; "parentID": string | null; "title": string; };

export type DocumentPath = { "depth": number; "displayPath": string; "id": string; "notebook": string; "parentID": string | null; "path": string; "revision": string; "segments": Array<DocumentPathSegment> | null; "title": DocumentTitle; };

export type DocumentPathSegment = { "empty": boolean; "id": string; "text": string; };

export type DocumentPathStartInput = { "id"?: string; "kind": "root" | "document"; };

export type DocumentPathsData = { "documents": Array<DocumentPath> | null; "missingIDs": Array<string> | null; };

export type DocumentPathsResult = (DocumentPathsData & { "reason"?: never; }) | (DocumentAddressingFailure & { "documents"?: never; "missingIDs"?: never; });

export type DocumentPreviewImage = { "notebook": string; "src": string; "video"?: string; };

export type DocumentTargetAnchor = { "id"?: string; "kind": "notebookRoot" | "context" | "document"; };

export type DocumentTargetAnchorInput = { "id"?: string; "kind": "notebookRoot" | "context" | "document"; };

export type DocumentTargetRevision = { "notebook": string; "purpose": "document" | "reference" | "dailyNote"; "revision": string; };

export type DocumentTargetRevisionInput = { "notebook": string; "purpose": "document" | "reference" | "dailyNote"; "revision": string; };

export type DocumentTitle = { "empty": boolean; "format": "plain"; "text": string; };

export type DownloadCloudSnapshotRequestInput = { "id": string; "tag": string; };

export type DownloadInstallPkgRequestInput = { "downloadInstallPkg": boolean; };

export type DuplicateAttributeViewBlockRequestInput = { "avID": string; };

export type EditorReadOnlyRequestInput = { "readonly": boolean; };

export type EmbedBlock = { "allowChildOperation": boolean; "block": SearchBlock | null; "blockPaths": Array<BlockPath | null> | null; };

export type EmbedBlocksData = { "blocks": Array<EmbedBlock | null> | null; };

export type EmbedStat = { "complete": boolean; "cycleCount": number; "depthLimitCount": number; "failedQueryCount": number; "failedResultCount": number; "jsEmbedCount": number; "queryEmbedCount": number; "resultCount": number; "truncatedQueryCount": number; };

export type EmptyRequestInput = Record<string, never>;

export type EncryptedBoxAssetsRequestInput = { "notebook": string; };

export type EncryptedNotebookFollowSystemLockRequestInput = { "enabled": boolean; };

export type EncryptedNotebookStatus = { "id": string; "name": string; "state": "Locked" | "Unlocking" | "Unlocked" | "Locking" | "Error"; "unlocked": boolean; };

export type EncryptedNotebookStatusData = { "boxes": Array<EncryptedNotebookStatus>; "count": number; "enabled": boolean; "hasHistoryDependency": boolean; "migrationBoxes": Array<string> | null; "migrationPending": boolean; "state": "Disabled" | "Enabled" | "RecoveryRequired"; };

export type ExportAsFileRequestInput = { "file": Blob; "type": string; };

export type ExportAttributeViewRequestInput = { "blockID": string; "id": string; };

export type ExportBrowserHTMLRequestInput = { "folder": string; "html": string; "name": string; };

export type ExportDocumentsMarkdownRequestInput = { "addTitle"?: boolean | null; "blockEmbedMode"?: number | null; "blockRefMode"?: number | null; "blockRefTextLeft"?: string | null; "blockRefTextRight"?: string | null; "fileAnnotationRefMode"?: number | null; "ids": Array<string>; "includeRelatedDocs"?: boolean | null; "includeSubDocs"?: boolean | null; "inlineMemo"?: boolean | null; "markdownYFM"?: boolean | null; "removeAssetsID"?: boolean | null; "tagCloseMarker"?: string | null; "tagOpenMarker"?: string | null; };

export type ExportDocxRequestInput = { "id": string; "merge"?: boolean | null; "mergeContentHeadingMode"?: string | null; "mergeDocHeadingMode"?: string | null; "removeAssets": boolean; "savePath": string; };

export type ExportFileData = { "file": string; };

export type ExportFolderRequestInput = { "folder": string; };

export type ExportHTMLData = { "content": string; "folder"?: string; "id": string; "name": string; };

export type ExportHTMLRequestInput = { "addTitle"?: boolean | null; "customTitle"?: string | null; "id": string; "keepFold"?: boolean | null; "merge"?: boolean | null; "mergeContentHeadingMode"?: string | null; "mergeDocHeadingMode"?: string | null; "pdf": boolean; "savePath"?: string | null; };

export type ExportIDRequestInput = { "id": string; };

export type ExportIDsRequestInput = { "ids": Array<string>; };

export type ExportMarkdownContentData = { "content": string; "hPath": string; };

export type ExportMarkdownContentRequestInput = { "addTitle"?: boolean | null; "adjustHeadingLevel"?: boolean | null; "embedMode"?: number | null; "fillCSSVar"?: boolean | null; "id": string; "imgTag"?: boolean | null; "preserveTaskMarkers"?: boolean | null; "refMode"?: number | null; "yfm"?: boolean | null; };

export type ExportMarkdownHTMLRequestInput = { "id": string; "savePath"?: string | null; };

export type ExportMarkdownRequestInput = { "addTitle"?: boolean | null; "blockEmbedMode"?: number | null; "blockRefMode"?: number | null; "blockRefTextLeft"?: string | null; "blockRefTextRight"?: string | null; "fileAnnotationRefMode"?: number | null; "id": string; "includeRelatedDocs"?: boolean | null; "includeSubDocs"?: boolean | null; "inlineMemo"?: boolean | null; "markdownYFM"?: boolean | null; "removeAssetsID"?: boolean | null; "tagCloseMarker"?: string | null; "tagOpenMarker"?: string | null; };

export type ExportNameData = { "name": string; };

export type ExportNamedZipData = { "name": string; "zip": string; };

export type ExportNotebookMarkdownRequestInput = { "addTitle"?: boolean | null; "blockEmbedMode"?: number | null; "blockRefMode"?: number | null; "blockRefTextLeft"?: string | null; "blockRefTextRight"?: string | null; "fileAnnotationRefMode"?: number | null; "includeRelatedDocs"?: boolean | null; "includeSubDocs"?: boolean | null; "inlineMemo"?: boolean | null; "markdownYFM"?: boolean | null; "notebook": string; "removeAssetsID"?: boolean | null; "tagCloseMarker"?: string | null; "tagOpenMarker"?: string | null; };

export type ExportNotebooksMarkdownRequestInput = { "addTitle"?: boolean | null; "blockEmbedMode"?: number | null; "blockRefMode"?: number | null; "blockRefTextLeft"?: string | null; "blockRefTextRight"?: string | null; "fileAnnotationRefMode"?: number | null; "includeRelatedDocs"?: boolean | null; "includeSubDocs"?: boolean | null; "inlineMemo"?: boolean | null; "markdownYFM"?: boolean | null; "notebooks"?: Array<string> | null; "removeAssetsID"?: boolean | null; "tagCloseMarker"?: string | null; "tagOpenMarker"?: string | null; };

export type ExportNotebooksRequestInput = { "notebooks"?: Array<string> | null; };

export type ExportPathData = { "path": string; };

export type ExportPreviewData = { "fillCSSVar": boolean; "html": string; };

export type ExportPreviewHTMLData = { "attrs": Record<string, string> | null; "content": string; "id": string; "name": string; "type": string; };

export type ExportPreviewHTMLRequestInput = { "addTitle"?: boolean | null; "customTitle"?: string | null; "excludeTitleImage"?: boolean | null; "id": string; "image"?: boolean | null; "keepFold"?: boolean | null; "keepJSEmbed"?: boolean | null; "merge"?: boolean | null; "mergeContentHeadingMode"?: string | null; "mergeDocHeadingMode"?: string | null; "pdf"?: boolean | null; };

export type ExportRepoFileRequestInput = { "id": string; };

export type ExportResourcesRequestInput = { "name"?: string | null; "paths"?: Array<string> | null; };

export type ExportTempContentRequestInput = { "content": string; "id"?: string | null; };

export type ExportURLData = { "url": string; };

export type ExportZipData = { "zip": string; };

export type ExtensionCopyData = { "md": string; "withMath": boolean; };

export type FileAnnotationRefRequestInput = { "id": string; "notebook"?: string | null; };

export type FilePathData = { "path": string; };

export type FilePathRequestInput = { "path": string; };

export type FileTreeAuthPublishRequestInput = { "id": string; "password": string; };

export type FileTreeChangeSortRequestInput = { "notebook": string; "paths": Array<string>; };

export type FileTreeCreateData = { "id": string; };

export type FileTreeCreateMarkdownRequestInput = { "clippingHref"?: string | null; "docCreateTemplatePath"?: string | null; "id"?: string | null; "listDocTree"?: boolean | null; "markdown": string; "notebook": string; "parentID"?: string | null; "path": string; "sortPosition"?: string | null; "sortTargetID"?: string | null; "tags"?: string | null; "titleEmpty"?: boolean; "withMath"?: boolean | null; };

export type FileTreeCreateRequestInput = { "docCreateTemplatePath"?: string | null; "listDocTree"?: boolean | null; "md": string; "notebook": string; "path": string; "sortPosition"?: string | null; "sortTargetID"?: string | null; "sorts"?: Array<string> | null; "title": string; };

export type FileTreeCreateSavePathData = { "box": string; "docCreateTemplatePath": string; "path": string; };

export type FileTreeCreateSavePathResult = (FileTreeCreateSavePathData & { "reason"?: never; }) | (StructuredTemplateRequired & { "box"?: never; "docCreateTemplatePath"?: never; "path"?: never; });

export type FileTreeDailyNoteRequestInput = { "app"?: string | null; "date"?: string | null; "notebook": string; };

export type FileTreeDocFile = { "children"?: Array<FileTreeDocFile | null>; "id": string; };

export type FileTreeDocHeadingData = { "srcTreeBox": string; "srcTreePath": string; };

export type FileTreeDocHeadingRequestInput = { "after": boolean; "srcID": string; "targetID": string; };

export type FileTreeDocPathData = { "notebook": string; "path": string; };

export type FileTreeDocTreeData = { "tree": Array<FileTreeDocFile | null> | null; };

export type FileTreeDuplicateData = { "hPath": string; "id": string; "notebook": string; "path": string; };

export type FileTreeFile = { "alias": string; "bookmark": string; "childrenSortMode": number | null; "count": number; "ctime": number; "dueFlashcardCount": number; "flashcardCount": number; "hCtime": string; "hMtime": string; "hSize": string; "icon": string; "id": string; "memo": string; "mtime": number; "name": string; "name1": string; "newFlashcardCount": number; "path": string; "size": number; "sort": number; "subFileCount": number; "titleEmpty"?: boolean; };

export type FileTreeGetDocData = { "blockCount": number; "box": string; "content": string; "docInfo"?: DocInfo; "eof": boolean; "headingNumbers": Record<string, string> | null; "id": string; "isBacklinkExpand": boolean; "isSyncing": boolean; "keywords": Array<string> | null; "mode": number; "parent2ID": string; "parentID": string; "path": string; "publishAccessRequired": boolean; "reqId": JSONValue; "rootID": string; "scroll": boolean; "type": string; };

export type FileTreeGetDocRequestInput = { "endID"?: string | null; "highlight"?: boolean | null; "id": string; "includeDocInfo"?: boolean | null; "index"?: number | null; "isBacklink"?: boolean | null; "mode"?: number | null; "notebook"?: string | null; "originalRefBlockIDs"?: Record<string, string> | null; "query"?: string | null; "queryMethod"?: number | null; "querySubTypes"?: SearchSubtypeFilterInput | null; "queryTypes"?: Record<string, boolean> | null; "reqId"?: JSONValue | null; "size"?: number | null; "startID"?: string | null; };

export type FileTreeHeadingDocRequestInput = { "previousPath"?: string | null; "srcHeadingID": string; "targetNoteBook": string; "targetPath"?: string | null; "toTop"?: boolean | null; };

export type FileTreeIDRequestInput = { "id": string; };

export type FileTreeListData = { "box": string; "effectiveSortMode": number; "files": Array<FileTreeFile | null> | null; "path": string; };

export type FileTreeListItemDocRequestInput = { "previousPath"?: string | null; "srcListItemID": string; "targetNoteBook": string; "targetPath"?: string | null; "toTop"?: boolean | null; };

export type FileTreeListRequestInput = { "app"?: string | null; "flashcard"?: boolean | null; "ignoreMaxListHint"?: boolean | null; "maxListCount"?: number | null; "notebook": string; "path": string; "showHidden"?: boolean | null; "sort"?: number | null; };

export type FileTreeMoveIDsRequestInput = { "callback"?: JSONValue | null; "fromIDs": Array<string>; "toID": string; };

export type FileTreeMoveRequestInput = { "callback"?: JSONValue | null; "fromPaths": Array<string>; "toNotebook": string; "toPath": string; };

export type FileTreeNotebookRequestInput = { "notebook": string; };

export type FileTreeOptionalIDRequestInput = { "id"?: string | null; };

export type FileTreeOptionalPathRequestInput = { "notebook"?: string | null; "path"?: string | null; };

export type FileTreePathRequestInput = { "notebook": string; "path": string; };

export type FileTreePathsRequestInput = { "paths": Array<string>; };

export type FileTreePublishData = { "publishAccess": Array<FileTreePublishItem | null> | null; };

export type FileTreePublishIDsRequestInput = { "ids": Array<string>; };

export type FileTreePublishItem = { "disable": boolean; "id": string; "password": string; "visible": boolean; };

export type FileTreeRenameIDRequestInput = { "id"?: string | null; "title": string; };

export type FileTreeRenameRequestInput = { "notebook": string; "path": string; "title": string; };

export type FileTreeReorderData = { "changed": boolean; "conflict"?: boolean; "notebook"?: string; "parentPath"?: string; };

export type FileTreeReorderRequestInput = { "position"?: string | null; "preview"?: boolean | null; "removeSorts"?: boolean | null; "respectSort"?: boolean | null; "sourceIDs"?: Array<string> | null; "targetID"?: string | null; };

export type FileTreeSavePathData = { "box": string; "path": string; };

export type FileTreeSavePathResult = (FileTreeSavePathData & { "reason"?: never; }) | (StructuredTemplateRequired & { "box"?: never; "path"?: never; });

export type FileTreeSearchDoc = { "alias"?: string; "box": string; "boxIcon": string; "dueFlashcardCount"?: string; "flashcardCount"?: string; "hPath": string; "name"?: string; "newFlashcardCount"?: string; "path": string; "title"?: string; };

export type FileTreeSearchRequestInput = { "excludeIDs"?: Array<string> | null; "flashcard"?: boolean | null; "k": string; };

export type FileTreeSetPublishRequestInput = { "disable": boolean; "id": string; "password": string; "visible": boolean; };

export type FileTreeSetSortData = { "docIDs": Array<string> | null; "notebookIDs": Array<string> | null; };

export type FileTreeSetSortRequestInput = { "docSorts"?: Array<FileTreeSortItemInput | null> | null; "notebookSorts"?: Array<FileTreeSortItemInput | null> | null; };

export type FileTreeSortItemInput = { "id"?: string | null; "sort"?: number | null; };

export type FileTreeSortModeData = { "box": string; "effectiveSortMode": number; "id": string; "path": string; "sortMode": number | null; };

export type FileTreeSortModeRequestInput = { "id"?: string | null; "sortMode": number | null; };

export type FileTreeTrimIDRequestInput = { "id": string; };

export type FindAssetReferencesRequestInput = { "path"?: string; "paths"?: Array<string>; };

export type FindReplaceRequestInput = { "groupBy"?: number | null; "ids": Array<string>; "k": string; "method"?: number | null; "orderBy"?: number | null; "page"?: number | null; "pageSize"?: number | null; "paths"?: Array<string> | null; "query"?: string | null; "r": string; "replaceTypes"?: Record<string, boolean> | null; "subTypes"?: SearchSubtypeFilterInput | null; "types"?: Record<string, boolean> | null; };

export type FinishLivePhotoPreviewRequestInput = { "file": Blob; "id": string; };

export type FullBlockInfo = { "box": string; "path": string; "rootChildID": string; "rootID": string; "rootIcon": string; "rootTitle": string; "rootTitleEmpty": boolean; };

export type FullTextSearchBlockData = { "blocks": Array<SearchBlock | null> | null; "docMode": boolean; "matchedBlockCount": number; "matchedRootCount": number; "pageCount": number; };

export type FullTextSearchBlockRequestInput = { "groupBy"?: number | null; "method"?: number | null; "notebook"?: string | null; "orderBy"?: number | null; "page"?: number | null; "pageSize"?: number | null; "paths"?: Array<string> | null; "query"?: string | null; "searchHPath"?: boolean | null; "subTypes"?: SearchSubtypeFilterInput | null; "types"?: Record<string, boolean> | null; };

export type GetAttributeViewAddingBlockDefaultValuesRequestInput = { "addingBlockID"?: string | null; "avID": string; "blockID"?: string | null; "groupID"?: string | null; "previousID"?: string | null; "viewID"?: string | null; };

export type GetAttributeViewBacklinksRequestInput = { "avID"?: string | null; "id"?: string | null; "itemID"?: string | null; "valueID"?: string | null; };

export type GetAttributeViewBoundBlockIDsByItemIDsRequestInput = { "avID": string; "itemIDs": Array<string>; };

export type GetAttributeViewFieldViewsRequestInput = { "avID": string; "keyID": string; };

export type GetAttributeViewFilterSortRequestInput = { "blockID": string; "id": string; };

export type GetAttributeViewItemIDsByBoundIDsRequestInput = { "avID": string; "blockIDs": Array<string>; };

export type GetAttributeViewItemStatusesRequestInput = { "blockID"?: string | null; "id": string; "itemIDs": Array<string>; "query"?: string | null; "viewID"?: string | null; };

export type GetAttributeViewKeysByAvIDRequestInput = { "avID": string; };

export type GetAttributeViewKeysByIDRequestInput = { "avID": string; "keyIDs": Array<string>; };

export type GetAttributeViewKeysRequestInput = { "avID"?: string | null; "id"?: string | null; "itemID"?: string | null; "valueID"?: string | null; };

export type GetAttributeViewPasteRowsRequestInput = { "avID": string; "blockID": string; "count": number; "groupID"?: string | null; "query"?: string | null; "startItemID": string; "viewID"?: string | null; };

export type GetAttributeViewPrimaryKeyValuesRequestInput = { "blockIDs"?: Array<string> | null; "id": string; "keyword"?: string | null; "page"?: number | null; "pageSize"?: number | null; };

export type GetAttributeViewRelationCandidatesRequestInput = { "avID"?: string | null; "blockID"?: string | null; "id"?: string | null; "includeNewItemPreview"?: boolean | null; "keyID"?: string | null; "keyword"?: string | null; "page"?: number | null; "pageSize"?: number | null; "selectedBlockIDs"?: Array<string> | null; "sort"?: AVRelationCandidateSortInput | null; };

export type GetAttributeViewRequestInput = { "id": string; };

export type GetAttributeViewRowSortRequestInput = { "avID"?: string | null; "blockID"?: string | null; "groupID"?: string | null; "itemIDs"?: Array<string> | null; "nextID"?: string | null; "previousID"?: string | null; "viewID"?: string | null; };

export type GetAttributeViewSearchTargetRequestInput = { "id"?: string | null; "keywords"?: Array<string> | null; };

export type GetBazaarIconRequestInput = { "keyword"?: string | null; };

export type GetBazaarPackageREADMERequestInput = { "packageType": string; "repoHash": string; "repoURL": string; };

export type GetBazaarPackageRatingRequestInput = { "packageName": string; "packageType": string; };

export type GetBazaarPackageRatingsRequestInput = { "packageNames": Array<string>; "packageType": string; };

export type GetBazaarPackageRequestInput = { "frontend"?: string | null; "packageName": string; "packageType": string; };

export type GetBazaarPackageUserRatingsRequestInput = { "packageNames": Array<string>; "packageType": string; };

export type GetBazaarPluginRequestInput = { "frontend": string; "keyword"?: string | null; };

export type GetBazaarTemplateRequestInput = { "keyword"?: string | null; };

export type GetBazaarThemeRequestInput = { "frontend"?: string | null; "keyword"?: string | null; };

export type GetBazaarWidgetRequestInput = { "keyword"?: string | null; };

export type GetCloudRepoSnapshotsRequestInput = { "endTime"?: number; "page": number; "startTime"?: number; };

export type GetCurrentAttrViewImagesRequestInput = { "blockID"?: string | null; "groupID"?: string | null; "id": string; "query"?: string | null; "viewID"?: string | null; };

export type GetDocCreateTargetRequestInput = { "notebook": string; "purpose": "document" | "reference" | "dailyNote"; };

export type GetDocPathsRequestInput = { "ids": Array<string>; "notebook": string; };

export type GetEmbedBlockRequestInput = { "breadcrumb"?: boolean | null; "embedBlockID": string; "headingMode"?: number | null; "includeIDs": Array<string>; "notebook"?: string | null; };

export type GetInstalledIconRequestInput = { "keyword"?: string | null; };

export type GetInstalledPackageSizeRequestInput = { "packageName": string; "packageType": string; };

export type GetInstalledPluginRequestInput = { "frontend": string; "keyword"?: string | null; };

export type GetInstalledTemplateRequestInput = { "keyword"?: string | null; };

export type GetInstalledThemeRequestInput = { "frontend"?: string | null; "keyword"?: string | null; };

export type GetInstalledWidgetRequestInput = { "keyword"?: string | null; };

export type GetMirrorDatabaseBlocksRequestInput = { "avID": string; };

export type GetRepoDocHistoryRequestInput = { "id": string; "page": number; };

export type GetRepoFileRequestInput = { "id": string; };

export type GetRepoSnapshotsRequestInput = { "endTime"?: number; "id"?: string; "includeFiles"?: boolean; "page": number; "startTime"?: number; };

export type GetSnippetRequestInput = { "enabled": number; "keyword"?: string | null; "type": string; };

export type GetTagRequestInput = { "app"?: string | null; "ignoreMaxListHint"?: boolean | null; "sort"?: number | null; };

export type GetUpdatedPackageRequestInput = { "frontend": string; };

export type GlobalBacklinkContextData = { "expired": boolean; "items": Array<BacklinkContext | null> | null; };

export type GlobalBacklinkContextRequestInput = { "containChildren": boolean; "id": string; "ids": Array<string>; "keyword"?: string; "notebook"?: string; "snapshot": string; "sort": number; "sourceFilter"?: BacklinkSourceFilterInput | null; };

export type GlobalBacklinkItem = { "anchor": string; "box": string; "hPath": string; "id": string; "rootID": string; };

export type GlobalBacklinkListData = { "expired": boolean; "items": Array<GlobalBacklinkItem | null> | null; "offset": number; "snapshot": string; "total": number; };

export type GlobalBacklinkListRequestInput = { "anchorID"?: string; "containChildren": boolean; "id": string; "keyword"?: string; "notebook"?: string; "offset"?: number; "snapshot"?: string; "sort": number; "sourceFilter"?: BacklinkSourceFilterInput | null; };

export type GlobalGraphConf = { "d3": GraphD3 | null; "dailyNote": boolean; "minRefs": number; "type": GraphTypeFilter | null; };

export type GlobalGraphRequestInput = { "conf": GraphConfigurationFieldsInput; "k"?: string | null; "reqId"?: JSONValue | null; };

export type GlobalGraphResult = { "box": string; "conf": GlobalGraphConf; "links": Array<GraphLink | null> | null; "nodes": Array<GraphNode | null> | null; "reqId": JSONValue; };

export type GraphArrows = { "to": GraphArrowsTo | null; };

export type GraphArrowsTo = { "enabled": boolean; };

export type GraphConfigurationFieldsInput = { "d3"?: GraphD3Input | null; "dailyNote"?: boolean | null; "minRefs"?: number | null; "type"?: GraphTypeFilterInput | null; };

export type GraphCorrelation = { "reqId": JSONValue; };

export type GraphD3 = { "arrow": boolean; "centerStrength": number; "collideRadius": number; "collideStrength": number; "lineOpacity": number; "linkDistance": number; "linkWidth": number; "nodeSize": number; };

export type GraphD3Input = { "arrow"?: boolean | null; "centerStrength"?: number | null; "collideRadius"?: number | null; "collideStrength"?: number | null; "lineOpacity"?: number | null; "linkDistance"?: number | null; "linkWidth"?: number | null; "nodeSize"?: number | null; };

export type GraphLink = { "arrows": GraphArrows | null; "from": string; "ref": boolean; "to": string; };

export type GraphNode = { "box": string; "defs": number; "id": string; "label": string; "path": string; "refs": number; "size": number; "title"?: string; "type": string; };

export type GraphTypeFilter = { "blockquote": boolean; "callout": boolean; "code": boolean; "heading": boolean; "list": boolean; "listItem": boolean; "math": boolean; "paragraph": boolean; "super": boolean; "table": boolean; "tag": boolean; };

export type GraphTypeFilterInput = { "blockquote"?: boolean | null; "callout"?: boolean | null; "code"?: boolean | null; "heading"?: boolean | null; "list"?: boolean | null; "listItem"?: boolean | null; "math"?: boolean | null; "paragraph"?: boolean | null; "super"?: boolean | null; "table"?: boolean | null; "tag"?: boolean | null; };

export type HTMLClipboardPreflight = { "converted": boolean; "dom"?: string; "normalizedHTML"?: string; "useHTML": boolean; };

export type HTMLClipboardRequestInput = { "dom": string; "mathML"?: string | null; "notebook"?: string | null; "office"?: string | null; "officeMathHTML"?: string | null; "preflight"?: boolean | null; "preparedHTML"?: boolean | null; "preserveSourceFormat"?: boolean | null; "skipBase64Assets"?: boolean | null; "skipInlineSVGAssets"?: boolean | null; "skipLocalAssets"?: boolean | null; "text"?: string | null; "wps"?: string | null; };

export type HTMLData = { "html": string; };

export type HeadingChildrenRequestInput = { "id": string; "removeFoldAttr"?: boolean | null; };

export type HeadingFoldRequestInput = { "id": string; "scope": string; };

export type HeadingLevelRequestInput = { "id"?: string; "ids"?: Array<string>; "level": number; };

export type HeadingNumbersRequestInput = { "id"?: string | null; "notebook"?: string | null; };

export type History = { "hCreated": string; "items": Array<HistoryItem | null> | null; };

export type HistoryItem = { "id": string; "notebook": string; "op": string; "path": string; "title": string; };

export type HistoryItemsData = { "items": Array<HistoryItem | null> | null; };

export type HistoryItemsRequestInput = { "created": string; "notebook"?: string | null; "op"?: string | null; "query"?: string | null; "type"?: number | null; };

export type HistoryPathRequestInput = { "historyPath": string; };

export type ImageOCRTextData = { "failed": boolean; "text": string; };

export type ImportAutoDocument = { "token"?: string; "type": "document"; };

export type ImportAutoNotebook = { "notebook": Notebook | null; "type": "notebook"; };

export type ImportAutoNotebooks = { "notebooks": Array<Notebook | null> | null; "type": "notebooks"; };

export type ImportDataRequestInput = { "file"?: Blob; };

export type ImportDocumentData = { "type": "document"; };

export type ImportMarkdownRequestInput = { "localPath": string; "notebook": string; "skipRoot"?: boolean | null; "toPath": string; };

export type ImportNotebookArchiveRequestInput = { "file": Blob; "key"?: Blob; "password": string; };

export type ImportNotebookCryptoBackupRequestInput = { "file": Blob; "password"?: string; };

export type ImportOCRModelsRequestInput = { "detector": Blob; "detectorConfig": Blob; "recognizer": Blob; "recognizerConfig": Blob; };

export type ImportRepoKeyRequestInput = { "key": string; };

export type ImportSYRequestInput = { "file"?: Blob; "notebook"?: string; "toPath"?: string; };

export type ImportTokenRequestInput = { "token": string; };

export type ImportZipMarkdownRequestInput = { "file"?: Blob; "notebook"?: string; "skipRoot"?: string; "toPath"?: string; };

export type ImportedNotebook = { "notebook": Notebook | null; };

export type ImportedNotebooks = { "notebooks": Array<Notebook | null> | null; };

export type InitRepoKeyFromPassphraseRequestInput = { "pass": string; };

export type InlineStyle = { "dark": InlineStyleTheme | null; "hidden"?: boolean; "id": string; "light": InlineStyleTheme | null; "name": string; };

export type InlineStyleAV = { "colors": Array<AttributeViewCustomColor | null> | null; "order": Array<string> | null; };

export type InlineStyleAVInput = { "colors"?: Array<AttributeViewCustomColorInput | null> | null; "order"?: Array<string> | null; };

export type InlineStyleBuiltin = { "colors": Array<InlineStyleBuiltinColor | null> | null; "hidden": InlineStyleBuiltinHidden | null; "styles": Array<InlineStyleBuiltinStyle | null> | null; };

export type InlineStyleBuiltinColor = { "dark": InlineStyleTheme | null; "index": number; "light": InlineStyleTheme | null; };

export type InlineStyleBuiltinColorInput = { "dark"?: InlineStyleThemeInput | null; "index"?: number | null; "light"?: InlineStyleThemeInput | null; };

export type InlineStyleBuiltinHidden = { "av": Array<number> | null; "backgroundColor": Array<number> | null; "color": Array<number> | null; "style1": Array<string> | null; };

export type InlineStyleBuiltinHiddenInput = { "av"?: Array<number> | null; "backgroundColor"?: Array<number> | null; "color"?: Array<number> | null; "style1"?: Array<string> | null; };

export type InlineStyleBuiltinInput = { "colors"?: Array<InlineStyleBuiltinColorInput | null> | null; "hidden"?: InlineStyleBuiltinHiddenInput | null; "styles"?: Array<InlineStyleBuiltinStyleInput | null> | null; };

export type InlineStyleBuiltinStyle = { "dark": InlineStyleTheme | null; "id": string; "light": InlineStyleTheme | null; };

export type InlineStyleBuiltinStyleInput = { "dark"?: InlineStyleThemeInput | null; "id"?: string | null; "light"?: InlineStyleThemeInput | null; };

export type InlineStyleInput = { "dark"?: InlineStyleThemeInput | null; "hidden"?: boolean | null; "id"?: string | null; "light"?: InlineStyleThemeInput | null; "name"?: string | null; };

export type InlineStyleOrder = { "backgroundColor": Array<string> | null; "color": Array<string> | null; "style1": Array<string> | null; };

export type InlineStyleOrderInput = { "backgroundColor"?: Array<string> | null; "color"?: Array<string> | null; "style1"?: Array<string> | null; };

export type InlineStyleTheme = { "backgroundColor"?: string; "color"?: string; };

export type InlineStyleThemeInput = { "backgroundColor"?: string | null; "color"?: string | null; };

export type InlineStyles = { "av": InlineStyleAV | null; "builtin": InlineStyleBuiltin | null; "order": InlineStyleOrder | null; "styles": Array<InlineStyle | null> | null; "version": number; };

export type InsertBlockRequestInput = { "data": string; "dataType": string; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; };

export type InsertCoverRequestInput = { "id": string; "name": string; };

export type InsertLocalAssetsRequestInput = { "assetPaths": Array<string>; "fromHTMLPaste"?: boolean | null; "id"?: string | null; "isUpload"?: boolean | null; };

export type InstallBazaarIconRequestInput = { "keyword"?: string | null; "packageName": string; "repoHash": string; "repoRef"?: string | null; "repoURL": string; };

export type InstallBazaarPluginRequestInput = { "frontend": string; "keyword"?: string | null; "packageName": string; "repoHash": string; "repoRef"?: string | null; "repoURL": string; };

export type InstallBazaarTemplateRequestInput = { "keyword"?: string | null; "packageName": string; "repoHash": string; "repoRef"?: string | null; "repoURL": string; };

export type InstallBazaarThemeRequestInput = { "frontend"?: string | null; "keyword"?: string | null; "mode"?: number; "modeOS"?: boolean; "packageName": string; "repoHash": string; "repoRef"?: string | null; "repoURL": string; };

export type InstallBazaarWidgetRequestInput = { "keyword"?: string | null; "packageName": string; "repoHash": string; "repoRef"?: string | null; "repoURL": string; };

export type InstallLocalBazaarPackageRequestInput = { "file"?: Blob; "frontend"?: string; "overwrite"?: string; };

export type JSONValue = null | boolean | number | string | Array<JSONValue> | { [key: string]: JSONValue };

export type KernelPetal = { "existed": boolean; "incompatible": boolean; "js": string; };

export type LegacyDocumentTarget = { "notebook": string; "path": string; "version": 1; };

export type LegacyPathDocumentResult = string | LegacyPathUnsupported;

export type LegacyPathIDsResult = Array<string> | null | LegacyPathUnsupported;

export type LegacyPathUnsupported = { "cleanIDs"?: Array<string>; "reason": "legacyPathUnsupported" | "pathAmbiguous" | "indexUnavailable"; "unsupportedIDs"?: Array<string>; };

export type ListNotebooksData = { "boxDocEnabled": boolean; "notebooks": Array<Notebook | null> | null; };

export type ListNotebooksRequestInput = { "flashcard"?: boolean | null; };

export type LivePhotoColor = { "fullRange": boolean; "matrix": number; "primaries": number; "transfer": number; };

export type LivePhotoFrameRequestInput = { "id": string; "index": number; };

export type LivePhotoFrameTime = { "duration": number; "timestamp": number; };

export type LivePhotoPreviewRequestInput = { "id": string; };

export type LivePhotoPreviewSession = { "color": LivePhotoColor; "encode": boolean; "frames": Array<LivePhotoFrameTime> | null; "height": number; "id": string; "width": number; };

export type LoadPetalsRequestInput = { "frontend": string; "settingsWindow"?: boolean; };

export type LoadedPlugin = { "methods": Array<PluginRPCMethod | null> | null; "name": string; "state": string; "stateCode": number; };

export type LoadedPluginRequestInput = { "name": string; };

export type LocalGraphConf = { "d3": GraphD3 | null; "dailyNote": boolean; "type": GraphTypeFilter | null; };

export type LocalGraphRequestInput = { "conf"?: GraphConfigurationFieldsInput; "id"?: string | null; "k"?: string | null; "notebook"?: string | null; "reqId"?: JSONValue | null; "type"?: string | null; };

export type LocalGraphResult = { "box": string; "conf": LocalGraphConf; "id": string; "links": Array<GraphLink | null> | null; "nodes": Array<GraphNode | null> | null; "reqId": JSONValue; };

export type LockScreenRequestInput = { "lockScreenMode": number; };

export type Login2faEnvelope = { "code": number; "data": ({ "code": number; "msg": string; } & { [key: string]: JSONValue }) | null; "msg": string; };

export type MCPOAuthClient = { "id": string; "name": string; "redirectURI": string; };

export type MCPOAuthClientRequestInput = { "name": string; "redirectURI": string; };

export type MCPOAuthClientSecret = { "id": string; "name": string; "redirectURI": string; "secret": string; };

export type MCPOAuthConfigInput = { "enabled": boolean; "publicURL": string; };

export type MCPOAuthConsentRequestInput = { "decision"?: string; "ticket"?: string; };

export type MCPOAuthRemoveRequestInput = { "all"?: boolean; "id"?: string; };

export type MCPOAuthStatus = { "clients": Array<MCPOAuthClient> | null; "enabled": boolean; "publicURL": string; };

export type MCPOAuthTokenRequestInput = { "client_id"?: string; "client_secret"?: string; "code"?: string; "code_verifier"?: string; "grant_type"?: string; "redirect_uri"?: string; "refresh_token"?: string; "resource"?: string; "scope"?: string; "token"?: string; "token_type_hint"?: string; };

export type MarkdownHTMLRequestInput = { "markdown": string; "mode"?: string | null; };

export type MigrateLegacyMindmapsData = { "blocks": Array<BlockDOMData> | null; "converted": number; };

export type MigrateLegacyMindmapsRequestInput = { "id": string; "notebook": string; };

export type MoveBlockRequestInput = { "id": string; "parentID"?: string | null; "previousID"?: string | null; };

export type NetImageAssetsRequestInput = { "id": string; "url"?: string | null; };

export type NetworkData = { "proxy": NetworkProxy | null; };

export type NetworkEchoAttributeTypeAndValue = ({ "Type": Array<number> | null; "Value": null | string | number | boolean | Array<number> | (NetworkEchoRawValue & { "BitLength"?: never; }) | (NetworkEchoBitString & { "Class"?: never; "FullBytes"?: never; "IsCompound"?: never; "Tag"?: never; }); } & { [key: string]: JSONValue });

export type NetworkEchoBitString = ({ "BitLength": number; "Bytes": string | null; } & { [key: string]: JSONValue });

export type NetworkEchoCertificate = ({ "AuthorityKeyId": string | null; "BasicConstraintsValid": boolean; "CRLDistributionPoints": Array<string> | null; "DNSNames": Array<string> | null; "EmailAddresses": Array<string> | null; "ExcludedDNSDomains": Array<string> | null; "ExcludedEmailAddresses": Array<string> | null; "ExcludedIPRanges": Array<NetworkEchoIPNet | null> | null; "ExcludedURIDomains": Array<string> | null; "ExtKeyUsage": Array<number> | null; "Extensions": Array<NetworkEchoExtension> | null; "ExtraExtensions": Array<NetworkEchoExtension> | null; "IPAddresses": Array<string> | null; "InhibitAnyPolicy": number; "InhibitAnyPolicyZero": boolean; "InhibitPolicyMapping": number; "InhibitPolicyMappingZero": boolean; "IsCA": boolean; "Issuer": NetworkEchoName; "IssuingCertificateURL": Array<string> | null; "KeyUsage": number; "MaxPathLen": number; "MaxPathLenZero": boolean; "NotAfter": string; "NotBefore": string; "OCSPServer": Array<string> | null; "PermittedDNSDomains": Array<string> | null; "PermittedDNSDomainsCritical": boolean; "PermittedEmailAddresses": Array<string> | null; "PermittedIPRanges": Array<NetworkEchoIPNet | null> | null; "PermittedURIDomains": Array<string> | null; "Policies": Array<string> | null; "PolicyIdentifiers": Array<Array<number> | null> | null; "PolicyMappings": Array<NetworkEchoPolicyMapping> | null; "PublicKey": null | string | (NetworkEchoRSAPublicKey & { "Curve"?: never; "G"?: never; "P"?: never; "Q"?: never; "X"?: never; "Y"?: never; }) | (NetworkEchoECDSAPublicKey & { "E"?: never; "G"?: never; "N"?: never; "P"?: never; "Q"?: never; }) | (NetworkEchoDSAPublicKey & { "Curve"?: never; "E"?: never; "N"?: never; "X"?: never; }); "PublicKeyAlgorithm": number; "Raw": string | null; "RawIssuer": string | null; "RawSubject": string | null; "RawSubjectPublicKeyInfo": string | null; "RawTBSCertificate": string | null; "RequireExplicitPolicy": number; "RequireExplicitPolicyZero": boolean; "SerialNumber": number | null; "Signature": string | null; "SignatureAlgorithm": number; "Subject": NetworkEchoName; "SubjectKeyId": string | null; "URIs": Array<NetworkEchoURL | null> | null; "UnhandledCriticalExtensions": Array<Array<number> | null> | null; "UnknownExtKeyUsage": Array<Array<number> | null> | null; "Version": number; } & { [key: string]: JSONValue });

export type NetworkEchoConnectionState = ({ "CipherSuite": number; "CurveID": number; "DidResume": boolean; "ECHAccepted": boolean; "HandshakeComplete": boolean; "HelloRetryRequest": boolean; "NegotiatedProtocol": string; "NegotiatedProtocolIsMutual": boolean; "OCSPResponse": string | null; "PeerCertificates": Array<NetworkEchoCertificate | null> | null; "ServerName": string; "SignedCertificateTimestamps": Array<string | null> | null; "TLSUnique": string | null; "VerifiedChains": Array<Array<NetworkEchoCertificate | null> | null> | null; "Version": number; } & { [key: string]: JSONValue });

export type NetworkEchoContext = { "ClientIP": string; "ContentType": string; "FullPath": string; "HandlerNames": Array<string> | null; "IsWebsocket": boolean; "Params": Array<NetworkEchoParam> | null; "RawData": string | null; "RemoteIP": string; };

export type NetworkEchoCookie = ({ "Domain": string; "Expires": string; "HttpOnly": boolean; "MaxAge": number; "Name": string; "Partitioned": boolean; "Path": string; "Quoted": boolean; "Raw": string; "RawExpires": string; "SameSite": number; "Secure": boolean; "Unparsed": Array<string> | null; "Value": string; } & { [key: string]: JSONValue });

export type NetworkEchoCurveParams = ({ "B": number | null; "BitSize": number; "Gx": number | null; "Gy": number | null; "N": number | null; "Name": string; "P": number | null; } & { [key: string]: JSONValue });

export type NetworkEchoDSAPublicKey = ({ "G": number | null; "P": number | null; "Q": number | null; "Y": number | null; } & { [key: string]: JSONValue });

export type NetworkEchoData = { "Context": NetworkEchoContext; "Request": NetworkEchoRequest; "URL": NetworkEchoURLInfo; "User": NetworkEchoUser; };

export type NetworkEchoECDSAPublicKey = ({ "Curve": (Record<string, never> & { "B"?: never; "BitSize"?: never; "Gx"?: never; "Gy"?: never; "N"?: never; "Name"?: never; "P"?: never; }) | NetworkEchoCurveParams | null; "X": number | null; "Y": number | null; } & { [key: string]: JSONValue });

export type NetworkEchoExtension = ({ "Critical": boolean; "Id": Array<number> | null; "Value": string | null; } & { [key: string]: JSONValue });

export type NetworkEchoFile = { "Content": string; "Filename": string; "Header": Record<string, Array<string> | null> | null; "Size": number; };

export type NetworkEchoIPNet = ({ "IP": string; "Mask": string | null; } & { [key: string]: JSONValue });

export type NetworkEchoMultipart = { "File": Record<string, Array<NetworkEchoFile> | null> | null; "Value": Record<string, Array<string> | null> | null; };

export type NetworkEchoName = ({ "CommonName": string; "Country": Array<string> | null; "ExtraNames": Array<NetworkEchoAttributeTypeAndValue> | null; "Locality": Array<string> | null; "Names": Array<NetworkEchoAttributeTypeAndValue> | null; "Organization": Array<string> | null; "OrganizationalUnit": Array<string> | null; "PostalCode": Array<string> | null; "Province": Array<string> | null; "SerialNumber": string; "StreetAddress": Array<string> | null; } & { [key: string]: JSONValue });

export type NetworkEchoParam = { "Key": string; "Value": string; };

export type NetworkEchoParameters = ({ "G": number | null; "P": number | null; "Q": number | null; } & { [key: string]: JSONValue });

export type NetworkEchoPolicyMapping = ({ "IssuerDomainPolicy": string; "SubjectDomainPolicy": string; } & { [key: string]: JSONValue });

export type NetworkEchoRSAPublicKey = ({ "E": number; "N": number | null; } & { [key: string]: JSONValue });

export type NetworkEchoRawValue = ({ "Bytes": string | null; "Class": number; "FullBytes": string | null; "IsCompound": boolean; "Tag": number; } & { [key: string]: JSONValue });

export type NetworkEchoRequest = { "Close": boolean; "ContentLength": number; "Cookies": Array<NetworkEchoCookie | null> | null; "Form": Record<string, Array<string> | null> | null; "Header": Record<string, Array<string> | null> | null; "Host": string; "Method": string; "MultipartForm": NetworkEchoMultipart | null; "PostForm": Record<string, Array<string> | null> | null; "Proto": string; "ProtoMajor": number; "ProtoMinor": number; "Referer": string; "RemoteAddr": string; "TLS": NetworkEchoConnectionState | null; "Trailer": Record<string, Array<string> | null> | null; "TransferEncoding": Array<string> | null; "URL": NetworkEchoURL | null; "UserAgent": string; };

export type NetworkEchoURL = ({ "ForceQuery": boolean; "Fragment": string; "Host": string; "OmitHost": boolean; "Opaque": string; "Path": string; "RawFragment": string; "RawPath": string; "RawQuery": string; "Scheme": string; "User": NetworkEchoUserinfo | null; } & { [key: string]: JSONValue });

export type NetworkEchoURLInfo = { "EscapedFragment": string; "EscapedPath": string; "Hostname": string; "IsAbs": boolean; "Port": string; "Query": Record<string, Array<string> | null> | null; "Redacted": string; "RequestURI": string; "String": string; };

export type NetworkEchoUser = { "Exists": boolean; "Password": string; "Username": string; };

export type NetworkEchoUserinfo = Record<string, never>;

export type NetworkForwardData = { "body": string; "bodyEncoding": string; "contentType": string; "elapsed": number; "headers": Record<string, Array<string> | null> | null; "status": number; "url": string; };

export type NetworkForwardRequestInput = { "contentType"?: string | null; "headers"?: Array<{ [key: string]: JSONValue } | null> | null; "method"?: string | null; "payload"?: JSONValue | null; "payloadEncoding"?: string | null; "redirect"?: boolean | null; "responseEncoding"?: string | null; "timeout"?: number | null; "url": string; };

export type NetworkProxy = { "host": string; "port": string; "scheme": string; };

export type NetworkProxyInput = { "host": string; "port": string; "scheme": string; };

export type NetworkServeRequestInput = { "networkServe": boolean; };

export type NetworkServeTLSRequestInput = { "networkServeTLS": boolean; };

export type Notebook = { "closed": boolean; "dueFlashcardCount": number; "encrypted": boolean; "flashcardCount": number; "icon": string; "id": string; "name": string; "newFlashcardCount": number; "sort": number; "sortMode": number; "state"?: "Locked" | "Unlocking" | "Unlocked" | "Locking" | "Error"; "subFileCount": number; "unlocked": boolean; };

export type NotebookArchiveCandidate = { "current": boolean; "id": string; };

export type NotebookArchiveCandidatesData = { "notebooks": Array<NotebookArchiveCandidate>; };

export type NotebookArchiveData = { "file": string; "id": string; };

export type NotebookConf = { "boxCrypt": NotebookEncryption | null; "closed": boolean; "dailyNoteSavePath": string; "dailyNoteTarget"?: StructuredDocumentTarget; "dailyNoteTemplatePath": string; "docCreateSaveBox": string; "docCreateSavePath": string; "docCreateTarget"?: StructuredDocumentTarget; "docCreateTemplatePath": string; "encrypted": boolean; "icon": string; "name": string; "refCreateSaveBox": string; "refCreateSavePath": string; "refCreateTarget"?: StructuredDocumentTarget; "sort": number; "sortMode": number; };

export type NotebookConfData = { "box": string; "conf": NotebookConf | null; "documentCapabilities"?: DocumentCapabilities; "name": string; };

export type NotebookConfPatchInput = { "boxCrypt"?: NotebookEncryptionPatchInput | null; "closed"?: boolean | null; "dailyNoteSavePath"?: string | null; "dailyNoteTarget"?: StructuredDocumentTargetInput | null; "dailyNoteTemplatePath"?: string | null; "docCreateSaveBox"?: string | null; "docCreateSavePath"?: string | null; "docCreateTarget"?: StructuredDocumentTargetInput | null; "docCreateTemplatePath"?: string | null; "encrypted"?: boolean | null; "icon"?: string | null; "name"?: string | null; "refCreateSaveBox"?: string | null; "refCreateSavePath"?: string | null; "refCreateTarget"?: StructuredDocumentTargetInput | null; "sort"?: number | null; "sortMode"?: number | null; };

export type NotebookCryptoAutoLockRequestInput = { "autoLockMinutes": number; };

export type NotebookCryptoBackupData = { "file": string; };

export type NotebookEncryption = { "createdAt": number; "metadata"?: string; "spec": number; "wrapNonce": string | null; "wrappedDEK": string | null; };

export type NotebookEncryptionPatchInput = { "createdAt"?: number | null; "metadata"?: string | Array<number> | null; "spec"?: number | null; "wrapNonce"?: string | Array<number> | null; "wrappedDEK"?: string | Array<number> | null; };

export type NotebookHistoryData = { "histories": Array<History | null> | null; };

export type NotebookIDRequestInput = { "notebook": string; };

export type NotebookInfo = { "ctime": number; "docCount": number; "hCtime": string; "hMtime": string; "hSize": string; "id": string; "mtime": number; "name": string; "size": number; };

export type NotebookInfoData = { "boxInfo": NotebookInfo | null; };

export type NotebookPasswordRequestInput = { "password": string; };

export type NotificationData = { "id": string; };

export type NotificationRequestInput = { "msg": string; "timeout"?: number | null; };

export type OCRAIModel = { "id": string; "name": string; "provider": string; };

export type OCRConfigData = { "aiModels": Array<OCRAIModel> | null; "config": SettingOCR; "models": Array<OCRModel> | null; "providers": Array<OCRProviderState> | null; };

export type OCRModel = { "builtIn": boolean; "id": string; "name": string; };

export type OCRProviderState = { "available": boolean; "id": string; };

export type OCRThresholds = { "box": number | null; "detection": number | null; "recognition": number | null; };

export type OCRThresholdsInput = { "box": number | null; "detection": number | null; "recognition": number | null; };

export type ObsidianAnalysisRequestInput = { "localPath": string; };

export type ObsidianImportRequestInput = { "notebookName": string; "taskID": string; };

export type ObsidianTaskRequestInput = { "taskID": string; };

export type ObsidianVaultAnalysis = { "ambiguousCount": number; "blockIDCount": number; "blockingErrors": Array<string> | null; "commentCount": number; "embedCount": number; "footnoteCount": number; "importableAssetCount": number; "importableAssetSize": number; "markdownCount": number; "missingCount": number; "nameAdjustmentCount": number; "notebookName": string; "skippedHiddenCount": number; "skippedLinkCount": number; "skippedNestedVaultCount": number; "skippedSpecialCount": number; "syntheticParentCount": number; "unreferencedFileCount": number; "unsupportedCount": number; "vaultName": string; "vaultPath": string; "warnings": Array<string> | null; "wikiLinkCount": number; };

export type ObsidianVaultImportResult = { "convertedEmbedCount": number; "convertedFootnoteCount": number; "convertedLinkCount": number; "failedStage"?: string; "importedAttachmentCount": number; "incomplete": boolean; "markdownCount": number; "nameAdjustmentCount": number; "notebookID": string; "notebookName": string; "preservedCommentCount": number; "preservedUnresolvedCount": number; "skippedPathCount": number; "syntheticParentCount": number; "unreferencedFileCount": number; };

export type ObsidianVaultTask = { "analysis"?: ObsidianVaultAnalysis; "detail"?: string; "error"?: string; "message": string; "progress": number; "result"?: ObsidianVaultImportResult; "state": string; "taskID": string; };

export type OpenNotebookRequestInput = { "app"?: string | null; "notebook": string; };

export type OpenRepoSnapshotFileRequestInput = { "id": string; };

export type OrderedListStartData = { "found": boolean; "start": number; };

export type OutlineRequestInput = { "id"?: string | null; "notebook"?: string | null; "preview"?: boolean | null; };

export type OutlineStorageRequestInput = { "docID": string; };

export type OutlineStorageSetRequestInput = { "docID": string; "val": { [key: string]: JSONValue }; };

export type PandocData = { "path": string; };

export type PandocRequestInput = { "args": Array<string>; "dir"?: string | null; };

export type PatchRepoSettingInput = { "indexRetentionDays"?: number | null; "retentionIndexesDaily"?: number | null; };

export type PatchSettingRequestInput = { "ai"?: SettingAIInput | null; "appearance"?: SettingAppearanceInput | null; "bazaar"?: SettingBazaarInput | null; "editor"?: SettingEditorInput | null; "export"?: SettingExportInput | null; "fileTree"?: SettingFileTreeInput | null; "flashcard"?: SettingFlashcardInput | null; "keymap"?: { [key: string]: JSONValue }; "ocr"?: SettingOCRInput | null; "publish"?: SettingPublishInput | null; "repo"?: PatchRepoSettingInput | null; "search"?: SettingSearchInput | null; "secrets"?: SettingSecretsInput | null; "snippet"?: SettingSnptInput | null; "sync"?: PatchSyncSettingInput | null; "system"?: PatchSystemSettingInput | null; "variables"?: SettingVariablesInput | null; };

export type PatchSyncSettingInput = { "assetDownloadMode"?: number | null; "cloudName"?: string | null; "enabled"?: boolean | null; "generateConflictDoc"?: boolean | null; "interval"?: number | null; "lan"?: SyncLANRequestInput | null; "local"?: SyncLocalInput | null; "mode"?: number | null; "perception"?: boolean | null; "s3"?: SyncS3Input | null; "webdav"?: SyncWebDAVInput | null; };

export type PatchSystemSettingInput = { "autoLaunch2"?: number | null; "encryptedNotebookFollowSystemLock"?: boolean | null; "lockScreenMode"?: number | null; "networkProxy"?: NetworkProxyInput | null; "networkServe"?: boolean | null; "networkServeTLS"?: boolean | null; "settingsWindow"?: boolean | null; };

export type PerformSyncRequestInput = { "mobileSwitch"?: boolean | null; "upload"?: boolean; };

export type PerformTransactionsRequestInput = { "app"?: string; "reqId": number; "session"?: string; "transactions": Array<TransactionInput | null>; };

export type Petal = { "css": string; "disabledInPublish": boolean; "disallowInstall": boolean; "displayName": string; "enabled": boolean; "i18n": { [key: string]: JSONValue } | null; "incompatible": boolean; "js": string; "kernel": KernelPetal; "name": string; "settingsWindow"?: boolean; "userDisabledInPublish": boolean; "version": string; };

export type PinnedDoc = { "alias": string; "bookmark": string; "childrenSortMode": number | null; "hCtime": string; "hMtime": string; "hSize": string; "icon": string; "id": string; "memo": string; "name": string; "name1": string; "notebook": string; "path": string; "subFileCount": number; "unavailable": boolean; };

export type PlanDocCreateRequestInput = { "contextID"?: string | null; "date"?: string; "id": string; "notebook": string; "placement"?: "configured" | "child"; "purpose": "document" | "reference" | "dailyNote"; "reuse"?: boolean; "title"?: string; };

export type PluginPublishInfo = { "fields": Array<string>; "granted": boolean; "resources": Array<string>; };

export type PluginPublishRequestInput = { "packageName": string; };

export type PluginRPCError = { "code": number; "data"?: JSONValue; "message": string; };

export type PluginRPCFailure = { "error": PluginRPCError | null; "id": string | number | null; "jsonrpc": "2.0"; };

export type PluginRPCMethod = { "descriptions": Array<string> | null; "name": string; };

export type PluginRPCNotification = { "jsonrpc": "2.0"; "method": string; "params"?: JSONValue; };

export type PluginRPCRequestFieldsInput = { "id"?: string | number | null; "jsonrpc": "2.0"; "method": string; "params"?: Array<JSONValue> | { [key: string]: JSONValue } | null; };

export type PluginRPCSuccess = { "id": string | number | null; "jsonrpc": "2.0"; "result": JSONValue; };

export type PrepareNotebookArchiveRequestInput = { "notebooks": Array<string>; };

export type PreparePasteAssetsRequestInput = { "assets": Array<string>; "notebook": string; };

export type PrepareRichTextRequestInput = { "assets": Array<RichClipboardAssetInput>; };

export type PrependBlockRequestInput = { "data": string; "dataType": string; "parentID": string; };

export type ProcessPDFRequestInput = { "exportAssets"?: boolean | null; "id": string; "merge"?: boolean | null; "mergeContentHeadingMode"?: string | null; "mergeDocHeadingMode"?: string | null; "path": string; "removeAssets": boolean; "watermark": boolean; };

export type ProxyFailure = { "code": number; "msg": string; };

export type PublishedBlockInfo = { "publishAccessRequired": true; "rootID": string; "rootIcon": string; "rootTitle": string; "rootTitleEmpty": boolean; };

export type PutFileRequestInput = { "app"?: string; "file"?: Blob; "isDir"?: string; "modTime"?: string; "path"?: string; };

export type ReadDirectoryRequestInput = { "path": string; };

export type RecentDoc = { "closedAt"?: number; "icon"?: string; "openAt"?: number; "rootID": string; "title"?: string; "viewedAt"?: number; };

export type RecentDocUpdateRequestInput = { "rootID"?: string | null; };

export type RecentDocsRequestInput = { "sortBy"?: string | null; };

export type RecentDocsUpdateRequestInput = { "rootIDs"?: Array<string> | null; };

export type RefDefs = { "defIDs": Array<string> | null; "refID": string; };

export type RefDefsData = { "refDefs": Array<RefDefs>; };

export type RefIDsData = { "originalRefBlockIDs": Record<string, string> | null; "refDefs": Array<RefDefs | null> | null; };

export type RefIDsRequestInput = { "id"?: string | null; "ids"?: Array<string> | null; "notebook"?: string | null; };

export type RefTextQueryRequestInput = { "anchor": string; "notebook"?: string | null; };

export type RefreshBacklinkRequestInput = { "id": string; };

export type RelinkAssetRequestInput = { "dryRun"?: boolean; "mappings"?: Array<AssetRelinkMappingInput>; "newPath"?: string; "oldPath"?: string; };

export type RemoveAttributeViewBlocksRequestInput = { "avID": string; "srcIDs": Array<string>; };

export type RemoveAttributeViewKeyRequestInput = { "avID": string; "keyID": string; "removeRelationDest"?: boolean | null; };

export type RemoveBookmarkRequestInput = { "bookmark": string; };

export type RemoveCloudRepoTagSnapshotRequestInput = { "tag": string; };

export type RemoveCriterionRequestInput = { "name": string; };

export type RemoveEncryptedBoxAssetsRequestInput = { "notebook": string; "paths": Array<string>; };

export type RemoveFileRequestInput = { "app"?: string | null; "path": string; };

export type RemoveRepoTagSnapshotRequestInput = { "tag": string; };

export type RemoveShorthandsRequestInput = { "ids": Array<string>; };

export type RemoveTagRequestInput = { "label": string; };

export type RemoveUnusedAttributeViewRequestInput = { "id": string; };

export type RenameAssetRequestInput = { "newName": string; "oldPath": string; };

export type RenameBookmarkRequestInput = { "newBookmark": string; "oldBookmark": string; };

export type RenameFileRequestInput = { "newPath": string; "path": string; };

export type RenameNotebookRequestInput = { "name": string; "notebook": string; };

export type RenameRiffDeckRequestInput = { "deckID": string; "name": string; };

export type RenameTagRequestInput = { "newLabel": string; "oldLabel": string; };

export type RenderAttributeViewRequestInput = { "blockID"?: string | null; "calendarRange"?: AVCalendarRangeInput | null; "createIfNotExist"?: boolean | null; "groupPaging"?: Record<string, AVGroupPagingInput | null> | null; "id": string; "ignoreRows"?: boolean | null; "initialLayout"?: string | null; "page"?: number | null; "pageSize"?: number | null; "query"?: string | null; "targetGroupID"?: string | null; "targetItemID"?: string | null; "temporarySort"?: AVViewSortInput | null; "viewID"?: string | null; };

export type RenderHistoryAttributeViewRequestInput = { "blockID"?: string | null; "calendarRange"?: AVCalendarRangeInput | null; "carrierViewID"?: string | null; "created": string; "groupPaging"?: Record<string, AVGroupPagingInput | null> | null; "id": string; "page"?: number | null; "pageSize"?: number | null; "query"?: string | null; "viewID"?: string | null; };

export type RenderSnapshotAttributeViewRequestInput = { "blockID"?: string | null; "calendarRange"?: AVCalendarRangeInput | null; "carrierViewID"?: string | null; "id": string; "snapshot": string; "viewID"?: string | null; };

export type RenderSprigRequestInput = { "template": string; };

export type RenderTemplateData = { "content": string; "docTreePlan"?: TemplatePlan; "path": string; };

export type RenderTemplateRequestInput = { "content"?: string; "id": string; "mode"?: string | null; "path": string; "preview"?: boolean | null; };

export type ReorderData = { "changed": boolean; "notebook"?: string; "parentPath"?: string; };

export type ReorderNotebooksRequestInput = { "position"?: string | null; "sourceIDs"?: Array<string> | null; "targetID"?: string | null; };

export type RepoCloudSnapshotsData = { "pageCount": number; "snapshots": Array<RepoLog | null> | null; "totalCount": number; };

export type RepoCloudTagsData = { "snapshots": Array<RepoLog | null> | null; };

export type RepoDiffData = { "addsLeft": Array<RepoDiffFile | null> | null; "left": RepoDiffIndex | null; "removesRight": Array<RepoDiffFile | null> | null; "right": RepoDiffIndex | null; "updatesLeft": Array<RepoDiffFile | null> | null; "updatesRight": Array<RepoDiffFile | null> | null; };

export type RepoDiffFile = { "fileID": string; "hPath"?: string; "hSize": string; "indexID": string; "path": string; "title": string; "updated": number; };

export type RepoDiffIndex = { "created": number; "id": string; };

export type RepoDocHistory = { "fileID": string; "hSize": string; "indexID": string; "snapshots": Array<DocHistorySnapshot | null> | null; "title": string; "updated": number; };

export type RepoDocHistoryData = { "files": Array<RepoDocHistory | null> | null; "pageCount": number; "totalCount": number; };

export type RepoExportData = { "path": string; };

export type RepoFile = { "chunks": Array<string> | null; "id": string; "path": string; "size": number; "updated": number; };

export type RepoKeyData = { "key": string; };

export type RepoLog = { "count": number; "created": number; "files": Array<RepoFile | null> | null; "hCreated": string; "hSize": string; "hTagUpdated": string; "id": string; "memo": string; "size": number; "systemID": string; "systemName": string; "systemOS": string; "tag": string; };

export type RepoOpenFileData = { "content": string; "displayInText": boolean; "title": string; "updated": number; };

export type RepoSearchData = { "files": Array<RepoDiffFile | null> | null; "pageCount": number; "totalCount": number; };

export type RepoSnapshot = { "count": number; "created": number; "files": Array<RepoFile | null> | null; "hCreated": string; "hSize": string; "hTagUpdated": string; "id": string; "memo": string; "requiresDownload": boolean; "size": number; "systemID": string; "systemName": string; "systemOS": string; "tag": string; "tags": Array<string> | null; "typesCount": Array<RepoTypeCount | null> | null; };

export type RepoSnapshotsData = { "pageCount": number; "snapshots": Array<RepoSnapshot | null> | null; "totalCount": number; };

export type RepoTagsData = { "snapshots": Array<RepoSnapshot | null> | null; };

export type RepoTypeCount = { "count": number; "type": string; };

export type ResetGraphData = { "conf": GlobalGraphConf; };

export type ResetLocalGraphData = { "conf": LocalGraphConf; };

export type ResetRiffCardsRequestInput = { "blockIDs"?: Array<string> | null; "deckID": string; "id": string; "type": string; };

export type ResetSettingsRequestInput = { "exit"?: boolean; };

export type ResolveDocPathRequestInput = { "notebook": string; "segments": Array<string>; "start": DocumentPathStartInput; };

export type ResolveDocPathResult = (ResolvedDocumentPathData & { "reason"?: never; }) | (DocumentAddressingFailure & { "candidates"?: never; "candidatesTruncated"?: never; "nameConditions"?: never; "nextIndex"?: never; "resolved"?: never; "start"?: never; "status"?: never; });

export type ResolvedDocumentPathData = { "candidates": Array<DocumentPath> | null; "candidatesTruncated": boolean; "nameConditions": Array<DocumentNameCondition> | null; "nextIndex": number; "resolved": DocumentPath | null; "start": DocumentLocation; "status": "resolved" | "missing" | "ambiguous"; };

export type ReviewRiffCardRequestInput = { "cardID": string; "deckID": string; "rating": number; "reviewedCards"?: Array<RiffReviewedCardInput> | null; };

export type RichClipboardAssetInput = { "box"?: string; "index": number; "path": string; };

export type RichClipboardPrepared = { "assets": Array<RichClipboardPreparedAsset> | null; "batch": string; "groups": Array<string> | null; };

export type RichClipboardPreparedAsset = { "index": number; "path": string; };

export type RiffBlockIDsRequestInput = { "blockIDs": Array<string>; };

export type RiffBlocksData = { "blocks": Array<SearchBlock | null> | null; };

export type RiffCardDueInput = { "due": string; "id": string; };

export type RiffCardRequestInput = { "cardID": string; "deckID": string; };

export type RiffCardsData = { "blocks": Array<SearchBlock | null> | null; "pageCount": number; "total": number; };

export type RiffCardsRequestInput = { "id": string; "page": number; "pageSize"?: number | null; };

export type RiffDeck = { "created": string; "id": string; "name": string; "size": number; "updated": string; };

export type RiffDeckCardsRequestInput = { "blockIDs": Array<string>; "deckID": string; };

export type RiffDeckRequestInput = { "deckID": string; };

export type RiffDueCard = { "blockID": string; "cardID": string; "deckID": string; "lapses": number; "lastReview": number; "nextDues": Record<string, string> | null; "reps": number; "state": number; };

export type RiffDueCardsData = { "cards": Array<RiffDueCard | null> | null; "unreviewedCount": number; "unreviewedNewCardCount": number; "unreviewedOldCardCount": number; };

export type RiffDueCardsRequestInput = { "deckID": string; "reviewedCards"?: Array<RiffReviewedCardInput> | null; };

export type RiffNotebookDueCardsRequestInput = { "notebook": string; "reviewedCards"?: Array<RiffReviewedCardInput> | null; };

export type RiffReviewedCardInput = { "cardID": string; };

export type RiffTreeDueCardsRequestInput = { "reviewedCards"?: Array<RiffReviewedCardInput> | null; "rootID": string; };

export type RollbackRepoSnapshotFileRequestInput = { "id": string; };

export type SQLQueryRequestInput = { "mode"?: string | null; "stmt": string; };

export type SavePluginPublishDataRequestInput = { "data": Record<string, null | string | number | boolean>; "packageName": string; };

export type SaveTemplateRequestInput = { "databaseMode"?: string; "directory"?: string; "id": string; "name": string; "overwrite": boolean; };

export type SearchAsset = { "hName": string; "path": string; "updated": number; };

export type SearchAssetContentData = { "assetContents": Array<AssetContent | null> | null; "matchedAssetCount": number; "pageCount": number; };

export type SearchAssetContentRequestInput = { "method"?: number | null; "orderBy"?: number | null; "page"?: number | null; "pageSize"?: number | null; "query"?: string | null; "types"?: Record<string, boolean> | null; };

export type SearchAssetMatchInput = { "field"?: "name" | "path"; "mode": "prefix" | "suffix" | "regex"; "value": string; };

export type SearchAssetRequestInput = { "exts"?: Array<string> | null; "includeMetadata"?: boolean; "k": string; "match"?: SearchAssetMatchInput | null; "page"?: number | null; "pageSize"?: number | null; };

export type SearchAttributeViewRelationKeyRequestInput = { "avID": string; "keyword": string; };

export type SearchAttributeViewRequestInput = { "avID"?: string | null; "blockID"?: string | null; "excludes"?: Array<string> | null; "includeViewMatches"?: boolean | null; "keyword": string; };

export type SearchAttributeViewRollupDestKeysRequestInput = { "avID": string; "keyword": string; };

export type SearchBlock = { "alias": string; "box": string; "children": Array<SearchBlock | null> | null; "content": string; "count": number; "created": string; "defID": string; "defPath": string; "depth": number; "fcontent": string; "folded": boolean; "hPath": string; "ial": Record<string, string> | null; "id": string; "markdown": string; "memo": string; "name": string; "number"?: string; "parentID": string; "path": string; "refCount": number; "refText": string; "refs": Array<SearchBlock | null> | null; "riffCard": SearchBlockCard | null; "riffCardID": string; "rootID": string; "sort": number; "subType": string; "tag": string; "type": string; "updated": string; };

export type SearchBlockCard = { "due": string; "lapses": number; "lastReview": string; "reps": number; "state": number; };

export type SearchBlockRequestInput = { "groupBy"?: number | null; "method"?: number | null; "orderBy"?: number | null; "page"?: number | null; "pageSize"?: number | null; "paths"?: Array<string> | null; "query"?: string | null; "subTypes"?: SearchSubtypeFilterInput | null; "types"?: Record<string, boolean> | null; };

export type SearchBlocksData = { "blocks": Array<SearchBlock | null> | null; "matchedBlockCount": number; "matchedRootCount": number; "pageCount": number; };

export type SearchEmbedBlockRequestInput = { "breadcrumb"?: boolean | null; "embedBlockID": string; "excludeIDs": Array<string | null>; "headingMode"?: number | null; "notebook"?: string | null; "stmt": string; };

export type SearchHeadingFilterInput = { "h1"?: boolean | null; "h2"?: boolean | null; "h3"?: boolean | null; "h4"?: boolean | null; "h5"?: boolean | null; "h6"?: boolean | null; };

export type SearchHistoryData = { "histories": Array<string> | null; "pageCount": number; "totalCount": number; };

export type SearchHistoryRequestInput = { "notebook"?: string | null; "op"?: string | null; "page"?: number | null; "query"?: string | null; "type"?: number | null; };

export type SearchKeywordRequestInput = { "k": string; };

export type SearchListFilterInput = { "o"?: boolean | null; "t"?: boolean | null; "u"?: boolean | null; };

export type SearchPageRequestInput = { "page"?: number | null; "pageSize"?: number | null; };

export type SearchPath = { "blocks"?: Array<SearchBlock | null>; "box": string; "children"?: Array<SearchPath | null>; "count": number; "created": string; "depth": number; "folded": boolean; "hPath": string; "id": string; "name": string; "nameIsHTML"?: boolean; "nodeType": string; "number"?: string; "subType": string; "type": string; "updated": string; };

export type SearchPathRequestInput = { "path": string; };

export type SearchRefBlockRequestInput = { "beforeLen"?: number; "exactDocTitle"?: boolean | null; "id"?: string | null; "isDatabase"?: boolean | null; "isSquareBrackets"?: boolean | null; "k"?: string; "notebook"?: string | null; "reqId"?: JSONValue | null; "rootID"?: string; };

export type SearchRefCorrelation = { "reqId": JSONValue; };

export type SearchRefResult = { "blocks": Array<SearchBlock | null> | null; "k": string; "newDoc": boolean; "reqId": JSONValue; };

export type SearchRepoFileRequestInput = { "keyword": string; "page": number; };

export type SearchSubTypes = { "heading": Record<string, boolean> | null; "list": Record<string, boolean> | null; "listItem": Record<string, boolean> | null; };

export type SearchSubTypesInput = { "heading"?: Record<string, boolean> | null; "list"?: Record<string, boolean> | null; "listItem"?: Record<string, boolean> | null; };

export type SearchSubtypeFilterInput = { "heading"?: SearchHeadingFilterInput | null; "list"?: SearchListFilterInput | null; "listItem"?: SearchListFilterInput | null; };

export type SearchTagData = { "k": string; "tags": Array<string>; };

export type SearchTagRequestInput = { "k": string; };

export type SearchTemplateData = { "k": string; "templates": Array<SearchTemplateResult | null> | null; };

export type SearchTemplateResult = { "content": string; "path": string; "relativePath": string; };

export type SearchWidgetData = { "k": string; "widgets": Array<SearchWidgetResult | null> | null; };

export type SearchWidgetResult = { "content": string; "name": string; };

export type SetAIRequestInput = { "agent"?: SettingAgentInput | null; "decision"?: SettingDecisionInput | null; "editing"?: SettingEditingInput | null; "embedding"?: SettingEmbeddingInput | null; "imageGeneration"?: SettingImageGenerationInput | null; "mcp"?: SettingMCPInput | null; "providers"?: Array<SettingProviderInput | null> | null; "rerank"?: SettingRerankInput | null; "web"?: SettingAIWebInput | null; };

export type SetAppearanceRequestInput = { "bodyGradient"?: SettingBodyGradientInput | null; "closeButtonBehavior"?: number | null; "codeBlockThemeDark"?: string | null; "codeBlockThemeLight"?: string | null; "compactMode"?: boolean | null; "darkThemes"?: Array<SettingAppearanceThemeInput | null> | null; "entryVisibility"?: SettingEntryVisibilityInput | null; "globalFontFamilies"?: Array<SettingEditorFontInput | null> | null; "hideStatusBar"?: boolean | null; "hideToolbar"?: boolean | null; "icon"?: string | null; "iconVer"?: string | null; "icons"?: Array<SettingAppearanceIconInput | null> | null; "lang"?: string | null; "lightThemes"?: Array<SettingAppearanceThemeInput | null> | null; "lockScreenWallpaper"?: boolean | null; "menuMouseScroll"?: boolean | null; "mobileBars"?: SettingMobileBarsInput | null; "mode"?: number | null; "modeOS"?: boolean | null; "notifications"?: SettingNotificationsInput | null; "outlineKeepCurrentExpand"?: boolean | null; "pdfTheme"?: SettingPDFThemeInput | null; "statusBar"?: SettingStatusBarInput | null; "themeDark"?: string | null; "themeJS"?: boolean | null; "themeLight"?: string | null; "themeVer"?: string | null; };

export type SetAssetAnnotationRequestInput = { "baseData"?: string | null; "data": string; "path": string; };

export type SetAssetOCRTextRequestInput = { "path": string; "text": string; };

export type SetAttrViewContextFilterRequestInput = { "avID": string; "blockID": string; "keyID"?: string | null; };

export type SetAttrViewFiltersRequestInput = { "avID": string; "blockID": string; "data": Array<AVViewFilterInput | null>; };

export type SetAttrViewGroupRequestInput = { "avID": string; "blockID": string; "group": AVViewGroupInput; "ignoreRows"?: boolean | null; };

export type SetAttrViewSortsRequestInput = { "avID": string; "blockID": string; "data": Array<AVViewSortInput | null>; };

export type SetAttributeViewBlockAttrRequestInput = { "avID": string; "itemID"?: string | null; "keyID": string; "rowID"?: string | null; "value": AVValueInput; };

export type SetBazaarPackageRatingRequestInput = { "packageName": string; "packageType": string; "rating": number; };

export type SetBazaarRequestInput = { "petalDisabled"?: boolean | null; "trust"?: boolean | null; };

export type SetBlockAttrsRequestInput = { "attrs": Record<string, string | null>; "id": string; };

export type SetConfSnippetRequestInput = { "enabledCSS"?: boolean | null; "enabledJS"?: boolean | null; };

export type SetCriterionRequestInput = { "criterion": CriterionInput | null; };

export type SetDatabaseBlockViewRequestInput = { "avID": string; "id": string; "viewID": string; };

export type SetEditorRequestInput = { "allowHTMLBLockScript"?: boolean | null; "allowSVGScript"?: boolean | null; "assetOpen"?: SettingAssetOpenInput | null; "autoCloseRefBrackets"?: boolean | null; "autoDirection"?: boolean | null; "backlinkBlockSort"?: number | null; "backlinkContainChildren"?: boolean | null; "backlinkExpandCount"?: number | null; "backlinkGlobalSort"?: number | null; "backlinkHideReference"?: boolean | null; "backlinkMentionExclude"?: string | null; "backlinkShowBottom"?: boolean | null; "backlinkSort"?: number | null; "backmentionExpandCount"?: number | null; "backmentionSort"?: number | null; "blockGutterMode"?: boolean | null; "blockRefDynamicAnchorTextMaxLen"?: number | null; "checkBlockRef"?: boolean | null; "codeFontFamilies"?: Array<SettingEditorFontInput | null> | null; "codeLigatures"?: boolean | null; "codeLineWrap"?: boolean | null; "codeSyntaxHighlightLineNum"?: boolean | null; "codeTabSpaces"?: number | null; "cursorSurroundingLines"?: number | null; "databaseAttrClickMode"?: number | null; "databaseAttrHideEmpty"?: boolean | null; "databaseAttrLayout"?: number | null; "databaseAttrShow"?: boolean | null; "databaseAttrUseTabs"?: boolean | null; "databaseAttrViewMode"?: number | null; "displayBookmarkIcon"?: boolean | null; "displayImgAlt"?: boolean | null; "displayImgName"?: boolean | null; "displayNetImgMark"?: boolean | null; "dragHTMLFileToIframe"?: boolean | null; "dynamicLoadBlocks"?: number | null; "embedBlockBreadcrumb"?: boolean | null; "embedBlockBreadcrumbParentPath"?: boolean | null; "emoji"?: Array<string> | null; "floatWindowDelay"?: number | null; "floatWindowMode"?: number | null; "fontFamilies"?: Array<SettingEditorFontInput | null> | null; "fontFamily"?: string | null; "fontFamilyDisplay"?: string | null; "fontSize"?: number | null; "fontSizeScrollZoom"?: boolean | null; "fontWeight"?: number | null; "fullWidth"?: boolean | null; "generateHistoryInterval"?: number | null; "hashTagSearch"?: boolean | null; "headingEmbedMode"?: number | null; "headingNumber"?: boolean | null; "headingNumberFormat"?: string | null; "historyRetentionDays"?: number | null; "justify"?: boolean | null; "katexMacros"?: string | null; "keepLoadedContent"?: boolean | null; "listItemDotNumberClickFocus"?: boolean | null; "listLogicalOutdent"?: boolean | null; "markdown"?: SettingMarkdownInput | null; "mathDelimiterCompatibility"?: boolean | null; "onlySearchForDoc"?: boolean | null; "pageScrollButtons"?: boolean | null; "pasteURLAutoConvert"?: boolean | null; "plantUMLServePath"?: string | null; "readOnly"?: boolean | null; "rtl"?: boolean | null; "spellcheck"?: boolean | null; "spellcheckLanguages"?: Array<string> | null; "virtualBlockRef"?: boolean | null; "virtualBlockRefExclude"?: string | null; "virtualBlockRefInclude"?: string | null; };

export type SetEntryVisibilityRequestInput = { "active"?: string | null; "profiles"?: Array<SettingEntryVisibilityProfileInput | null> | null; "version"?: number | null; };

export type SetExportRequestInput = { "addTitle"?: boolean | null; "blockEmbedMode"?: number | null; "blockRefMode"?: number | null; "blockRefTextLeft"?: string | null; "blockRefTextRight"?: string | null; "fileAnnotationRefMode"?: number | null; "imageWatermarkDesc"?: string | null; "imageWatermarkStr"?: string | null; "includeRelatedDocs"?: boolean | null; "includeSubDocs"?: boolean | null; "inlineMemo"?: boolean | null; "markdownYFM"?: boolean | null; "pandocBin"?: string | null; "pandocParams"?: string | null; "paragraphBeginningSpace"?: boolean | null; "pdfFooter"?: string | null; "pdfWatermarkDesc"?: string | null; "pdfWatermarkStr"?: string | null; "removeAssetsID"?: boolean | null; "tagCloseMarker"?: string | null; "tagOpenMarker"?: string | null; };

export type SetFiletreeRequestInput = { "allowCreateDeeper"?: boolean | null; "alwaysSelectOpenedFile"?: boolean | null; "boxDocEnabled"?: boolean | null; "closeTabOnDoubleClick"?: boolean | null; "closeTabsOnStart"?: boolean | null; "closeWindowOnLastTabClosed"?: boolean | null; "createDocAtTop"?: boolean | null; "docCreateSaveBox"?: string | null; "docCreateSavePath"?: string | null; "docCreateTemplatePath"?: string | null; "docIconClickMode"?: number | null; "largeFileWarningSize"?: number | null; "maxListCount"?: number | null; "maxOpenTabCount"?: number | null; "noSplitScreenWhenOpenTab"?: boolean | null; "openFilesUseCurrentTab"?: boolean | null; "parentDocTitleClickMode"?: number | null; "recentDocsMaxListCount"?: number | null; "recentDocsSort"?: string | null; "refCreateSaveBox"?: string | null; "refCreateSavePath"?: string | null; "removeDocWithoutConfirm"?: boolean | null; "shorthandSaveBox"?: string | null; "shorthandSavePath"?: string | null; "sort"?: number | null; "tabStartupMode"?: number | null; "useSVGDefaultIcon"?: boolean | null; "useSingleLineSave"?: boolean | null; };

export type SetFlashcardRequestInput = { "blockquote"?: boolean | null; "callout"?: boolean | null; "deck"?: boolean | null; "heading"?: boolean | null; "list"?: boolean | null; "mark"?: boolean | null; "maximumInterval"?: number | null; "newCardLimit"?: number | null; "requestRetention"?: number | null; "reviewCardLimit"?: number | null; "reviewMode"?: number | null; "superBlock"?: boolean | null; "weights"?: string | null; };

export type SetGraphConfRequestInput = { "conf": GraphConfigurationFieldsInput; "type": string; };

export type SetInlineStylesRequestInput = { "app"?: string | null; "av"?: InlineStyleAVInput | null; "builtin"?: InlineStyleBuiltinInput | null; "order"?: InlineStyleOrderInput | null; "styles": Array<InlineStyleInput | null>; "version": number; };

export type SetNotebookConfRequestInput = { "conf"?: NotebookConfPatchInput | null; "notebook": string; };

export type SetNotebookIconRequestInput = { "icon": string; "notebook": string; };

export type SetPetalEnabledRequestInput = { "app"?: string | null; "enabled": boolean; "packageName": string; };

export type SetPetalPublishEnabledRequestInput = { "enabled": boolean; "packageName": string; };

export type SetPluginPublishDataGrantRequestInput = { "enabled": boolean; "fields": Array<string>; "packageName": string; };

export type SetPublishRequestInput = { "auth"?: SettingBasicAuthInput | null; "enable"?: boolean | null; "port"?: number | null; };

export type SetRepoIndexRetentionDaysRequestInput = { "days": number; };

export type SetRetentionIndexesDailyRequestInput = { "indexes": number; };

export type SetRiffCardsDueRequestInput = { "cardDues": Array<RiffCardDueInput>; };

export type SetSearchRequestInput = { "alias"?: boolean | null; "audioBlock"?: boolean | null; "backlinkMentionAlias"?: boolean | null; "backlinkMentionAnchor"?: boolean | null; "backlinkMentionDoc"?: boolean | null; "backlinkMentionKeywordsLimit"?: number | null; "backlinkMentionName"?: boolean | null; "blockquote"?: boolean | null; "callout"?: boolean | null; "caseSensitive"?: boolean | null; "codeBlock"?: boolean | null; "customBlock"?: boolean | null; "databaseBlock"?: boolean | null; "document"?: boolean | null; "embedBlock"?: boolean | null; "hanSensitive"?: boolean | null; "heading"?: boolean | null; "htmlBlock"?: boolean | null; "ial"?: boolean | null; "iframeBlock"?: boolean | null; "indexAssetPath"?: boolean | null; "limit"?: number | null; "list"?: boolean | null; "listItem"?: boolean | null; "mathBlock"?: boolean | null; "memo"?: boolean | null; "mindmap"?: boolean | null; "mindmapItem"?: boolean | null; "name"?: boolean | null; "paragraph"?: boolean | null; "superBlock"?: boolean | null; "tabItem"?: boolean | null; "table"?: boolean | null; "tabs"?: boolean | null; "videoBlock"?: boolean | null; "virtualRefAlias"?: boolean | null; "virtualRefAnchor"?: boolean | null; "virtualRefDoc"?: boolean | null; "virtualRefName"?: boolean | null; "widgetBlock"?: boolean | null; };

export type SetSecretsRequestInput = { "items"?: Array<SettingSecretInput | null> | null; };

export type SetSnapshotMemoRequestInput = { "id": string; "memo": string; };

export type SetSnippetRequestInput = { "revision"?: string | null; "snippets": Array<SnippetInput>; };

export type SetSyncLocalRequestInput = { "local": SyncLocalInput; };

export type SetSyncS3RequestInput = { "s3": SyncS3Input; };

export type SetSyncWebDAVRequestInput = { "webdav": SyncWebDAVInput; };

export type SetVariablesRequestInput = { "items"?: Array<SettingVariableInput | null> | null; };

export type SettingAI = { "agent": SettingAgent | null; "decision": SettingDecision | null; "editing": SettingEditing | null; "embedding": SettingEmbedding | null; "imageGeneration": SettingImageGeneration | null; "mcp": SettingMCP | null; "providers": Array<SettingProvider | null> | null; "rerank": SettingRerank | null; "web": SettingAIWeb | null; };

export type SettingAIInput = { "agent"?: SettingAgentInput | null; "decision"?: SettingDecisionInput | null; "editing"?: SettingEditingInput | null; "embedding"?: SettingEmbeddingInput | null; "imageGeneration"?: SettingImageGenerationInput | null; "mcp"?: SettingMCPInput | null; "providers"?: Array<SettingProviderInput | null> | null; "rerank"?: SettingRerankInput | null; "web"?: SettingAIWebInput | null; };

export type SettingAIWeb = { "apiKey": string; "fetchProvider": string; "searchProvider": string; "timeout": number; };

export type SettingAIWebInput = { "apiKey"?: string | null; "fetchProvider"?: string | null; "searchProvider"?: string | null; "timeout"?: number | null; };

export type SettingAgent = { "approvalPolicy": SettingApprovalPolicy | null; "capabilityPolicy": SettingCapabilityPolicy | null; "confirmTimeout": number; "maxCompletionTokens": number; "maxRetries": number; "maxToolCallRounds": number; "modelId": string; "sessionTimeout": number; "skills": SettingAgentSkills | null; "streamIdleTimeout": number; "streamingMarkdown": boolean; "temperature": number; };

export type SettingAgentInput = { "approvalPolicy"?: SettingApprovalPolicyInput | null; "capabilityPolicy"?: SettingCapabilityPolicyInput | null; "confirmTimeout"?: number | null; "maxCompletionTokens"?: number | null; "maxRetries"?: number | null; "maxToolCallRounds"?: number | null; "modelId"?: string | null; "sessionTimeout"?: number | null; "skills"?: SettingAgentSkillsInput | null; "streamIdleTimeout"?: number | null; "streamingMarkdown"?: boolean | null; "temperature"?: number | null; };

export type SettingAgentSkills = { "builtinDisabled": Array<string> | null; "userEnabled": Array<string> | null; };

export type SettingAgentSkillsInput = { "builtinDisabled"?: Array<string> | null; "userEnabled"?: Array<string> | null; };

export type SettingAppearance = { "bodyGradient": SettingBodyGradient | null; "closeButtonBehavior": number; "codeBlockThemeDark": string; "codeBlockThemeLight": string; "compactMode": boolean; "darkThemes": Array<SettingAppearanceTheme | null> | null; "entryVisibility": SettingEntryVisibility | null; "globalFontFamilies": Array<SettingEditorFont | null> | null; "hideStatusBar": boolean; "hideToolbar": boolean; "icon": string; "iconVer": string; "icons": Array<SettingAppearanceIcon | null> | null; "lang": string; "lightThemes": Array<SettingAppearanceTheme | null> | null; "lockScreenWallpaper": boolean; "menuMouseScroll": boolean; "mobileBars": SettingMobileBars | null; "mode": number; "modeOS": boolean; "notifications": SettingNotifications | null; "outlineKeepCurrentExpand": boolean; "pdfTheme": SettingPDFTheme | null; "statusBar": SettingStatusBar | null; "themeDark": string; "themeJS": boolean; "themeLight": string; "themeVer": string; };

export type SettingAppearanceIcon = { "label": string; "name": string; };

export type SettingAppearanceIconInput = { "label"?: string | null; "name"?: string | null; };

export type SettingAppearanceInput = { "bodyGradient"?: SettingBodyGradientInput | null; "closeButtonBehavior"?: number | null; "codeBlockThemeDark"?: string | null; "codeBlockThemeLight"?: string | null; "compactMode"?: boolean | null; "darkThemes"?: Array<SettingAppearanceThemeInput | null> | null; "entryVisibility"?: SettingEntryVisibilityInput | null; "globalFontFamilies"?: Array<SettingEditorFontInput | null> | null; "hideStatusBar"?: boolean | null; "hideToolbar"?: boolean | null; "icon"?: string | null; "iconVer"?: string | null; "icons"?: Array<SettingAppearanceIconInput | null> | null; "lang"?: string | null; "lightThemes"?: Array<SettingAppearanceThemeInput | null> | null; "lockScreenWallpaper"?: boolean | null; "menuMouseScroll"?: boolean | null; "mobileBars"?: SettingMobileBarsInput | null; "mode"?: number | null; "modeOS"?: boolean | null; "notifications"?: SettingNotificationsInput | null; "outlineKeepCurrentExpand"?: boolean | null; "pdfTheme"?: SettingPDFThemeInput | null; "statusBar"?: SettingStatusBarInput | null; "themeDark"?: string | null; "themeJS"?: boolean | null; "themeLight"?: string | null; "themeVer"?: string | null; };

export type SettingAppearanceTheme = { "frontends"?: Array<string>; "label": string; "name": string; };

export type SettingAppearanceThemeInput = { "frontends"?: Array<string> | null; "label"?: string | null; "name"?: string | null; };

export type SettingApprovalPolicy = { "default": string; "overrides": Record<string, SettingCapabilityApproval | null> | null; };

export type SettingApprovalPolicyInput = { "default"?: string | null; "overrides"?: Record<string, SettingCapabilityApprovalInput | null> | null; };

export type SettingAssetOpen = { "altClick": string; "click": string; "ctrlClick": string; "shiftClick": string; };

export type SettingAssetOpenInput = { "altClick"?: string | null; "click"?: string | null; "ctrlClick"?: string | null; "shiftClick"?: string | null; };

export type SettingBasicAuth = { "accounts": Array<SettingBasicAuthAccount | null> | null; "enable": boolean; };

export type SettingBasicAuthAccount = { "memo": string; "password": string; "username": string; };

export type SettingBasicAuthAccountInput = { "memo"?: string | null; "password"?: string | null; "username"?: string | null; };

export type SettingBasicAuthInput = { "accounts"?: Array<SettingBasicAuthAccountInput | null> | null; "enable"?: boolean | null; };

export type SettingBazaar = { "petalDisabled": boolean; "trust": boolean; };

export type SettingBazaarInput = { "petalDisabled"?: boolean | null; "trust"?: boolean | null; };

export type SettingBodyGradient = { "dark": SettingBodyGradientColor; "light": SettingBodyGradientColor; "mode": string; };

export type SettingBodyGradientColor = { "color": string; "opacity": number; };

export type SettingBodyGradientColorInput = { "color"?: string | null; "opacity"?: number | null; };

export type SettingBodyGradientInput = { "dark"?: SettingBodyGradientColorInput | null; "light"?: SettingBodyGradientColorInput | null; "mode"?: string | null; };

export type SettingBootAppearance = { "appearance"?: string; "backgroundColor"?: string; "displayName"?: string; "enabled": boolean; "frontends"?: Array<string>; "layers"?: Array<SettingBootAppearanceLayer | null>; "officialUI"?: SettingBootAppearanceOfficialUI; "provider"?: string; "style"?: string; };

export type SettingBootAppearanceCurrent = { "appearance": string; "provider": string; };

export type SettingBootAppearanceLayer = { "fit"?: string; "id": string; "position"?: string; "poster"?: string; "src": string; "type": string; };

export type SettingBootAppearanceOfficialUI = { "progressColor"?: string; "showDetails": boolean; "showLogo": boolean; "textColor"?: string; "trackColor"?: string; };

export type SettingBootAppearanceRequestInput = { "appearance"?: string | null; "provider"?: string | null; };

export type SettingBootAppearanceSelection = { "appearance": string; "provider": string; "schemaVersion": number; };

export type SettingBootAppearancesData = { "appearances": Array<SettingBootAppearance | null> | null; "current": SettingBootAppearanceCurrent; };

export type SettingCapabilityApproval = { "actions": Record<string, string> | null; "default": string; };

export type SettingCapabilityApprovalInput = { "actions"?: Record<string, string> | null; "default"?: string | null; };

export type SettingCapabilityPolicy = { "default": string; "overrides": Record<string, string> | null; };

export type SettingCapabilityPolicyInput = { "default"?: string | null; "overrides"?: Record<string, string> | null; };

export type SettingCloudUserRequestInput = { "cached"?: boolean; "token"?: string | null; };

export type SettingDecision = { "apiKey": string; "enabled": boolean; "endpoint": string; "name": string; "profiles": Record<string, SettingDecisionProfile | null> | null; "provider": string; "timeout": number; };

export type SettingDecisionInput = { "apiKey"?: string | null; "enabled"?: boolean | null; "endpoint"?: string | null; "name"?: string | null; "profiles"?: Record<string, SettingDecisionProfileInput | null> | null; "provider"?: string | null; "timeout"?: number | null; };

export type SettingDecisionProfile = { "apiKey": string; "endpoint": string; "name": string; "timeout": number; };

export type SettingDecisionProfileInput = { "apiKey": string; "endpoint": string; "name": string; "timeout": number; };

export type SettingEditing = { "maxCompletionTokens": number; "maxHistoryMessages": number; "modelId": string; "temperature": number; };

export type SettingEditingInput = { "maxCompletionTokens"?: number | null; "maxHistoryMessages"?: number | null; "modelId"?: string | null; "temperature"?: number | null; };

export type SettingEditor = { "allowHTMLBLockScript": boolean; "allowSVGScript": boolean; "assetOpen": SettingAssetOpen | null; "autoCloseRefBrackets": boolean; "autoDirection": boolean; "backlinkBlockSort": number; "backlinkContainChildren": boolean; "backlinkExpandCount": number; "backlinkGlobalSort": number; "backlinkHideReference": boolean; "backlinkMentionExclude": string; "backlinkShowBottom": boolean; "backlinkSort": number | null; "backmentionExpandCount": number; "backmentionSort": number | null; "blockGutterMode": boolean; "blockRefDynamicAnchorTextMaxLen": number; "checkBlockRef": boolean | null; "codeFontFamilies": Array<SettingEditorFont | null> | null; "codeLigatures": boolean; "codeLineWrap": boolean; "codeSyntaxHighlightLineNum": boolean; "codeTabSpaces": number; "cursorSurroundingLines": number; "databaseAttrClickMode": number; "databaseAttrHideEmpty": boolean; "databaseAttrLayout": number | null; "databaseAttrShow": boolean | null; "databaseAttrUseTabs": boolean | null; "databaseAttrViewMode": number; "displayBookmarkIcon": boolean; "displayImgAlt": boolean; "displayImgName": boolean; "displayNetImgMark": boolean; "dragHTMLFileToIframe": boolean; "dynamicLoadBlocks": number; "embedBlockBreadcrumb": boolean; "embedBlockBreadcrumbParentPath": boolean | null; "emoji": Array<string> | null; "floatWindowDelay": number | null; "floatWindowMode": number; "fontFamilies": Array<SettingEditorFont | null> | null; "fontFamily": string; "fontFamilyDisplay": string; "fontSize": number; "fontSizeScrollZoom": boolean; "fontWeight": number; "fullWidth": boolean; "generateHistoryInterval": number; "hashTagSearch": boolean | null; "headingEmbedMode": number; "headingNumber": boolean; "headingNumberFormat": string; "historyRetentionDays": number; "justify": boolean; "katexMacros": string; "keepLoadedContent": boolean; "listItemDotNumberClickFocus": boolean; "listLogicalOutdent": boolean; "markdown": SettingMarkdown | null; "mathDelimiterCompatibility": boolean | null; "onlySearchForDoc": boolean; "pageScrollButtons": boolean; "pasteURLAutoConvert": boolean; "plantUMLServePath": string; "readOnly": boolean; "rtl": boolean; "spellcheck": boolean; "spellcheckLanguages": Array<string> | null; "virtualBlockRef": boolean; "virtualBlockRefExclude": string; "virtualBlockRefInclude": string; };

export type SettingEditorFont = { "displayName": string; "family": string; "weight": number; };

export type SettingEditorFontInput = { "displayName"?: string | null; "family"?: string | null; "weight"?: number | null; };

export type SettingEditorInput = { "allowHTMLBLockScript"?: boolean | null; "allowSVGScript"?: boolean | null; "assetOpen"?: SettingAssetOpenInput | null; "autoCloseRefBrackets"?: boolean | null; "autoDirection"?: boolean | null; "backlinkBlockSort"?: number | null; "backlinkContainChildren"?: boolean | null; "backlinkExpandCount"?: number | null; "backlinkGlobalSort"?: number | null; "backlinkHideReference"?: boolean | null; "backlinkMentionExclude"?: string | null; "backlinkShowBottom"?: boolean | null; "backlinkSort"?: number | null; "backmentionExpandCount"?: number | null; "backmentionSort"?: number | null; "blockGutterMode"?: boolean | null; "blockRefDynamicAnchorTextMaxLen"?: number | null; "checkBlockRef"?: boolean | null; "codeFontFamilies"?: Array<SettingEditorFontInput | null> | null; "codeLigatures"?: boolean | null; "codeLineWrap"?: boolean | null; "codeSyntaxHighlightLineNum"?: boolean | null; "codeTabSpaces"?: number | null; "cursorSurroundingLines"?: number | null; "databaseAttrClickMode"?: number | null; "databaseAttrHideEmpty"?: boolean | null; "databaseAttrLayout"?: number | null; "databaseAttrShow"?: boolean | null; "databaseAttrUseTabs"?: boolean | null; "databaseAttrViewMode"?: number | null; "displayBookmarkIcon"?: boolean | null; "displayImgAlt"?: boolean | null; "displayImgName"?: boolean | null; "displayNetImgMark"?: boolean | null; "dragHTMLFileToIframe"?: boolean | null; "dynamicLoadBlocks"?: number | null; "embedBlockBreadcrumb"?: boolean | null; "embedBlockBreadcrumbParentPath"?: boolean | null; "emoji"?: Array<string> | null; "floatWindowDelay"?: number | null; "floatWindowMode"?: number | null; "fontFamilies"?: Array<SettingEditorFontInput | null> | null; "fontFamily"?: string | null; "fontFamilyDisplay"?: string | null; "fontSize"?: number | null; "fontSizeScrollZoom"?: boolean | null; "fontWeight"?: number | null; "fullWidth"?: boolean | null; "generateHistoryInterval"?: number | null; "hashTagSearch"?: boolean | null; "headingEmbedMode"?: number | null; "headingNumber"?: boolean | null; "headingNumberFormat"?: string | null; "historyRetentionDays"?: number | null; "justify"?: boolean | null; "katexMacros"?: string | null; "keepLoadedContent"?: boolean | null; "listItemDotNumberClickFocus"?: boolean | null; "listLogicalOutdent"?: boolean | null; "markdown"?: SettingMarkdownInput | null; "mathDelimiterCompatibility"?: boolean | null; "onlySearchForDoc"?: boolean | null; "pageScrollButtons"?: boolean | null; "pasteURLAutoConvert"?: boolean | null; "plantUMLServePath"?: string | null; "readOnly"?: boolean | null; "rtl"?: boolean | null; "spellcheck"?: boolean | null; "spellcheckLanguages"?: Array<string> | null; "virtualBlockRef"?: boolean | null; "virtualBlockRefExclude"?: string | null; "virtualBlockRefInclude"?: string | null; };

export type SettingEmbedding = { "apiKey": string; "baseURL": string; "batchSize": number; "concurrency": number; "dimensions": number; "enabled": boolean; "id": string; "name": string; "timeout": number; };

export type SettingEmbeddingInput = { "apiKey"?: string | null; "baseURL"?: string | null; "batchSize"?: number | null; "concurrency"?: number | null; "dimensions"?: number | null; "enabled"?: boolean | null; "id"?: string | null; "name"?: string | null; "timeout"?: number | null; };

export type SettingEmojiRequestInput = { "emoji": Array<string>; };

export type SettingEntryVisibility = { "active": string; "profiles": Array<SettingEntryVisibilityProfile | null> | null; "version": number; };

export type SettingEntryVisibilityInput = { "active"?: string | null; "profiles"?: Array<SettingEntryVisibilityProfileInput | null> | null; "version"?: number | null; };

export type SettingEntryVisibilityProfile = { "defaults"?: "simple" | "full"; "entries": Record<string, boolean> | null; "id": string; "name": string; "orders": Record<string, Array<string> | null> | null; };

export type SettingEntryVisibilityProfileInput = { "defaults"?: "simple" | "full"; "entries"?: Record<string, boolean> | null; "id"?: string | null; "name"?: string | null; "orders"?: Record<string, Array<string> | null> | null; };

export type SettingExport = { "addTitle": boolean; "blockEmbedMode": number; "blockRefMode": number; "blockRefTextLeft": string; "blockRefTextRight": string; "fileAnnotationRefMode": number; "imageWatermarkDesc": string; "imageWatermarkStr": string; "includeRelatedDocs": boolean; "includeSubDocs": boolean; "inlineMemo": boolean; "markdownYFM": boolean; "pandocBin": string; "pandocParams": string; "paragraphBeginningSpace": boolean; "pdfFooter": string; "pdfWatermarkDesc": string; "pdfWatermarkStr": string; "removeAssetsID": boolean; "tagCloseMarker": string; "tagOpenMarker": string; };

export type SettingExportInput = { "addTitle"?: boolean | null; "blockEmbedMode"?: number | null; "blockRefMode"?: number | null; "blockRefTextLeft"?: string | null; "blockRefTextRight"?: string | null; "fileAnnotationRefMode"?: number | null; "imageWatermarkDesc"?: string | null; "imageWatermarkStr"?: string | null; "includeRelatedDocs"?: boolean | null; "includeSubDocs"?: boolean | null; "inlineMemo"?: boolean | null; "markdownYFM"?: boolean | null; "pandocBin"?: string | null; "pandocParams"?: string | null; "paragraphBeginningSpace"?: boolean | null; "pdfFooter"?: string | null; "pdfWatermarkDesc"?: string | null; "pdfWatermarkStr"?: string | null; "removeAssetsID"?: boolean | null; "tagCloseMarker"?: string | null; "tagOpenMarker"?: string | null; };

export type SettingFileTree = { "allowCreateDeeper": boolean; "alwaysSelectOpenedFile": boolean; "boxDocEnabled": boolean | null; "closeTabOnDoubleClick": boolean; "closeTabsOnStart": boolean; "closeWindowOnLastTabClosed": boolean | null; "createDocAtTop": boolean | null; "docCreateSaveBox": string; "docCreateSavePath": string; "docCreateTemplatePath": string; "docIconClickMode": number; "largeFileWarningSize": number; "maxListCount": number; "maxOpenTabCount": number; "noSplitScreenWhenOpenTab": boolean; "openFilesUseCurrentTab": boolean; "parentDocTitleClickMode": number; "recentDocsMaxListCount": number; "recentDocsSort": string; "refCreateSaveBox": string; "refCreateSavePath": string; "removeDocWithoutConfirm": boolean; "shorthandSaveBox": string; "shorthandSavePath": string; "sort": number; "tabStartupMode": number | null; "useSVGDefaultIcon": boolean | null; "useSingleLineSave": boolean; };

export type SettingFileTreeInput = { "allowCreateDeeper"?: boolean | null; "alwaysSelectOpenedFile"?: boolean | null; "boxDocEnabled"?: boolean | null; "closeTabOnDoubleClick"?: boolean | null; "closeTabsOnStart"?: boolean | null; "closeWindowOnLastTabClosed"?: boolean | null; "createDocAtTop"?: boolean | null; "docCreateSaveBox"?: string | null; "docCreateSavePath"?: string | null; "docCreateTemplatePath"?: string | null; "docIconClickMode"?: number | null; "largeFileWarningSize"?: number | null; "maxListCount"?: number | null; "maxOpenTabCount"?: number | null; "noSplitScreenWhenOpenTab"?: boolean | null; "openFilesUseCurrentTab"?: boolean | null; "parentDocTitleClickMode"?: number | null; "recentDocsMaxListCount"?: number | null; "recentDocsSort"?: string | null; "refCreateSaveBox"?: string | null; "refCreateSavePath"?: string | null; "removeDocWithoutConfirm"?: boolean | null; "shorthandSaveBox"?: string | null; "shorthandSavePath"?: string | null; "sort"?: number | null; "tabStartupMode"?: number | null; "useSVGDefaultIcon"?: boolean | null; "useSingleLineSave"?: boolean | null; };

export type SettingFlashcard = { "blockquote": boolean; "callout": boolean; "deck": boolean; "heading": boolean; "list": boolean; "mark": boolean; "maximumInterval": number; "newCardLimit": number; "requestRetention": number; "reviewCardLimit": number; "reviewMode": number; "superBlock": boolean; "weights": string; };

export type SettingFlashcardInput = { "blockquote"?: boolean | null; "callout"?: boolean | null; "deck"?: boolean | null; "heading"?: boolean | null; "list"?: boolean | null; "mark"?: boolean | null; "maximumInterval"?: number | null; "newCardLimit"?: number | null; "requestRetention"?: number | null; "reviewCardLimit"?: number | null; "reviewMode"?: number | null; "superBlock"?: boolean | null; "weights"?: string | null; };

export type SettingGetSectionRequestInput = { "namespace": string; };

export type SettingIconRequestInput = { "icon": string; };

export type SettingImageGeneration = { "modelId": string; "outputFormat": string; "quality": string; "requestTimeout": number; "size": string; };

export type SettingImageGenerationInput = { "modelId"?: string | null; "outputFormat"?: string | null; "quality"?: string | null; "requestTimeout"?: number | null; "size"?: string | null; };

export type SettingIssue = { "field": string; "message": string; "severity": string; };

export type SettingKeymapRequestInput = { "data": { [key: string]: JSONValue }; };

export type SettingLogin2faRequestInput = { "code": string; "token": string; };

export type SettingMCP = { "exposurePolicy": SettingCapabilityPolicy | null; "servers": Array<SettingMCPServer> | null; };

export type SettingMCPInput = { "exposurePolicy"?: SettingCapabilityPolicyInput | null; "servers"?: Array<SettingMCPServerInput> | null; };

export type SettingMCPServer = { "args": Array<string> | null; "command": string; "disableStandaloneSSE": boolean; "enabled": boolean; "env": Record<string, string> | null; "headers": Record<string, string> | null; "id": string; "inheritEnv": Array<string> | null; "name": string; "timeout": number; "trustToolAnnotations": boolean; "type": string; "url": string; };

export type SettingMCPServerInput = { "args"?: Array<string> | null; "command"?: string | null; "disableStandaloneSSE"?: boolean | null; "enabled"?: boolean | null; "env"?: Record<string, string> | null; "headers"?: Record<string, string> | null; "id"?: string | null; "inheritEnv"?: Array<string> | null; "name"?: string | null; "timeout"?: number | null; "trustToolAnnotations"?: boolean | null; "type"?: string | null; "url"?: string | null; };

export type SettingMarkdown = { "blockFullWidthTaskList": boolean | null; "codeBlockMiddleDot": boolean | null; "inlineAsterisk": boolean; "inlineFullWidthStrikethrough": boolean; "inlineMark": boolean; "inlineMath": boolean; "inlineStrikethrough": boolean; "inlineSub": boolean; "inlineSup": boolean; "inlineTag": boolean; "inlineUnderscore": boolean; };

export type SettingMarkdownInput = { "blockFullWidthTaskList"?: boolean | null; "codeBlockMiddleDot"?: boolean | null; "inlineAsterisk"?: boolean | null; "inlineFullWidthStrikethrough"?: boolean | null; "inlineMark"?: boolean | null; "inlineMath"?: boolean | null; "inlineStrikethrough"?: boolean | null; "inlineSub"?: boolean | null; "inlineSup"?: boolean | null; "inlineTag"?: boolean | null; "inlineUnderscore"?: boolean | null; };

export type SettingMobileBars = { "autoHide": boolean | null; "sidebarButtons": boolean | null; "sidebarSwipe": boolean | null; };

export type SettingMobileBarsInput = { "autoHide"?: boolean | null; "sidebarButtons"?: boolean | null; "sidebarSwipe"?: boolean | null; };

export type SettingModel = { "contextLength"?: number; "displayName"?: string; "enabled": boolean; "id": string; "name": string; };

export type SettingModelInput = { "contextLength"?: number | null; "displayName"?: string | null; "enabled"?: boolean | null; "id"?: string | null; "name"?: string | null; };

export type SettingNotifications = { "browserCompatibility": boolean; "docTreeMaxList": boolean; "formatPainterTip"?: boolean; "selectAllIncompleteTip"?: boolean; "selectAllTip"?: boolean; "tagMaxList": boolean; "workspaceNotSSD": boolean; };

export type SettingNotificationsInput = { "browserCompatibility"?: boolean | null; "docTreeMaxList"?: boolean | null; "formatPainterTip"?: boolean | null; "selectAllIncompleteTip"?: boolean | null; "selectAllTip"?: boolean | null; "tagMaxList"?: boolean | null; "workspaceNotSSD"?: boolean | null; };

export type SettingOCR = { "aiModelId": string; "auto": boolean; "model": string; "provider": string; "reasoningEffort": string; "showEmpty": boolean; "showError": boolean; "showText"?: boolean; "thresholds": OCRThresholds; };

export type SettingOCRInput = { "aiModelId"?: string | null; "auto": boolean; "model": string; "provider": string; "reasoningEffort"?: string | null; "showEmpty"?: boolean | null; "showError"?: boolean | null; "showText"?: boolean | null; "thresholds"?: OCRThresholdsInput | null; };

export type SettingPDFTheme = { "annoColor": string; "dark": string; "light": string; };

export type SettingPDFThemeInput = { "annoColor"?: string | null; "dark"?: string | null; "light"?: string | null; };

export type SettingPatchData = { "issues": Array<SettingIssue> | null; };

export type SettingPetalDisabledData = { "dataChangePlugins": Array<string> | null; "globalPetalChanged": boolean; "globalPetalDisabled": boolean; "globalPetalEnabled": boolean; "globalPetalRevision": number; "reloadPlugins": Array<string> | null; "uninstallPlugins": Array<string> | null; "unloadPlugins": Array<string> | null; };

export type SettingPetalDisabledRequestInput = { "petalDisabled": boolean; };

export type SettingProvider = { "accountID"?: string; "apiKey": string; "authType"?: string; "baseURL": string; "displayName"?: string; "enabled": boolean; "headers"?: Record<string, string>; "id": string; "models": Array<SettingModel | null> | null; "protocol"?: string; "requestTimeout": number; };

export type SettingProviderInput = { "accountID"?: string | null; "apiKey"?: string | null; "authType"?: string | null; "baseURL"?: string | null; "displayName"?: string | null; "enabled"?: boolean | null; "headers"?: Record<string, string> | null; "id"?: string | null; "models"?: Array<SettingModelInput | null> | null; "protocol"?: string | null; "requestTimeout"?: number | null; };

export type SettingPublish = { "auth": SettingBasicAuth | null; "enable": boolean; "port": number; };

export type SettingPublishData = { "port": number; "publish": SettingPublish | null; };

export type SettingPublishInput = { "auth"?: SettingBasicAuthInput | null; "enable"?: boolean | null; "port"?: number | null; };

export type SettingRerank = { "apiKey": string; "candidateCount": number; "enabled": boolean; "endpoint": string; "id": string; "name": string; "requestFormat": string; "timeout": number; };

export type SettingRerankInput = { "apiKey"?: string | null; "candidateCount"?: number | null; "enabled"?: boolean | null; "endpoint"?: string | null; "id"?: string | null; "name"?: string | null; "requestFormat"?: string | null; "timeout"?: number | null; };

export type SettingSearch = { "alias": boolean; "audioBlock": boolean; "backlinkMentionAlias": boolean; "backlinkMentionAnchor": boolean; "backlinkMentionDoc": boolean; "backlinkMentionKeywordsLimit": number; "backlinkMentionName": boolean; "blockquote": boolean; "callout": boolean; "caseSensitive": boolean; "codeBlock": boolean; "customBlock": boolean | null; "databaseBlock": boolean; "document": boolean; "embedBlock": boolean; "hanSensitive": boolean | null; "heading": boolean; "htmlBlock": boolean; "ial": boolean; "iframeBlock": boolean; "indexAssetPath": boolean; "limit": number; "list": boolean; "listItem": boolean; "mathBlock": boolean; "memo": boolean; "mindmap": boolean | null; "mindmapItem": boolean | null; "name": boolean; "paragraph": boolean; "superBlock": boolean; "tabItem": boolean; "table": boolean; "tabs": boolean; "videoBlock": boolean; "virtualRefAlias": boolean; "virtualRefAnchor": boolean; "virtualRefDoc": boolean; "virtualRefName": boolean; "widgetBlock": boolean; };

export type SettingSearchInput = { "alias"?: boolean | null; "audioBlock"?: boolean | null; "backlinkMentionAlias"?: boolean | null; "backlinkMentionAnchor"?: boolean | null; "backlinkMentionDoc"?: boolean | null; "backlinkMentionKeywordsLimit"?: number | null; "backlinkMentionName"?: boolean | null; "blockquote"?: boolean | null; "callout"?: boolean | null; "caseSensitive"?: boolean | null; "codeBlock"?: boolean | null; "customBlock"?: boolean | null; "databaseBlock"?: boolean | null; "document"?: boolean | null; "embedBlock"?: boolean | null; "hanSensitive"?: boolean | null; "heading"?: boolean | null; "htmlBlock"?: boolean | null; "ial"?: boolean | null; "iframeBlock"?: boolean | null; "indexAssetPath"?: boolean | null; "limit"?: number | null; "list"?: boolean | null; "listItem"?: boolean | null; "mathBlock"?: boolean | null; "memo"?: boolean | null; "mindmap"?: boolean | null; "mindmapItem"?: boolean | null; "name"?: boolean | null; "paragraph"?: boolean | null; "superBlock"?: boolean | null; "tabItem"?: boolean | null; "table"?: boolean | null; "tabs"?: boolean | null; "videoBlock"?: boolean | null; "virtualRefAlias"?: boolean | null; "virtualRefAnchor"?: boolean | null; "virtualRefDoc"?: boolean | null; "virtualRefName"?: boolean | null; "widgetBlock"?: boolean | null; };

export type SettingSecret = { "allowedHosts": Array<string> | null; "name": string; "value": string; };

export type SettingSecretInput = { "allowedHosts"?: Array<string> | null; "name"?: string | null; "value"?: string | null; };

export type SettingSecrets = { "items": Array<SettingSecret | null> | null; };

export type SettingSecretsInput = { "items"?: Array<SettingSecretInput | null> | null; };

export type SettingSectionData = { "conf": SystemAppConf | null; "namespace": string; "revision": number; "settingTasks"?: SettingTaskState; };

export type SettingSnpt = { "enabledCSS": boolean; "enabledJS": boolean; };

export type SettingSnptInput = { "enabledCSS"?: boolean | null; "enabledJS"?: boolean | null; };

export type SettingStatusBar = { "msgDataSyncDisabled": boolean; "msgTaskAssetDatabaseIndexCommitDisabled": boolean; "msgTaskDatabaseIndexCommitDisabled": boolean; "msgTaskHistoryDatabaseIndexCommitDisabled": boolean; "msgTaskHistoryGenerateFileDisabled": boolean; "version": number; };

export type SettingStatusBarInput = { "msgDataSyncDisabled"?: boolean | null; "msgTaskAssetDatabaseIndexCommitDisabled"?: boolean | null; "msgTaskDatabaseIndexCommitDisabled"?: boolean | null; "msgTaskHistoryDatabaseIndexCommitDisabled"?: boolean | null; "msgTaskHistoryGenerateFileDisabled"?: boolean | null; "version"?: number | null; };

export type SettingTask = { "active": boolean; "id": string; "message": string; "revision": number; };

export type SettingTaskState = { "revision": number; "tasks": Array<SettingTask> | null; };

export type SettingThemeRequestInput = { "appearanceMode"?: string | null; "modes"?: Array<number> | null; "theme"?: string | null; };

export type SettingUser = { "userAvatarURL": string; "userCreateTime": string; "userHomeBImgURL": string; "userId": string; "userIntro": string; "userName": string; "userNickname": string; "userSiYuanAssetSize": number; "userSiYuanOneTimePayStatus": number; "userSiYuanPointExchangeRepoSize": number; "userSiYuanProExpireTime": number; "userSiYuanRepoSize": number; "userSiYuanSubscriptionPlan": number; "userSiYuanSubscriptionStatus": number; "userSiYuanSubscriptionType": number; "userTitles": Array<SettingUserTitle | null> | null; "userToken": string; "userTokenExpireTime": string; "userTrafficAPIGet": number; "userTrafficAPIPut": number; "userTrafficDownload": number; "userTrafficTime": number; "userTrafficUpload": number; };

export type SettingUserTitle = { "desc": string; "icon": string; "name": string; };

export type SettingVariable = { "name": string; "value": string; };

export type SettingVariableInput = { "name"?: string | null; "value"?: string | null; };

export type SettingVariables = { "items": Array<SettingVariable | null> | null; };

export type SettingVariablesInput = { "items"?: Array<SettingVariableInput | null> | null; };

export type SettingsWindowRequestInput = { "settingsWindow": boolean; };

export type Shorthand = { "hCreated": string; "oId": string; "shorthandContent": string; "shorthandDesc": string; "shorthandFrom": number; "shorthandMd": string; "shorthandTitle": string; "shorthandURL": string; };

export type ShorthandPage = { "pagination": ShorthandPagination; "shorthands": Array<Shorthand | null>; };

export type ShorthandPagination = { "paginationPageCount": number; "paginationPageNums": Array<number> | null; "paginationRecordCount": number; };

export type ShorthandsData = { "code": number; "data": ShorthandPage; "msg": string; };

export type ShorthandsRequestInput = { "page": number; };

export type Snippet = { "content": string; "disabledInPublish": boolean; "enabled": boolean; "id": string; "name": string; "type": string; };

export type SnippetInput = { "content": string; "disabledInPublish"?: boolean | null; "enabled": boolean; "id": string; "name": string; "type": string; };

export type SnippetsData = { "revision"?: string; "snippets": Array<Snippet | null>; };

export type SortAttributeViewKeyRequestInput = { "avID": string; "keyID": string; "previousKeyID": string; };

export type SortAttributeViewViewKeyRequestInput = { "avID": string; "keyID": string; "previousKeyID": string; "viewID"?: string | null; };

export type StartLivePhotoPreviewRequestInput = { "clientEncode"?: boolean; "path": string; };

export type StorageKeyRequestInput = { "key": string; };

export type StorageKeysRequestInput = { "keys": Array<string>; };

export type StorageRemoveKeysRequestInput = { "app"?: string | null; "keys": Array<string>; };

export type StorageRemoveRequestInput = { "app"?: string | null; "key": string; };

export type StorageSetKeysRequestInput = { "app"?: string | null; "keyVals": { [key: string]: JSONValue }; };

export type StorageSetRequestInput = { "app"?: string | null; "key": string; "val"?: JSONValue | null; };

export type StructuredDocumentTarget = { "anchor": DocumentTargetAnchor; "notebook": string; "onMissingParent": "create" | "error"; "parents": Array<string>; "title": string; "up": number; "version": 2; };

export type StructuredDocumentTargetInput = { "anchor": DocumentTargetAnchorInput; "notebook": string; "onMissingParent": "create" | "error"; "parents": Array<string>; "title": string; "up": number; "version": 2; };

export type StructuredTemplateRequired = { "reason": "structuredTemplateRequired"; };

export type SwapBlockRefRequestInput = { "defID": string; "includeChildren": boolean; "originalToEmbed"?: boolean; "refID": string; };

export type SyncAssetDownloadModeData = { "assetDownloadMode": number; };

export type SyncCheckoutClientRequestInput = { "appID"?: string; "clientID"?: string; };

export type SyncCheckoutSnapshot = { "kernelID": string; "revision": number; "task": SyncCheckoutState | null; };

export type SyncCheckoutState = { "blocking": boolean; "canceling": boolean; "current": number; "message": string; "phase": string; "removeRootIDs": Array<string>; "revision": number; "taskID": string; "token": string; "total": number; "upsertRootIDs": Array<string>; };

export type SyncEnabledRequestInput = { "enabled": boolean; };

export type SyncInfoData = { "kernel": string; "kernels": Array<SyncOnlineKernel | null> | null; "stat": string; "synced": number; };

export type SyncIntervalRequestInput = { "interval": number; };

export type SyncLANRequestInput = { "enabled": boolean; "maxConcurrentReqs"?: number | null; };

export type SyncLANStatus = { "active": boolean; "connectedPeers": number; "discoveredPeers": number; "enabled": boolean; "maxConcurrentReqs": number; };

export type SyncLocal = { "concurrentReqs": number; "endpoint": string; "timeout": number; };

export type SyncLocalData = { "local": SyncLocal | null; };

export type SyncLocalInput = { "concurrentReqs"?: number | null; "endpoint"?: string | null; "timeout"?: number | null; };

export type SyncModeRequestInput = { "mode": number; };

export type SyncNameRequestInput = { "name": string; };

export type SyncOnlineKernel = { "hostname": string; "id": string; "os": string; "ver": string; };

export type SyncProviderConfigRulesData = { "endpointBucketWarning": boolean; "requiredFields": Array<string>; };

export type SyncProviderConfigRulesRequestInput = { "bucket"?: string; "endpoint"?: string; "provider": number; };

export type SyncProviderExportData = { "name": string; "zip": string; };

export type SyncProviderImportRequestInput = { "file"?: Blob; };

export type SyncProviderRequestInput = { "completeAssets"?: boolean | null; "provider": number; };

export type SyncS3 = { "accessKey": string; "bucket": string; "concurrentReqs": number; "endpoint": string; "pathStyle": boolean; "region": string; "secretKey": string; "skipTlsVerify": boolean; "timeout": number; };

export type SyncS3Data = { "s3": SyncS3 | null; };

export type SyncS3Input = { "accessKey"?: string | null; "bucket"?: string | null; "concurrentReqs"?: number | null; "endpoint"?: string | null; "pathStyle"?: boolean | null; "region"?: string | null; "secretKey"?: string | null; "skipTlsVerify"?: boolean | null; "timeout"?: number | null; };

export type SyncWebDAV = { "concurrentReqs": number; "endpoint": string; "password": string; "skipTlsVerify": boolean; "timeout": number; "username": string; };

export type SyncWebDAVData = { "webdav": SyncWebDAV | null; };

export type SyncWebDAVInput = { "concurrentReqs"?: number | null; "endpoint"?: string | null; "password"?: string | null; "skipTlsVerify"?: boolean | null; "timeout"?: number | null; "username"?: string | null; };

export type SystemAPI = { "token": string; };

export type SystemAPITokenRequestInput = { "token": string; };

export type SystemAccessAuthCodeRequestInput = { "accessAuthCode": string; };

export type SystemAppConf = { "accessAuthCode": string; "ai": SettingAI | null; "api": SystemAPI | null; "appearance": SettingAppearance | null; "bazaar": SettingBazaar | null; "cloudRegion": number; "cookieKey": string; "dataIndexState": number; "editor": SettingEditor | null; "export": SettingExport | null; "fileTree": SettingFileTree | null; "flashcard": SettingFlashcard | null; "graph": SystemGraph | null; "keymap": { [key: string]: JSONValue } | null; "lang": string; "langs": Array<SystemLang | null> | null; "logLevel": string; "mcpOAuth": string; "notebookCrypto": SystemNotebookCrypto | null; "ocr": SettingOCR | null; "oidc": SystemOIDC | null; "onboarding": SystemOnboarding | null; "publish": SettingPublish | null; "readonly": boolean; "repo": SystemRepo | null; "search": SettingSearch | null; "secrets": SettingSecrets | null; "serverAddrs": Array<string> | null; "showChangelog": boolean; "snippet": SettingSnpt | null; "stat": SystemStat | null; "sync": SystemSync | null; "system": SystemSystem | null; "tag": SystemTag | null; "uiLayout": { [key: string]: JSONValue } | null; "userData": string; "variables": SettingVariables | null; };

export type SystemAppearanceData = { "appearance": SettingAppearance | null; };

export type SystemAppearanceModeRequestInput = { "mode": number; };

export type SystemArgon2Params = { "iterations": number; "keyLength": number; "memory": number; "parallelism": number; };

export type SystemChangelogData = { "html": string; "show": boolean; "version": string; };

export type SystemChangelogRequestInput = { "force"?: boolean | null; };

export type SystemCheckUpdateRequestInput = { "showMsg": boolean; };

export type SystemConfData = { "conf": SystemAppConf | null; "isPublish": boolean; "revision": number; "settingTasks"?: SettingTaskState; "start": boolean; };

export type SystemCustomEmojiRequestInput = { "file"?: Blob; "name"?: string; "url"?: string; };

export type SystemCustomFont = { "aliases"?: Array<string>; "displayName": string; "family": string; "id": string; "spacing"?: string; "url": string; "weight": number; };

export type SystemD3 = { "arrow": boolean; "centerStrength": number; "collideRadius": number; "collideStrength": number; "lineOpacity": number; "linkDistance": number; "linkWidth": number; "nodeSize": number; };

export type SystemDownloadUpdateRequestInput = { "version": string; };

export type SystemEmoji = { "description": string; "description_ja_jp": string; "description_zh_cn": string; "keywords": string; "unicode": string; };

export type SystemEmojiGroup = { "id": string; "items": Array<SystemEmoji | null> | null; "title": string; "title_ja_jp": string; "title_zh_cn": string; };

export type SystemExitData = { "closeTimeout": number; "installPkgPath"?: string; };

export type SystemExitRequestInput = { "execInstallPkg"?: number | null; "force"?: boolean | null; "recoverExit"?: SystemRecoverExitInput | null; "setCurrentWorkspace"?: boolean | null; };

export type SystemExportConfData = { "name": string; "zip": string; };

export type SystemFileTraversalData = { "text": string; };

export type SystemFont = { "aliases"?: Array<string>; "displayName": string; "family": string; "spacing"?: string; "weight": number; };

export type SystemGlobalGraph = { "d3": SystemD3 | null; "dailyNote": boolean; "minRefs": number; "type": SystemTypeFilter | null; };

export type SystemGraph = { "global": SystemGlobalGraph | null; "local": SystemLocalGraph | null; "maxBlocks": number; };

export type SystemImportConfRequestInput = { "file"?: Array<Blob>; };

export type SystemImportFileRequestInput = { "file"?: Blob; };

export type SystemLANSync = { "enabled": boolean; "maxConcurrentReqs": number; };

export type SystemLang = { "label": string; "name": string; };

export type SystemLocal = { "concurrentReqs": number; "endpoint": string; "timeout": number; };

export type SystemLocalGraph = { "d3": SystemD3 | null; "dailyNote": boolean; "type": SystemTypeFilter | null; };

export type SystemLoginAuthRequestInput = { "authCode": string; "captcha"?: string | null; "rememberMe"?: boolean | null; };

export type SystemMessageData = { "msg": string; };

export type SystemNetworkProxy = { "host": string; "port": string; "scheme": string; };

export type SystemNotebookCrypto = { "autoLockMinutes": number; "backupID"?: string; "checksum"?: string; "createdAt"?: number; "enabled": boolean; "historyKEKs"?: Array<string | null>; "kdfParams": SystemArgon2Params; "kekMAC"?: string; "kekVerifier": string | null; "masterSalt": string | null; "spec": number; "verifierNonce": string | null; };

export type SystemOIDC = { "allowAll": boolean; "claimRules": Array<SystemOIDCClaimRule | null> | null; "clientID": string; "clientSecret": string; "enabled": boolean; "issuerURL": string; "provider": string; "redirectURL": string; "scopes": Array<string> | null; };

export type SystemOIDCActivateData = { "config": SystemOIDC | null; "status": "completed"; };

export type SystemOIDCClaimRule = { "claim": string; "operator": string; "values": Array<string> | null; };

export type SystemOIDCClaimRuleInput = { "claim"?: string | null; "operator"?: string | null; "values"?: Array<string> | null; };

export type SystemOIDCCompletedData = { "status": "completed"; "to": string; };

export type SystemOIDCMobileData = (SystemOIDCMobileValidationData & { "to"?: never; }) | (SystemOIDCMobileRedirectData & { "validation"?: never; });

export type SystemOIDCMobileRedirectData = { "to": string; };

export type SystemOIDCMobileRequestInput = { "callbackURL"?: string | null; };

export type SystemOIDCMobileValidationData = { "validation": true; };

export type SystemOIDCPendingData = { "status": "pending"; };

export type SystemOIDCPollData = (SystemOIDCPendingData & { "to"?: never; }) | SystemOIDCCompletedData;

export type SystemOIDCPollRequestInput = { "pollToken"?: string | null; };

export type SystemOIDCRequestInput = { "allowAll"?: boolean | null; "claimRules"?: Array<SystemOIDCClaimRuleInput | null> | null; "clientID"?: string | null; "clientSecret"?: string | null; "enabled"?: boolean | null; "issuerURL"?: string | null; "provider"?: string | null; "redirectURL"?: string | null; "scopes"?: Array<string> | null; };

export type SystemOIDCStartData = { "authURL": string; "expiresIn": number; "pollToken"?: string; };

export type SystemOIDCStartRequestInput = { "flow"?: string | null; "rememberMe"?: boolean | null; "to"?: string | null; };

export type SystemOIDCValidatePollData = { "status": "pending" | "completed"; };

export type SystemOnboarding = { "dismissed": boolean; "documentID": string; "newUser": boolean; "notebookID": string; "state": string; };

export type SystemPathData = { "path": string; };

export type SystemPathRequestInput = { "path": string; };

export type SystemRecoverExitInput = { "force"?: boolean | null; "pid": number; "startedAt": number; };

export type SystemRemoveCustomFontData = { "appearance": SettingAppearance | null; "editor": SettingEditor | null; "font": SystemCustomFont | null; };

export type SystemRemoveCustomFontRequestInput = { "id"?: string | null; };

export type SystemRepo = { "indexRetentionDays": number; "key": string | null; "retentionIndexesDaily": number; "syncIndexTiming": number; };

export type SystemRuntimeInfoData = { "text": string; };

export type SystemS3 = { "accessKey": string; "bucket": string; "concurrentReqs": number; "endpoint": string; "pathStyle": boolean; "region": string; "secretKey": string; "skipTlsVerify": boolean; "timeout": number; };

export type SystemStat = { "assetsSize": number; "blockCount": number; "cAssetsSize": number; "cBlockCount": number; "cDataSize": number; "cTreeCount": number; "dataSize": number; "treeCount": number; };

export type SystemSync = { "assetDownloadMode": number; "cloudName": string; "enabled": boolean; "generateConflictDoc": boolean; "interval": number; "lan": SystemLANSync | null; "local": SystemLocal | null; "mode": number; "perception": boolean; "provider": number; "s3": SystemS3 | null; "stat": string; "synced": number; "webdav": SystemWebDAV | null; };

export type SystemSystem = { "appDir": string; "autoLaunch2": number; "confDir": string; "container": string; "dataDir": string; "disabledFeatures": Array<string> | null; "downloadInstallPkg": boolean; "encryptedNotebookFollowSystemLock": boolean; "homeDir": string; "id": string; "isMicrosoftStore": boolean; "kernelVersion": string; "lockScreenMode": number; "microsoftDefenderExcluded": boolean; "name": string; "networkProxy": SystemNetworkProxy | null; "networkServe": boolean; "networkServeTLS": boolean; "os": string; "osPlatform": string; "safeMode": boolean; "settingsWindow": boolean; "updateChannel"?: string; "workspaceDir": string; };

export type SystemTag = { "sort": number; };

export type SystemTypeFilter = { "blockquote": boolean; "callout": boolean; "code": boolean; "heading": boolean; "list": boolean; "listItem": boolean; "math": boolean; "paragraph": boolean; "super": boolean; "table": boolean; "tag": boolean; };

export type SystemUILayoutRequestInput = { "layout"?: { [key: string]: JSONValue } | null; };

export type SystemWallpaperUploadRequestInput = { "file": Blob; };

export type SystemWebDAV = { "concurrentReqs": number; "endpoint": string; "password": string; "skipTlsVerify": boolean; "timeout": number; "username": string; };

export type SystemWorkspace = { "closed": boolean; "path": string; };

export type SystemWorkspaceCheckData = { "isWorkspace": boolean; };

export type SystemZipData = { "zip": string; };

export type TagData = { "children": Array<TagData | null> | null; "count": number; "depth": number; "label": string; "name": string; "type": string; };

export type TagSnapshotRequestInput = { "id": string; "name": string; };

export type TailChildBlocksRequestInput = { "id": string; "ids"?: Array<string> | null; "n"?: number | null; "notebook"?: string | null; };

export type TaskListMarkerRequestInput = { "id": string; "marker": string; };

export type TemplateDocumentInfo = { "directory": string; "hasDatabase": boolean; "name": string; };

export type TemplateDocumentRequestInput = { "id": string; };

export type TemplateFileEntry = { "isDir": boolean; "isPackage"?: boolean; "path": string; };

export type TemplateFileRequestInput = { "action"?: string; "content"?: string; "path"?: string; "revision"?: string; "target"?: string; };

export type TemplateFileRevision = { "revision": string; };

export type TemplateFileSource = { "content": string; "path"?: string; "revision": string; "sourceDocID"?: string; };

export type TemplatePlan = { "count": number; "id": string; "nodes": Array<TemplatePlanNode | null> | null; };

export type TemplatePlanNode = { "depth": number; "hPath": string; "id": string; "parentID": string; "title": string; };

export type TestSyncProviderLocalRequestInput = { "local": SyncLocalInput; };

export type TestSyncProviderS3Data = { "kind": string; "msg": string; };

export type TestSyncProviderS3RequestInput = { "s3": SyncS3Input; };

export type TestSyncProviderWebDAVRequestInput = { "cloudName"?: string; "webdav": SyncWebDAVInput; };

export type Transaction = { "doOperations": Array<TransactionOperation | null> | null; "templateDocTreePlanID"?: string; "timestamp": number; "undoOperations": Array<TransactionOperation | null> | null; };

export type TransactionAttributeChangeInput = { "data-av-type"?: string | null; "new"?: Record<string, string> | null; "old"?: Record<string, string> | null; };

export type TransactionBlockSwapInput = { "includeChildren": boolean; "originalToEmbed": boolean; };

export type TransactionCardCoverPositionInput = { "position"?: AVCardCoverPositionInput | null; "source"?: string | null; };

export type TransactionCellUpdate = { "data": AVValueInput; "keyID": string; "rowID": string; };

export type TransactionCellUpdateInput = { "data"?: AVValueInput | null; "keyID"?: string | null; "rowID"?: string | null; };

export type TransactionClearHistoryRequestInput = { "rootID"?: string; };

export type TransactionContext = ({ "blockID"?: string; "box"?: string; "boxID"?: string; "filteredTipAppID"?: string; "filteredTipScope"?: string; "filteredTipToken"?: string; "focusId"?: string; "headingBatchRootID"?: string; "ignoreProcess"?: string; "ignoreTip"?: string; "message"?: string; "moveGroupID"?: string; "notebook"?: string; "openFilteredItem"?: string; "protyleID"?: string; "removeFold"?: string; "rootID"?: string; "setRange"?: string; "undoFocusCalloutTitle"?: string; "undoFocusCollapseToEnd"?: string; "undoFocusEmbedId"?: string; "undoFocusEnd"?: string; "undoFocusEndId"?: string; "undoFocusEndIndex"?: string; "undoFocusId"?: string; "undoFocusIgnoreZWSP"?: string; "undoFocusIndex"?: string; "undoFocusStart"?: string; "undoFocusStartAtEnd"?: string; "undoFocusTableCell"?: string; "undoFocusTableSelection"?: string; } & { [key: string]: JSONValue }) | null;

export type TransactionCustomColorsInput = { "colors"?: Array<AVAttributeViewCustomColorInput | null> | null; "order"?: Array<string> | null; };

export type TransactionHistoryApplied = { "canRedo": boolean; "canUndo": boolean; "doOperations": Array<TransactionOperation | null> | null; "isUndo": boolean; "mutatedRootIDs": Array<string> | null; "undoOperations": Array<TransactionOperation | null> | null; };

export type TransactionHistoryEmpty = { "canRedo": false; "canUndo": false; };

export type TransactionHistoryFailure = { "failed": true; "msg": string; };

export type TransactionHistoryRequestInput = { "app"?: string; "rootID": string; "session"?: string; };

export type TransactionInput = { "doOperations"?: Array<TransactionOperationRequest | null> | null; "templateDocTreePlanID"?: string | null; "timestamp"?: number | null; "undoOperations"?: Array<TransactionOperationRequest | null> | null; };

export type TransactionInsertedItems = { "existingItemIDs": Array<string> | null; "insertedItemIDs": Array<string> | null; };

export type TransactionInsertedItemsInput = { "existingItemIDs": Array<string>; "insertedItemIDs": Array<string>; };

export type TransactionListConversionInput = { "level": number; "recursively": boolean; "type": "heading" | "paragraph" | "remove"; };

export type TransactionListConversionResult = { "focusID": string; "removedIDs": Array<string> | null; "rootIDs": Array<string> | null; };

export type TransactionListConversionResultInput = { "focusID": string; "removedIDs": Array<string>; "rootIDs": Array<string>; };

export type TransactionNewItemTemplatesInput = { "defaultTemplateID"?: string | null; "templates"?: Array<AVNewItemTemplateInput | null> | null; };

export type TransactionOperation = { "action": "updateAttrs"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": TransactionAttributeChangeInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "create"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "restoreCreatedDoc"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "removeCreatedDoc"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "update"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "insert"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "delete"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": BlockDeleteDataInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "move"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "swapBlockRef"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": TransactionBlockSwapInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": Array<string> | null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "convertList"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": TransactionListConversionInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": TransactionListConversionResult | null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "moveOutlineHeading"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "append"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "appendInsert"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "prependInsert"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "foldHeading"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "unfoldHeading"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrs"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null | string | Array<string>; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "doUpdateUpdated"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "addFlashcards"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "removeFlashcards"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewName"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewNewItemTemplates"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": TransactionNewItemTemplatesInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewAutomations"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": AVAutomationConfigInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "collectAttrViewBlocks"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": AVCollectBlocksInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "cleanupAttrViewBlocks"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": AVCollectionCleanupInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewConditionalColors"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": Array<AVConditionalColorRuleInput | null> | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewFilters"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": Array<AVViewFilterInput | null> | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewContextFilter"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColRelationFilters"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": Array<AVViewFilterInput | null> | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColRollupFilters"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": Array<AVViewFilterInput | null> | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewSorts"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": Array<AVViewSortInput | null> | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewPageSize"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": number | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColWidth"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColsWidth"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": Record<string, string> | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColAlign"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColWrap"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColHidden"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColPin"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColIcon"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColDesc"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColAttributePanelVisibility"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "insertAttrViewBlock"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": TransactionInsertedItems | null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "removeAttrViewBlock"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "addAttrViewCol"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "updateAttrViewCol"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "removeAttrViewCol"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "sortAttrViewRow"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": AVRowOrderChangeInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "sortAttrViewCol"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "sortAttrViewKey"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "sortAttrViewBinding"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "updateAttrViewCell"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": AVValueInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "updateAttrViewCells"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "updateAttrViewColOptions"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": Array<AVSelectOptionInput | null> | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "removeAttrViewColOption"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "updateAttrViewColOption"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": TransactionOptionChangeInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColOptionDesc"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": TransactionOptionDescriptionInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewCustomColors"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": TransactionCustomColorsInput | Array<AVAttributeViewCustomColorInput | null> | null | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColCalc"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": AVFieldCalcInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "updateAttrViewColNumberFormat"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColDateFormat"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "replaceAttrViewBlock"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": TransactionReplacedItem | null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "updateAttrViewColTemplate"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "addAttrViewView"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "removeAttrViewView"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": string | null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewViewName"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewViewIcon"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewViewDesc"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "duplicateAttrViewView"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "duplicateAttrViewRow"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "sortAttrViewView"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": string | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "updateAttrViewColRelation"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "updateAttrViewColRollup"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": TransactionRollupInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "hideAttrViewName"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColDateFillCreated"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColDateFillSpecificTime"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewCreatedIncludeTime"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewUpdatedIncludeTime"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "duplicateAttrViewKey"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewCoverFrom"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": number | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewCoverFromAssetKeyID"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewCardCoverPosition"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": TransactionCardCoverPositionInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewCardSize"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": number | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewCardWidth"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": number | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewCalendar"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": AVCalendarSettingsInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewCardLayout"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": number | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewColFullRow"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewFitImage"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewDisplayFieldName"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewDisplayEmptyFields"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewFillColBackgroundColor"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewShowIcon"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewWrapField"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "changeAttrViewLayout"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewBlockView"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewBlockVisibleViews"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewCardAspectRatio"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": number | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewCardAspectRatioValue"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": number | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "setAttrViewGroup"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": AVViewGroupInput | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "hideAttrViewGroup"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": number | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "hideAttrViewAllGroups"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "foldAttrViewGroup"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": boolean | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "foldAttrViewGroups"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": Record<string, boolean> | null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "syncAttrViewTableColWidth"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "removeAttrViewGroup"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": "sortAttrViewGroup"; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": null; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": null; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; } | { "action": UnknownTransactionAction; "avID": string; "backRelationKeyID": string; "blockID": string; "blockIDs": Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdate | null>; "context": TransactionContext; "data": JSONValue; "deckID": string; "format": string; "groupID": string; "id": string; "ignoreDefaultFill": boolean; "isDetached": boolean; "isTwoWay": boolean; "keyID": string; "layout": string; "name": string; "nextID": string; "parentID": string; "previousID": string; "removeDest": boolean; "retData": JSONValue; "rootID": string; "rowID": string; "srcIDs": Array<string> | null; "srcs": Array<TransactionSourceFieldsInput | null> | null; "targetGroupID": string; "type": "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID": string; "viewIDs"?: Array<string>; };

export type TransactionOperationRequest = { "action": "updateAttrs"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: TransactionAttributeChangeInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "create"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "restoreCreatedDoc"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "removeCreatedDoc"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "update"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null | string | Array<string>; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "insert"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null | string | Array<string>; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "delete"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: BlockDeleteDataInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null | string | Array<string>; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "move"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "swapBlockRef"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: TransactionBlockSwapInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: Array<string> | null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "convertList"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: TransactionListConversionInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: TransactionListConversionResultInput | null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "moveOutlineHeading"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null | string | Array<string>; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "append"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "appendInsert"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null | string | Array<string>; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "prependInsert"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null | string | Array<string>; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "foldHeading"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null | string | Array<string>; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "unfoldHeading"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null | string | Array<string>; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrs"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null | string | Array<string>; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "doUpdateUpdated"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "addFlashcards"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "removeFlashcards"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewName"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewNewItemTemplates"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: TransactionNewItemTemplatesInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewAutomations"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: AVAutomationConfigInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "collectAttrViewBlocks"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: AVCollectBlocksInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "cleanupAttrViewBlocks"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: AVCollectionCleanupInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewConditionalColors"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: Array<AVConditionalColorRuleInput | null> | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewFilters"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: Array<AVViewFilterInput | null> | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewContextFilter"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColRelationFilters"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: Array<AVViewFilterInput | null> | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColRollupFilters"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: Array<AVViewFilterInput | null> | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewSorts"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: Array<AVViewSortInput | null> | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewPageSize"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: number | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColWidth"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColsWidth"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: Record<string, string> | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColAlign"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColWrap"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColHidden"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColPin"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColIcon"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColDesc"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColAttributePanelVisibility"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "insertAttrViewBlock"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: TransactionInsertedItemsInput | null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "removeAttrViewBlock"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "addAttrViewCol"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "updateAttrViewCol"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "removeAttrViewCol"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "sortAttrViewRow"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: AVRowOrderChangeInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "sortAttrViewCol"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "sortAttrViewKey"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "sortAttrViewBinding"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "updateAttrViewCell"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: AVValueInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "updateAttrViewCells"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "updateAttrViewColOptions"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: Array<AVSelectOptionInput | null> | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "removeAttrViewColOption"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "updateAttrViewColOption"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: TransactionOptionChangeInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColOptionDesc"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: TransactionOptionDescriptionInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewCustomColors"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: TransactionCustomColorsInput | Array<AVAttributeViewCustomColorInput | null> | null | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColCalc"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: AVFieldCalcInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "updateAttrViewColNumberFormat"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColDateFormat"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "replaceAttrViewBlock"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: TransactionReplacedItemInput | null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "updateAttrViewColTemplate"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "addAttrViewView"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "removeAttrViewView"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: string | null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewViewName"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewViewIcon"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewViewDesc"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "duplicateAttrViewView"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "duplicateAttrViewRow"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "sortAttrViewView"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: string | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "updateAttrViewColRelation"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "updateAttrViewColRollup"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: TransactionRollupInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "hideAttrViewName"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColDateFillCreated"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColDateFillSpecificTime"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewCreatedIncludeTime"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewUpdatedIncludeTime"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "duplicateAttrViewKey"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewCoverFrom"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: number | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewCoverFromAssetKeyID"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewCardCoverPosition"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: TransactionCardCoverPositionInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewCardSize"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: number | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewCardWidth"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: number | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewCalendar"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: AVCalendarSettingsInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewCardLayout"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: number | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewColFullRow"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewFitImage"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewDisplayFieldName"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewDisplayEmptyFields"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewFillColBackgroundColor"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewShowIcon"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewWrapField"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "changeAttrViewLayout"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewBlockView"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewBlockVisibleViews"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewCardAspectRatio"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: number | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewCardAspectRatioValue"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: number | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "setAttrViewGroup"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: AVViewGroupInput | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "hideAttrViewGroup"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: number | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "hideAttrViewAllGroups"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "foldAttrViewGroup"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: boolean | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "foldAttrViewGroups"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: Record<string, boolean> | null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "syncAttrViewTableColWidth"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "removeAttrViewGroup"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": "sortAttrViewGroup"; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: null; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: null; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; } | { "action": UnknownTransactionAction; "avID"?: string | null; "backRelationKeyID"?: string | null; "blockID"?: string | null; "blockIDs"?: Array<string> | null; "cellUpdates"?: Array<TransactionCellUpdateInput | null> | null; "context"?: TransactionContext | null; "data"?: JSONValue; "deckID"?: string | null; "format"?: string | null; "groupID"?: string | null; "id"?: string | null; "ignoreDefaultFill"?: boolean | null; "isDetached"?: boolean | null; "isTwoWay"?: boolean | null; "keyID"?: string | null; "layout"?: string | null; "name"?: string | null; "nextID"?: string | null; "parentID"?: string | null; "previousID"?: string | null; "removeDest"?: boolean | null; "retData"?: JSONValue; "rootID"?: string | null; "rowID"?: string | null; "srcIDs"?: Array<string> | null; "srcs"?: Array<TransactionSourceFieldsInput | null> | null; "targetGroupID"?: string | null; "type"?: "" | "block" | "text" | "number" | "date" | "select" | "mSelect" | "url" | "email" | "phone" | "location" | "mAsset" | "template" | "created" | "updated" | "checkbox" | "relation" | "rollup" | "lineNumber"; "viewID"?: string | null; "viewIDs"?: Array<string> | null; };

export type TransactionOptionChangeInput = { "newColor": string; "newDesc": string; "newName": string; "oldColor"?: string | null; "oldName": string; };

export type TransactionOptionDescriptionInput = { "desc": string; "name": string; };

export type TransactionReplacedItem = { "duplicate": boolean; "targetItemID": string; };

export type TransactionReplacedItemInput = { "duplicate": boolean; "targetItemID": string; };

export type TransactionRollupInput = { "calc"?: AVRollupCalcInput | null; };

export type TransactionSourceFieldsInput = { "content"?: string | null; "id"?: string | null; "isDetached"?: boolean | null; "itemID"?: string | null; };

export type TransactionUndoState = { "canRedo": boolean; "canUndo": boolean; "peekMutatedRootIDs": Array<string> | null; };

export type TransactionUndoStateRequestInput = { "rootID": string; };

export type TransferBlockRefRequestInput = { "fromID": string; "refIDs"?: Array<string> | null; "reloadUI"?: boolean | null; "toID": string; };

export type TreeStatData = { "containsEmbed"?: boolean; "embedStat"?: EmbedStat | null; "reqId": JSONValue; "stat": BlockStat | null; "statWithEmbed"?: BlockStat | null; };

export type TreeStatRequestInput = { "id": string; "ids"?: Array<string> | null; "includeEmbed"?: boolean | null; "notebook"?: string | null; "reqId"?: JSONValue | null; };

export type TrimmedIDRequestInput = { "id": string; };

export type UnavailableAssetAttributeView = { "avID": string; "blockID": string; "hPath": string; "notebook": string; "notebookName": string; "path": string; "reason": string; "rootID": string; };

export type UnfoldedParentData = { "parentID": string; };

export type UninstallBazaarIconRequestInput = { "keyword"?: string | null; "packageName": string; };

export type UninstallBazaarPluginRequestInput = { "frontend"?: string | null; "keyword"?: string | null; "packageName": string; };

export type UninstallBazaarTemplateRequestInput = { "keyword"?: string | null; "packageName": string; };

export type UninstallBazaarThemeRequestInput = { "frontend"?: string | null; "keyword"?: string | null; "packageName": string; };

export type UninstallBazaarWidgetRequestInput = { "keyword"?: string | null; "packageName": string; };

export type UnknownTransactionAction = string & { readonly __unknownTransactionAction: unique symbol };

export type UnlockNotebookRequestInput = { "notebook": string; "password": string; };

export type UnusedAssetsRequestInput = { "all"?: boolean | null; "keyword"?: string | null; };

export type UnzipRequestInput = { "path": string; "zipPath": string; };

export type UpdateBazaarPackageRequestInput = { "frontend": string; "keyword"?: string | null; "packageName": string; "packageType": string; };

export type UpdateBlockRequestInput = { "data": string; "dataType": string; "id": string; "lockType"?: boolean | null; };

export type UpdateChannelRequestInput = { "updateChannel": string; };

export type UpdateEmbedBlockRequestInput = { "content": string; "id": string; };

export type UpdatePinnedDocsRequestInput = { "action": string; "after"?: boolean; "ids": Array<string>; "targetID"?: string; };

export type UploadAssetRequestInput = { "assetsDirPath"?: string; "file[]"?: Array<Blob>; "id"?: string; };

export type UploadCloudSnapshotRequestInput = { "id": string; "tag": string; };

export type ViewStatePatchRequestInput = { "key": string; "removeKeys"?: Array<string> | null; "values"?: { [key: string]: JSONValue }; };

export type VirtualBlockRefRequestInput = { "keywords": Array<string>; };

export type WPSPresentationData = { "converted": boolean; "dom": string; };

export type WPSPresentationRequestInput = { "data": string; "text"?: string | null; "type": string; };

export type WordCountData = { "reqId": JSONValue; "stat": BlockStat | null; };

export type WorkspaceAVBuiltinColorUpdateInput = { "customized"?: boolean | null; "dark"?: InlineStyleThemeInput | null; "hidden"?: boolean | null; "index"?: number | null; "light"?: InlineStyleThemeInput | null; };

export type WorkspaceAVPaletteRequestInput = { "app"?: string | null; "builtinColors"?: Array<WorkspaceAVBuiltinColorUpdateInput | null> | null; "colors": Array<AttributeViewCustomColorInput | null>; "order": Array<string>; };

export type WorkspaceInfoData = { "siyuanVer": string; "workspaceDir": string; };

export type WorkspaceStorageData = { "assetsSize": number; "calculatedAt": number; "directories": Array<WorkspaceStorageEntry>; "totalSize": number; };

export type WorkspaceStorageEntry = { "name": "data" | "repo" | "history" | "temp" | "conf" | "other"; "size": number; };

export type ZipRequestInput = { "path": string; "zipPath": string; };

export interface APIGETRoutes {
    "/.well-known/oauth-authorization-server": {
        request: EmptyRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
        output: "binary";
        contentVariants: [{"status":200,"contentType":"application/json"},{"status":400,"contentType":"application/json"},{"status":401,"contentType":"application/json"},{"status":404,"contentType":"application/json"},{"status":429,"contentType":"application/json"},{"status":500,"contentType":"application/json"}];
    };
    "/.well-known/oauth-protected-resource": {
        request: EmptyRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
        output: "binary";
        contentVariants: [{"status":200,"contentType":"application/json"},{"status":400,"contentType":"application/json"},{"status":401,"contentType":"application/json"},{"status":404,"contentType":"application/json"},{"status":429,"contentType":"application/json"},{"status":500,"contentType":"application/json"}];
    };
    /**
     * MCP OAuth 协议入口返回标准 OAuth JSON 或授权页面，不使用内核结果信封。
     */
    "/.well-known/oauth-protected-resource/mcp": {
        request: EmptyRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
        output: "binary";
        contentVariants: [{"status":200,"contentType":"application/json"},{"status":400,"contentType":"application/json"},{"status":401,"contentType":"application/json"},{"status":404,"contentType":"application/json"},{"status":429,"contentType":"application/json"},{"status":500,"contentType":"application/json"}];
    };
    "/api/ai/mcp/oauth/callback/:flowID": {
        request: EmptyRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
        output: "binary";
        contentVariants: [{"status":200,"contentType":"text/html"},{"status":400,"contentType":"text/html"},{"status":403,"contentType":"text/plain"}];
    };
    /**
     * 从 URL 查询参数读取 type、color、date、lang、weekdayType、content 和 id，不读取请求体。
     * type 默认 1，lang 默认内核语言，weekdayType 默认 1；文字图标（type=8）跟随全局字体列表和首选字重。
     * 日期类图标使用内置字体和常规字重；未配置全局字体时使用内置列表，缺失字体由客户端继续回退。
     */
    "/api/icon/getDynamicIcon": {
        request: EmptyRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
        output: "binary";
        emptyResponseStatuses: [500];
        contentVariants: [{"status":200,"contentType":"image/svg+xml"}];
    };
    /**
     * URL、TLS 和 Cookie 诊断对象包含标准库的原始 JSON。
     * 已声明字段及其类型保持稳定；工具链新增的诊断字段通过 JSONValue 索引读取，不保证跨版本存在。
     */
    "/api/network/echo": {
        request: Blob;
        response: { "code": 0; "data": NetworkEchoData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "raw";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * URL、TLS 和 Cookie 诊断对象包含标准库的原始 JSON。
     * 已声明字段及其类型保持稳定；工具链新增的诊断字段通过 JSONValue 索引读取，不保证跨版本存在。
     */
    "/api/network/echo/*path": {
        request: Blob;
        response: { "code": 0; "data": NetworkEchoData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "raw";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/network/proxy": {
        request: Blob;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "raw";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
        output: "proxy";
        proxy: {"kind":"http","contentType":"application/octet-stream","upstreamStatuses":true};
    };
    "/api/plugin": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<LoadedPlugin | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/plugin/rpc": {
        request: LoadedPluginRequestInput;
        response: { "code": 0; "data": LoadedPlugin | null; "msg": string; } | { "code": -1 | 1 | 2 | 3 | 4; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/plugin/rpc/:name": {
        request: LoadedPluginRequestInput;
        response: { "code": 0; "data": LoadedPlugin | null; "msg": string; } | { "code": -1 | 1 | 2 | 3 | 4; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/system/bootProgress": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": BootProgressData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
    };
    "/api/system/bootProgressSSE": {
        request: EmptyRequestInput;
        response: string | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
        output: "sse";
        sse: { events: { "": BootProgressData; }; };
    };
    "/api/system/getBootAppearance": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SettingBootAppearance | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
        emptyResponseStatuses: [403];
    };
    "/api/system/getCaptcha": {
        request: EmptyRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
        output: "binary";
        emptyResponseStatuses: [500];
        contentVariants: [{"status":200,"contentType":"image/png"}];
    };
    /**
     * 无需登录，仅返回已启用的单张壁纸，不接受文件路径或笔记本参数。
     * 成功返回 image/jpeg 且禁止缓存；未启用、文件缺失或不可读时返回无正文的 404，认证页保留默认背景。
     */
    "/api/system/getLockScreenWallpaper": {
        request: EmptyRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
        output: "binary";
        emptyResponseStatuses: [404];
        contentVariants: [{"status":200,"contentType":"image/jpeg"}];
    };
    /**
     * 从 URL 查询参数读取 state、code 和 error，验证登录事务及会话绑定，不读取请求体。
     */
    "/api/system/oidc/callback": {
        request: EmptyRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
        output: "binary";
        contentVariants: [{"status":200,"contentType":"text/html"}];
    };
    "/api/system/version": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
    };
    "/es/broadcast/subscribe": {
        request: EmptyRequestInput;
        response: string | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
        output: "sse";
        sse: { raw: {"eventNames":"dynamic","dataEncoding":"raw","id":true,"retry":true}; };
    };
    "/es/network/proxy": {
        request: EmptyRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
        output: "proxy";
        proxy: {"kind":"eventSource","contentType":"text/event-stream","upstreamStatuses":true};
    };
    "/oauth/mcp/authorize": {
        request: EmptyRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
        output: "binary";
        contentVariants: [{"status":200,"contentType":"text/html"},{"status":302,"contentType":"text/html"},{"status":400,"contentType":"text/html"}];
    };
    "/plugin/private/:name/*path": {
        request: Blob;
        response: Blob | JSONValue | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "raw";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
        output: "pluginService";
        pluginService: {"variants":[{"mode":"JSON","statusPolicy":"plugin","mediaTypes":["application/json"],"payload":"json","headersOverrideMedia":true},{"mode":"JSONP","statusPolicy":"plugin","mediaTypes":["application/javascript","application/json"],"payload":"jsonp-or-json","headersOverrideMedia":true},{"mode":"AsciiJSON","statusPolicy":"plugin","mediaTypes":["application/json"],"payload":"json","headersOverrideMedia":true},{"mode":"IndentedJSON","statusPolicy":"plugin","mediaTypes":["application/json"],"payload":"json","headersOverrideMedia":true},{"mode":"PureJSON","statusPolicy":"plugin","mediaTypes":["application/json"],"payload":"json","headersOverrideMedia":true},{"mode":"SecureJSON","statusPolicy":"plugin","mediaTypes":["application/json"],"payload":"secure-json","headersOverrideMedia":true},{"mode":"XML","statusPolicy":"plugin","mediaTypes":["application/xml"],"payload":"xml","headersOverrideMedia":true},{"mode":"YAML","statusPolicy":"plugin","mediaTypes":["application/yaml"],"payload":"yaml","headersOverrideMedia":true},{"mode":"TOML","statusPolicy":"plugin","mediaTypes":["application/toml"],"payload":"toml","headersOverrideMedia":true},{"mode":"ProtoBuf","statusPolicy":"plugin","mediaTypes":["application/x-protobuf"],"payload":"protobuf","headersOverrideMedia":true},{"mode":"file","statusPolicy":"file","mediaTypes":["dynamic"],"payload":"bytes","headersOverrideMedia":true},{"mode":"string","statusPolicy":"plugin","mediaTypes":["text/plain"],"payload":"text","headersOverrideMedia":true},{"mode":"raw","statusPolicy":"plugin","mediaTypes":["dynamic"],"payload":"bytes","headersOverrideMedia":true},{"mode":"stream","statusPolicy":"plugin","mediaTypes":["dynamic"],"payload":"bytes","headersOverrideMedia":true},{"mode":"redirect","statusPolicy":"redirect","mediaTypes":["text/html"],"payload":"redirect","headersOverrideMedia":true},{"mode":"proxy","statusPolicy":"proxy","mediaTypes":["upstream"],"payload":"bytes","headersOverrideMedia":true},{"mode":"empty","statusPolicy":"plugin","mediaTypes":["optional"],"payload":"none","headersOverrideMedia":true},{"mode":"websocket","statusPolicy":"websocket","mediaTypes":["upgrade-or-text"],"payload":"frames","headersOverrideMedia":false},{"mode":"sse","statusPolicy":"sse","mediaTypes":["text/event-stream"],"payload":"events","headersOverrideMedia":false},{"mode":"admission","statusPolicy":"admission","mediaTypes":["text/plain"],"payload":"text","headersOverrideMedia":true}],"admissionStatuses":[400,404,500,503],"webSocketFrames":["text","binary","close","ping","pong"],"sseEventNames":"dynamic","sseData":"json-or-text","sseEvent":{"type":"object","properties":{"data":{"$ref":"#/$defs/JSONValue"},"event":{"type":"string"},"id":{"type":"string"},"retry":{"type":"integer"}},"required":["data"],"additionalProperties":false}};
    };
    "/ws/broadcast": {
        request: EmptyRequestInput;
        response: null | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
        output: "websocket";
        websocket: { incoming: Blob; outgoing: Blob; failureStatus: 0; raw: {"frames":[1,2,8,9,10],"upgradeErrorStatuses":[400,403,405,500],"emptyClosedResponse":true}; };
    };
    "/ws/network/proxy": {
        request: EmptyRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
        output: "proxy";
        proxy: {"kind":"websocket","upstreamStatuses":false,"frames":["text","binary","close"]};
    };
    /**
     * RPC 握手保留写权限检查，但不跨空闲连接持有工作空间写入租约。实际方法与通知各自
     * 取得租约；同步应用、导入提交、只读或恢复失败时不进入脚本。调用失败沿用 JSON-RPC
     * 内部错误（-32603），通知仍不回复；等待者取消后，未完成的方法继续保留租约。
     */
    "/ws/plugin/rpc": {
        request: EmptyRequestInput;
        response: (PluginRPCFailure & { "code"?: never; "data"?: never; "msg"?: never; }) | ({ "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; } & { "error"?: never; "id"?: never; "jsonrpc"?: never; });
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
        output: "websocket";
        websocket: { incoming: PluginRPCRequestFieldsInput | [PluginRPCRequestFieldsInput, ...Array<PluginRPCRequestFieldsInput>]; outgoing: (PluginRPCSuccess & { "error"?: never; "method"?: never; "params"?: never; }) | (PluginRPCFailure & { "method"?: never; "params"?: never; "result"?: never; }) | [(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; }), ...Array<(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; })>] | (PluginRPCNotification & { "error"?: never; "id"?: never; "result"?: never; }); failureStatus: 404; };
    };
    /**
     * 与查询参数形式使用相同的握手和逐方法写入准入规则。
     */
    "/ws/plugin/rpc/:name": {
        request: EmptyRequestInput;
        response: (PluginRPCFailure & { "code"?: never; "data"?: never; "msg"?: never; }) | ({ "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; } & { "error"?: never; "id"?: never; "jsonrpc"?: never; });
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
        output: "websocket";
        websocket: { incoming: PluginRPCRequestFieldsInput | [PluginRPCRequestFieldsInput, ...Array<PluginRPCRequestFieldsInput>]; outgoing: (PluginRPCSuccess & { "error"?: never; "method"?: never; "params"?: never; }) | (PluginRPCFailure & { "method"?: never; "params"?: never; "result"?: never; }) | [(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; }), ...Array<(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; })>] | (PluginRPCNotification & { "error"?: never; "id"?: never; "result"?: never; }); failureStatus: 404; };
    };
}

export interface APIPOSTRoutes {
    "/api/account/checkActivationcode": {
        request: CheckActivationCodeRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/account/deactivate": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/account/login": {
        request: AccountLoginRequestInput;
        response: { "code": 0; "data": AccountLoginData | null; "msg": string; } | { "code": -1 | 1 | 10; "data": { "closeTimeout": number; } | null | AccountLoginData | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/account/startFreeTrial": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/account/useActivationcode": {
        request: ActivationCodeRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ai/agent/browserCapabilityResult": {
        request: AIBrowserCapabilityResultRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
        additionalErrorStatuses: [409];
    };
    /**
     * gemini-interactions 使用 store=false 和本地会话历史，nativeContent 版本 1 保留完整原生步骤及思考签名。
     * 未知原生版本保留原会话并报错；缺失终止事件、失败或不完整的响应不会执行工具调用。
     */
    "/api/ai/agent/chat": {
        request: AIAgentChatRequestInput;
        response: string | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
        output: "sse";
        additionalErrorStatuses: [409];
        sse: { events: { "browser_capability_call": AISSEBrowserCapabilityCall; "confirm": AISSEConfirm; "content": AISSEToken; "done": AISSETurn; "error": AISSEMessage; "interrupted": AISSEMessage; "permission": AIPermissionData; "question": AISSEQuestion; "reasoning": AISSEToken; "retry": AISSERetry; "snapshot": AISSESnapshot; "thinking": AISSEThinking; "tool_call": AISSEToolCall; "tool_result": AISSEToolResult; "turn": AISSETurn; "usage": AISSEUsage; }; };
    };
    "/api/ai/agent/confirm": {
        request: AIConfirmRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
        additionalErrorStatuses: [409];
    };
    /**
     * 返回工作空间 data/storage/ai/AGENTS.md 的 content 和 revision，要求管理员权限。
     * 兼容读取旧路径 data/ai/AGENTS.md，读取不迁移；两处内容不同时返回 code=-1，保留两份文件并提示合并。
     * 缺失文件返回空 content 和 missing 修订，不创建文件；非 UTF-8 文本、超出 32 KiB 或读取失败返回 code=-1。
     */
    "/api/ai/agent/getInstructions": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": AIAgentInstructionsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 会话保留扩展字段。图片附件只持久化来源元数据，不包含图片字节。
     * PDF 预览附件的 path 指向来源 PDF，pdfImage 记录 revision、page 和 object；恢复时认证读取来源并校验版本。
     */
    "/api/ai/agent/getSession": {
        request: AISessionIDRequestInput;
        response: { "code": 0; "data": AISessionExtensionAISessionFields | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
        additionalErrorStatuses: [500];
    };
    "/api/ai/agent/getSkill": {
        request: AISkillNameRequestInput;
        response: { "code": 0; "data": AISkillData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 独立于斜杠菜单的普通技能发现，只返回只读元数据，包括已禁用条目。
     */
    "/api/ai/agent/lsBuiltinSkills": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<AIBuiltinSkillInfo> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * Filter by title, then paginate sessions with pinned entries first, ordered by pinnedAt descending.
     * Unpinned sessions retain createdAt descending order; equal timestamps use descending session IDs.
     * Missing pinnedAt in older sessions means unpinned. Pinning survives index reconstruction.
     */
    "/api/ai/agent/lsSessions": {
        request: AISessionsRequestInput;
        response: { "code": 0; "data": AISessionList; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/ai/agent/lsSkills": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<AISkillInfo> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/ai/agent/lsUserSkills": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<AIUserSkillInfo> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 使用严格字符串字段，通过管理员和只读检查管理工作空间技能文件。相对路径标识实际目录，
     * 与文件头中的技能名称无关，允许普通的点开头名称。读写支持不超过 8 MiB 的 UTF-8 文本，
     * 不依赖扩展名并保留原文字节。目录和资源读取保留基于内容的版本；不支持编辑的内容省略 content，
     * 并增加可选的 readOnlyReason（binary、encoding 或 tooLarge）。
     * 修改已有文件时重新校验内容并要求当前版本，与旧技能修改接口和安装共享临界区，成功后通知同步。
     * 路径穿越、平台别名、链接、过期版本，以及单独修改不支持的内容或重命名、删除根 SKILL.md 均被拒绝。
     */
    "/api/ai/agent/manageSkills": {
        request: AISkillFileRequestInput;
        response: { "code": 0; "data": AISkillFileData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ai/agent/question": {
        request: AIQuestionRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
        additionalErrorStatuses: [409];
    };
    "/api/ai/agent/removeSession": {
        request: AISessionIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
        additionalErrorStatuses: [409,500];
    };
    "/api/ai/agent/removeSkill": {
        request: AISkillNameRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ai/agent/renameSkill": {
        request: AISkillRenameRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * Save conversation content with revision checks. The stored pinnedAt is preserved regardless of the
     * submitted snapshot; clients must use setPinned to update list pinning independently of active turns.
     */
    "/api/ai/agent/saveSession": {
        request: AISessionExtensionAISessionFieldsInput;
        response: { "code": 0; "data": AISessionSaveData; "msg": string; } | { "code": -1; "data": ({ "closeTimeout": number; } & { "revision"?: never; "session"?: never; }) | null | (AISessionSaveData & { "closeTimeout"?: never; }); "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
        additionalErrorStatuses: [400,409,500];
    };
    "/api/ai/agent/saveSkill": {
        request: AISkillSaveRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 接收 content 和读取时的 revision，要求管理员权限且禁止只读写入。
     * 内容允许为空；修订冲突返回 code=-1 并保留原文。保存采用原子替换，并按工作空间同步忽略规则通知同步。
     * 首次保存迁移旧路径 data/ai/AGENTS.md，先持久化原文到新路径再移除旧文件；旧路径的忽略规则需在保存前更新。
     * 指令在下一轮用户对话生效，同轮工具调用和压缩使用固定快照，且不能覆盖工具权限、审批或访问控制。
     */
    "/api/ai/agent/setInstructions": {
        request: AIAgentInstructionsSaveRequestInput;
        response: { "code": 0; "data": AIAgentInstructionsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ai/agent/setPermission": {
        request: AIPermissionRequestInput;
        response: { "code": 0; "data": AIPermissionData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * Persist pinning for an existing session. Requires administrator write access.
     * pinned is a required boolean. Repeated pin requests preserve the original millisecond timestamp;
     * unpinning returns pinnedAt=0. Missing or corrupt sessions fail without replacing their data.
     * Pinning does not change conversation revisions, timestamps or active turns; stale saveSession requests cannot overwrite it.
     */
    "/api/ai/agent/setPinned": {
        request: AISessionPinnedRequestInput;
        response: { "code": 0; "data": AISessionPinnedData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ai/agent/title": {
        request: AITitleRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/ai/chatGPT": {
        request: AIMessageRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/ai/chatGPTWithAction": {
        request: AIActionRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 套餐授权接口仅供已鉴权管理员使用，遵守 AI 禁用开关及只读限制。
     * 账户列表只返回身份及连接状态；令牌保存在主机私有目录，配置仅保存账户 ID。
     */
    "/api/ai/chatgpt/accounts": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<ChatGPTAccount>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/ai/chatgpt/cancel": {
        request: ChatGPTLoginRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 导出使用至少 12 个字符的密码，先写入带版本的认证加密文件，再停止源主机刷新。
     */
    "/api/ai/chatgpt/export": {
        request: ChatGPTTransferRequestInput;
        response: { "code": 0; "data": ExportFileData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 导入限制为 1 MiB，认证文件和账户身份后续期；失败保留账户及目标主机标识。
     */
    "/api/ai/chatgpt/import": {
        request: ChatGPTTransferRequestInput;
        response: { "code": 0; "data": ChatGPTAccount; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 退出清除本地令牌并保留账户映射；revoked 表示远程撤销是否确认成功。
     */
    "/api/ai/chatgpt/logout": {
        request: ChatGPTAccountRequestInput;
        response: { "code": 0; "data": ChatGPTLogoutResult; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 删除指定的本机账户注册并终止其请求及登录尝试，不合并同邮箱注册；不修改提供商配置或主机 ID。
     * 先尝试撤销会话，远程撤销未确认时仍清除本地记录并返回 revoked=false；缺失账户报错。
     */
    "/api/ai/chatgpt/remove": {
        request: ChatGPTAccountRequestInput;
        response: { "code": 0; "data": ChatGPTLogoutResult; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 登录地址可能包含身份提示，客户端不得记录；回调使用独立的 IPv4 回环监听器。
     */
    "/api/ai/chatgpt/start": {
        request: ChatGPTAccountRequestInput;
        response: { "code": 0; "data": ChatGPTLogin; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ai/chatgpt/status": {
        request: ChatGPTLoginRequestInput;
        response: { "code": 0; "data": ChatGPTLoginStatus; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/ai/editor/chat": {
        request: AIEditorChatRequestInput;
        response: string | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
        output: "sse";
        sse: { events: { "content": AISSEToken; "done": AISSEFinish; "error": AISSEMessage; "reasoning": AISSEToken; "start": AISSEStart; "truncated": AISSEMessage; }; };
    };
    "/api/ai/editor/lsActions": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<AIEditorAction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/ai/editor/removeAction": {
        request: AIEditorActionIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ai/editor/saveAction": {
        request: AIEditorActionSaveRequestInput;
        response: { "code": 0; "data": AIEditorAction | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ai/embeddingStat": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": AIEmbeddingStat | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 按提供商协议读取模型及上下文上限；gemini-interactions 使用原生模型清单并去除 models/ 前缀。
     */
    "/api/ai/listModels": {
        request: AIProviderRequestInput;
        response: { "code": 0; "data": AIModelsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/ai/lsCapabilities": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<AICapabilityManifest> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/ai/mcpEnvironmentVariables": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": AIMCPEnvironmentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/ai/mcpOAuthAuthorize": {
        request: AIMCPIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ai/mcpOAuthDisconnect": {
        request: AIMCPIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ai/mcpStatus": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<AIMCPStatus> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 手动调用设备选择的 OCR AI 模型识别本地 assets/ 图片，不使用会话、工具。
     * 未保存独立模型且本地提供商仍被选中时兼容智能体模型；显式模型失效时返回错误，不回退。
     * path 保留 box 查询参数以隔离笔记本资源；拒绝加密资源和外部图片地址。
     * 支持 PNG、JPEG、GIF、WebP，并将 BMP、TIFF 转为 PNG、HEIC/HEIF 转为 JPEG；其他格式返回错误。
     * 保留原图分辨率，原始文件和发送图片均限制为 20 MiB、发送图片限制为四千万像素；HEIF 遵循预览解码限制。
     * 支持现有 AI 生成协议，受 AI 功能开关、管理员权限和只读模式限制。
     * 请求上限为两分钟，提供商配置的更短超时仍生效；模型不支持图片时返回错误，不降级为纯文本请求。
     * 成功将完整文本（含换行和空白，图片无文字时可为空）保存到现有 OCR 存储并更新索引。
     * 失败、取消、拒绝或截断时保留已有文本；不返回虚构的坐标和置信度。
     */
    "/api/ai/ocr": {
        request: AssetPathRequestInput;
        response: { "code": 0; "data": AssetTextData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ai/reindexEmbedding": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ai/retryFailedEmbedding": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 用固定的 TypeSafe System One 样例测试已保存的可选 ai.decision 配置，返回 {matched, msg?}。
     * 遵循全局人工智能禁用标记和请求取消，配置错误与供应商错误不会被转换为判断结果。
     * 省略决策配置时补齐默认关闭的配置，关闭后保留密钥，并沿用现有配置加密存储机制。
     */
    "/api/ai/testDecisionModel": {
        request: AIDecisionTestRequestInput;
        response: { "code": 0; "data": AIDecisionTestData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/ai/testEmbeddingModel": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": AIEmbeddingTestData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 按提供商协议验证实际生成能力，模型清单命中本身不代表测试通过。
     * gemini-interactions 使用原生端点、store=false 和有限输出预算，必须收到已校验的流式终止事件。
     * 测试允许无上游错误且不含工具调用的 incomplete 响应，避免思考耗尽测试预算导致误判；正常生成仍报错。
     */
    "/api/ai/testModel": {
        request: AIModelRequestInput;
        response: { "code": 0; "data": AIModelTestData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/ai/testRerankModel": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": AIRerankTestData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 在隔离目录解压并预检完整输出集合的能力记录及文档源，失败时不写入目标。
     * 实际复制仍重新检查目标；后续并发变化或 I/O 失败可能留下已完成条目，不承诺整批回滚。
     */
    "/api/archive/unzip": {
        request: UnzipRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 的输出位置遵守笔记本能力及原始文档保护，不能用压缩文件覆盖文档源或能力记录。
     */
    "/api/archive/zip": {
        request: ZipRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 取消会话并释放在途转换资源，已完成的缓存仍可在下一次播放时复用。
     */
    "/api/asset/cancelLivePhotoPreview": {
        request: LivePhotoPreviewRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/asset/findAssetReferences": {
        request: FindAssetReferencesRequestInput;
        response: { "code": 0; "data": AssetReferencesData; "msg": string; } | { "code": -1; "data": ({ "closeTimeout": number; } & { "dryRun"?: never; "historyPath"?: never; "items"?: never; "references"?: never; "skippedNotebooks"?: never; "unavailableAttributeViews"?: never; "updated"?: never; }) | null | (AssetReferencesData & { "closeTimeout"?: never; }); "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 提交大端 uint32 帧数，随后逐帧提交大端 uint32 长度及 Annex B 数据；最多 64 MiB，帧数和尺寸必须匹配源片。
     * 验证并等待 MP4 封装完成后返回；失败结果不能进入共享缓存。
     */
    "/api/asset/finishLivePhotoPreview": {
        request: FinishLivePhotoPreviewRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 提交异步重建任务，成功响应只代表任务已提交，不代表索引已经完成。
     * 重建遍历及最后一批索引写入成功后，通过主 WebSocket 发送 assetContentIndexCompleted 并提示完成；
     * 遍历或写入失败时提示失败，不发送完成事件。不支持或解析失败的文件会跳过，加密资源不进入全局索引。
     */
    "/api/asset/fullReindexAssetContent": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/asset/getDocAssets": {
        request: AssetDocumentAssetsRequestInput;
        response: { "code": 0; "data": Array<string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/asset/getDocImageAssets": {
        request: AssetDocumentRequestInput;
        response: { "code": 0; "data": Array<string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 返回文档图片及各自关联的实况照片原始视频；保留图片顺序，不合并相同封面。
     */
    "/api/asset/getDocPreviewImages": {
        request: AssetDocumentRequestInput;
        response: { "code": 0; "data": Array<DocumentPreviewImage> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/asset/getFileAnnotation": {
        request: AssetPathRequestInput;
        response: { "code": 0; "data": AssetAnnotationData; "msg": string; } | { "code": -1 | 1 | 403; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 保留已有 text 字段；无文本、缺失 path 和加密资源返回空字符串。
     * failed 来自实际识别失败，不由空文本推断；取消和不支持的图片不记为失败。
     * 失败状态仅在当前内核运行期间保留最近 1024 个资源，成功识别或保存文本后清除，不写入 OCR 数据文件。
     * 加密资源始终返回 failed=false；笔记本资源身份保留 box 参数，显示参数和片段不改变状态身份。
     */
    "/api/asset/getImageOCRText": {
        request: AssetOCRTextRequestInput;
        response: { "code": 0; "data": ImageOCRTextData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 顺序读取零起始的 I420 帧，响应为 no-store 的二进制；错误返回 HTTP 422 的标准 JSON 信封。
     */
    "/api/asset/getLivePhotoFrame": {
        request: LivePhotoFrameRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
        output: "binary";
    };
    /**
     * 等待并读取 MP4 兼容预览，响应为 no-store 的二进制；错误返回 HTTP 422 的标准 JSON 信封。
     */
    "/api/asset/getLivePhotoPreview": {
        request: LivePhotoPreviewRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
        output: "binary";
    };
    /**
     * 扫描已打开笔记本中的丢失资源，成功时返回列表（无丢失资源时为空数组）。
     * 资源清单读取、笔记本枚举、目录遍历失败或 panic 时返回 code -1、data null。
     * 单篇文档无法读取时继续扫描其他文档，最终也返回 code -1，msg 包含被跳过的路径，不发布不完整的列表。
     * 保留管理员鉴权和加密笔记本请求租约，不改变资源存在性判定或任何持久化格式。
     */
    "/api/asset/getMissingAssets": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<AssetUnusedItem | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/asset/getOCRConfig": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": OCRConfigData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 扫描失败返回标准错误，不将失败表示为成功的空列表。
     * keyword 可省略、为 null 或空白；非空时按完整文件名进行不区分大小写的字面量包含匹配。
     * 完整未引用扫描后先筛选再截断，最多返回 512 项；空请求体按截断返回。
     * all 为 true 时返回完整清单且不发送截断提示，供前端在当前面板内过滤；省略、null 或 false 保留截断行为。
     * 可选请求头 X-SiYuan-App-ID 将截断提示限定到对应前端，未提供时保留广播行为。
     */
    "/api/asset/getUnusedAssets": {
        request: UnusedAssetsRequestInput;
        response: { "code": 0; "data": Array<AssetUnusedItem | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "legacyOptional";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 扫描单个已解锁加密笔记本的文档、全部数据库定义及智能体会话引用。
     * 任意扫描失败返回 -1，不返回不完整候选。锁定目标使用既有 314 语言消息；结果不截断。
     * name 为响应期间可见的原始文件名，item 为 assets 相对路径，path 带目标 box 查询参数。
     */
    "/api/asset/getUnusedEncryptedBoxAssets": {
        request: EncryptedBoxAssetsRequestInput;
        response: { "code": 0; "data": Array<AssetUnusedItem | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/asset/importOCRModels": {
        request: ImportOCRModelsRequestInput;
        response: { "code": 0; "data": OCRModel; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/asset/insertCover": {
        request: InsertCoverRequestInput;
        response: { "code": 0; "data": AssetInsertCoverData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/asset/insertLocalAssets": {
        request: InsertLocalAssetsRequestInput;
        response: { "code": 0; "data": AssetUploadData; "msg": string; } | { "code": -1; "data": ({ "closeTimeout": number; } & { "errFiles"?: never; "failedFiles"?: never; "succFiles"?: never; "succMap"?: never; }) | null | (AssetUploadData & { "closeTimeout"?: never; }); "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 始终使用当前设备选择的提供商，内核可在无界面的环境中识别。
     * ai 使用设备保存的 aiModelId，返回原样文本和空 ocrJSON，不虚构坐标；本地提供商保持 TSV 数据。
     * 不自动回退到另一提供商；取消、模型或推理错误不覆盖已有文本，加密笔记本不参与 OCR。
     */
    "/api/asset/ocr": {
        request: AssetPathRequestInput;
        response: { "code": 0; "data": AssetOCRData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 实际重链接成功写盘后清理文档及关联跨文档撤销记录；预览和写入失败不清理历史。
     */
    "/api/asset/relinkAsset": {
        request: RelinkAssetRequestInput;
        response: { "code": 0; "data": AssetReferencesData; "msg": string; } | { "code": -1; "data": ({ "closeTimeout": number; } & { "dryRun"?: never; "historyPath"?: never; "items"?: never; "references"?: never; "skippedNotebooks"?: never; "unavailableAttributeViews"?: never; "updated"?: never; }) | null | (AssetReferencesData & { "closeTimeout"?: never; }); "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * path 为 data 相对资源路径，普通资源须通过完整未引用扫描。
     * 全局 assets/android-notification-texts.txt 普通文件允许显式删除以关闭 Android 保活通知，无需未引用扫描。
     * 目录和符号链接不能使用该例外；删除前保存资源历史并触发同步。
     * 该文件不出现在 getUnusedAssets 中，也不被 removeUnusedAssets 批量清理。
     */
    "/api/asset/removeUnusedAsset": {
        request: AssetPathRequestInput;
        response: { "code": 0; "data": AssetPathData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 未引用资源扫描失败时返回标准错误，禁止使用不完整的引用集合清理资源。
     */
    "/api/asset/removeUnusedAssets": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": AssetPathsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 重新验证用户确认的候选，备份认证后的原始密文后整批删除。
     * 失败补偿恢复源文件，未提交的中断批次在启动同步前恢复；清理历史只索引脱敏元数据。
     * 不改变现有全局清理行为，不修改加密格式，不生成全局资源索引或明文缓存。
     */
    "/api/asset/removeUnusedEncryptedBoxAssets": {
        request: RemoveEncryptedBoxAssetsRequestInput;
        response: { "code": 0; "data": AssetPathsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 重命名普通笔记本资源，并同步字面量及百分号编码的文档、数据库引用。
     * 引用及成功返回的 data.newPath 保留查询参数和片段；源资源解析失败返回 code=-1 和 5000 毫秒错误提示。
     * 拒绝加密笔记本资源重命名；空名称或与原文件名相同的名称返回 code=0、data.newPath=""。
     */
    "/api/asset/renameAsset": {
        request: RenameAssetRequestInput;
        response: { "code": 0; "data": AssetRenameData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 返回普通资源路径；已解锁的加密资源返回保留原始名称的受管临时明文副本路径。
     * 请求持有加密笔记本租约直至响应序列化完成，外部编辑不写回加密源数据。
     */
    "/api/asset/resolveAssetPath": {
        request: AssetPathRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 保存 PDF 标注映射。省略 baseData 或传 null 保持旧版整份替换语义。
     * 提供 baseData 时，将 data 相对该读取基线的逐条变化合并到当前映射，保留其他查看器对不同标注的修改。
     * 同一标注已被不同内容修改或删除时返回 -1 / "annotation revision conflict"，不写入文件；重复的相同结果可成功。
     * 基线和 data 必须为 JSON 对象字符串；加密笔记本先认证当前密文，租约和文件格式保持不变。
     */
    "/api/asset/setFileAnnotation": {
        request: SetAssetAnnotationRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/asset/setImageOCRText": {
        request: SetAssetOCRTextRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/asset/setOCRConfig": {
        request: SettingOCRInput;
        response: { "code": 0; "data": SettingOCR; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 按需生成 H.264/AAC 兼容预览，不修改原件，不同步缓存；输入限制为 64 MiB、十秒、600 帧和 4096×2160 像素。
     * path 为相对资源 URL，路径中的百分号编码只解码一次，box 等查询参数保持原有资源解析语义。
     * 普通资源的真实路径必须位于对应 assets 目录内；加密资源沿用 box 边界校验与解锁租约。
     * 支持 SDR HEVC 4:2:0（8/10 位）或 AVC，以及 AAC 或 44.1/48 kHz 单声道、双声道整数 PCM。
     * clientEncode 为 true 且 encode 为 true 时，调用方顺序读取帧并提交 Annex B 编码；否则直接读取预览。
     * 客户端编码只对管理员开放，其他角色由内核生成预览，不能提交共享缓存内容。
     * 会话五分钟内有效，编码任务两分钟超时；加密笔记本只使用内存，锁定时取消任务、清除会话与缓存。
     */
    "/api/asset/startLivePhotoPreview": {
        request: StartLivePhotoPreviewRequestInput;
        response: { "code": 0; "data": LivePhotoPreviewSession; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/asset/statAsset": {
        request: AssetPathRequestInput;
        response: { "code": 0; "data": AssetStatData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/asset/upload": {
        request: UploadAssetRequestInput;
        response: { "code": 0; "data": AssetUploadData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 上传提示生命周期使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，状态栏仍全局更新。
     */
    "/api/asset/uploadCloud": {
        request: AssetCloudUploadRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 上传提示生命周期使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，保留 ignorePushMsg 语义。
     */
    "/api/asset/uploadCloudByAssetsPaths": {
        request: AssetPathsCloudUploadRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/attr/batchGetBlockAttrs": {
        request: BlockIDsRequestInput;
        response: { "code": 0; "data": Record<string, Record<string, string> | null>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/attr/batchSetBlockAttrs": {
        request: BatchSetBlockAttrsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/attr/getBlockAttrs": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": Record<string, string>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/attr/getBookmarkLabels": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/attr/setBlockAttrs": {
        request: SetBlockAttrsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/addAttributeViewBlocks": {
        request: AddAttributeViewBlocksRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/addAttributeViewKey": {
        request: AddAttributeViewKeyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/appendAttributeViewDetachedBlocksWithValues": {
        request: AppendAttributeViewDetachedBlocksWithValuesRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/batchReplaceAttributeViewBlocks": {
        request: BatchReplaceAttributeViewBlocksRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/batchSetAttributeViewBlockAttrs": {
        request: BatchSetAttributeViewBlockAttrsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/changeAttrViewLayout": {
        request: ChangeAttrViewLayoutRequestInput;
        response: { "code": 0; "data": AVRenderResult; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | AVRenderResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 按模板创建条目；templateID 为空时创建空白游离条目。openAfterCreate 返回模板的交互偏好：
     * true 表示创建后分屏打开，false 表示不打开，省略时仅日历条目自动打开。API 本身不触发界面操作。
     */
    "/api/av/createAttributeViewItem": {
        request: CreateAttributeViewItemRequestInput;
        response: { "code": 0; "data": AVCreateItemResult; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | AVCreateItemResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/createAttributeViewItemDocs": {
        request: CreateAttributeViewItemDocsRequestInput;
        response: { "code": 0; "data": AVCreateItemDocsResult; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | AVCreateItemDocsResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/createAttributeViewItemWithMarkdown": {
        request: CreateAttributeViewItemWithMarkdownRequestInput;
        response: { "code": 0; "data": AVCreateItemResult; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | AVCreateItemResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/createAttributeViewRelationItem": {
        request: CreateAttributeViewRelationItemRequestInput;
        response: { "code": 0; "data": AVCreateItemResult; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | AVCreateItemResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/duplicateAttributeViewBlock": {
        request: DuplicateAttributeViewBlockRequestInput;
        response: { "code": 0; "data": AVDuplicateData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 返回数据库级 automations，所有视图共享；缺省表示没有自动化规则。
     * 规则通过 `/api/transactions` 的 setAttrViewAutomations 操作整体保存。
     */
    "/api/av/getAttributeView": {
        request: GetAttributeViewRequestInput;
        response: { "code": 0; "data": AVData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","writable"];
    };
    "/api/av/getAttributeViewAddingBlockDefaultValues": {
        request: GetAttributeViewAddingBlockDefaultValuesRequestInput;
        response: { "code": 0; "data": AVValuesData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/av/getAttributeViewBacklinks": {
        request: GetAttributeViewBacklinksRequestInput;
        response: { "code": 0; "data": AVAttributeViewBacklinks | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/av/getAttributeViewBoundBlockIDsByItemIDs": {
        request: GetAttributeViewBoundBlockIDsByItemIDsRequestInput;
        response: { "code": 0; "data": Record<string, string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/av/getAttributeViewCalendarUndated": {
        request: AVCalendarUndatedRequestInput;
        response: { "code": 0; "data": AVCalendarUndatedData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/getAttributeViewFieldViews": {
        request: GetAttributeViewFieldViewsRequestInput;
        response: { "code": 0; "data": AVFieldViewsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","writable"];
    };
    "/api/av/getAttributeViewFilterSort": {
        request: GetAttributeViewFilterSortRequestInput;
        response: { "code": 0; "data": AVFilterSortData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/getAttributeViewItemIDsByBoundIDs": {
        request: GetAttributeViewItemIDsByBoundIDsRequestInput;
        response: { "code": 0; "data": Record<string, string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/av/getAttributeViewItemStatuses": {
        request: GetAttributeViewItemStatusesRequestInput;
        response: { "code": 0; "data": Record<string, string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/getAttributeViewKeys": {
        request: GetAttributeViewKeysRequestInput;
        response: { "code": 0; "data": Array<AVBlockAttributeViewKeys | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/av/getAttributeViewKeysByAvID": {
        request: GetAttributeViewKeysByAvIDRequestInput;
        response: { "code": 0; "data": Array<AVKey | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/getAttributeViewKeysByID": {
        request: GetAttributeViewKeysByIDRequestInput;
        response: { "code": 0; "data": Array<AVKey | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","writable"];
    };
    "/api/av/getAttributeViewPasteRows": {
        request: GetAttributeViewPasteRowsRequestInput;
        response: { "code": 0; "data": AVPasteRowsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/getAttributeViewPrimaryKeyValues": {
        request: GetAttributeViewPrimaryKeyValuesRequestInput;
        response: { "code": 0; "data": AVPrimaryValuesData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 可选的 `sort: {column, order}` 按关联数据库字段排序，order 为 ASC 或 DESC。
     * 全部候选排序后分页，仅影响本次查询，不修改视图和 selectedRows 顺序。
     * 省略 sort 时按创建时间倒序；不存在的字段或无效方向返回错误。
     * keyword 在分页前匹配字段内容；无显示模板的空主键也匹配当前语言的未命名占位文字，遵循搜索大小写设置。
     */
    "/api/av/getAttributeViewRelationCandidates": {
        request: GetAttributeViewRelationCandidatesRequestInput;
        response: { "code": 0; "data": AVRelationCandidatesData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/getAttributeViewRowSort": {
        request: GetAttributeViewRowSortRequestInput;
        response: { "code": 0; "data": AVRowSortPreview; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/av/getAttributeViewSearchTarget": {
        request: GetAttributeViewSearchTargetRequestInput;
        response: { "code": 0; "data": AVAttributeViewSearchTarget | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","writable"];
    };
    /**
     * 获取当前视图可见资源字段中的全部图片，保留载体发布权限、加密笔记本租约、搜索和上下文筛选。
     * groupID 可选，省略、null 或空字符串时保留整个视图行为；指定时仅返回该分组图片，分组不存在则报错。
     * 分组先按组内手动顺序排列，再应用视图排序；同一单元格按资源顺序返回，不受分页或虚拟滚动限制。
     */
    "/api/av/getCurrentAttrViewImages": {
        request: GetCurrentAttrViewImagesRequestInput;
        response: { "code": 0; "data": Array<string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/av/getMirrorDatabaseBlocks": {
        request: GetMirrorDatabaseBlocksRequestInput;
        response: { "code": 0; "data": RefDefsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 完整扫描普通笔记本的数据库引用；读取或目录遍历失败返回 code=-1，不返回不完整的候选列表。
     * 加密笔记本及笔记本级数据库不参与全局未引用清理。
     * 截断提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，离线目标不回退广播。
     */
    "/api/av/getUnusedAttributeViews": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<AssetUnusedItem | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 预览已保存且启用的普通块收集规则，不修改文档或数据库。
     * 仅在目标数据库的加密边界内查询；page 从 1 开始，每页最多 100 个，hasMore 表示还有下一页。
     */
    "/api/av/previewAttributeViewCollection": {
        request: AVBlockCollectionPreviewRequestInput;
        response: { "code": 0; "data": AVBlockCollectionPreview | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 在实际条目快照上预览模板赋值，返回通过类型和引用校验的字段值，不写入数据。
     * 使用规则时区和可选的预览输入；加密笔记本遵守请求租约及相同加密边界，失败返回 code -1。
     */
    "/api/av/previewAttributeViewTemplate": {
        request: AVAutomationTemplatePreviewRequestInput;
        response: { "code": 0; "data": AVValue | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/av/removeAttributeViewBlocks": {
        request: RemoveAttributeViewBlocksRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/removeAttributeViewKey": {
        request: RemoveAttributeViewKeyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 先完整扫描普通笔记本的引用关系；扫描失败返回 code=-1，不创建清理历史或删除数据库。
     * 加密笔记本及笔记本级数据库不参与全局未引用清理。
     */
    "/api/av/removeUnusedAttributeView": {
        request: RemoveUnusedAttributeViewRequestInput;
        response: { "code": 0; "data": AVIDData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 完整扫描成功后才备份并删除未引用的全局数据库；扫描失败返回 code=-1，保留源文件。
     * 加密笔记本及笔记本级数据库不参与全局未引用清理。
     */
    "/api/av/removeUnusedAttributeViews": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": AVPathsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 渲染指定数据库视图，保留载体权限、加密笔记本租约、筛选和分页行为。
     * temporarySort 可选，省略或 null 时使用已保存的排序；指定时以单字段规则覆盖本次渲染排序，先排序再分页。
     * 临时排序的 order 必须为 ASC 或 DESC；字段缺失或不支持排序时恢复已保存规则。
     * 临时排序不创建或保存数据库，不改变载体默认视图；支持现有 valueSource 和 dateEndpoint 语义。
     */
    "/api/av/renderAttributeView": {
        request: RenderAttributeViewRequestInput;
        response: { "code": 0; "data": AVRenderResult; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | AVRenderResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/av/renderHistoryAttributeView": {
        request: RenderHistoryAttributeViewRequestInput;
        response: { "code": 0; "data": AVArchiveRenderData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/av/renderSnapshotAttributeView": {
        request: RenderSnapshotAttributeViewRequestInput;
        response: { "code": 0; "data": AVArchiveRenderData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 按全部启用收集规则的并集检查已有条目，返回 matched、unmatched、unknown 和规则版本。
     * 手动及自动绑定条目统一判断；游离、无可用规则或无法判断时保留，不隐式清理或补收。
     * status 可选，按分类筛选后每页最多 100 项；省略时保留混合分页，全库计数不受筛选影响。
     * unknown 条目通过 reason 说明原因；isDetached 表示游离条目，主动移出使用普通条目移出事务。
     * reason 的 invalidItem、detached、noRules、invalidRule 分别表示绑定信息不完整、游离、无启用规则和规则无效，
     * unavailable 表示源块不可用，unreadable 表示源内容读取失败；原因不包含原始错误或私密路径。
     * 使用 cleanupAttrViewBlocks 事务明确移出预览后确认的条目，执行时重新检查并支持撤销。
     */
    "/api/av/reviewAttributeViewCollection": {
        request: AVCollectionReviewRequestInput;
        response: { "code": 0; "data": AVCollectionReview | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/av/searchAttributeView": {
        request: SearchAttributeViewRequestInput;
        response: { "code": 0; "data": AVSearchData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","writable"];
    };
    "/api/av/searchAttributeViewRelationKey": {
        request: SearchAttributeViewRelationKeyRequestInput;
        response: { "code": 0; "data": AVKeysData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/searchAttributeViewRollupDestKeys": {
        request: SearchAttributeViewRollupDestKeysRequestInput;
        response: { "code": 0; "data": AVKeysData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/setAttrViewContextFilter": {
        request: SetAttrViewContextFilterRequestInput;
        response: { "code": 0; "data": AVContextFilterData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/setAttrViewFilters": {
        request: SetAttrViewFiltersRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/setAttrViewGroup": {
        request: SetAttrViewGroupRequestInput;
        response: { "code": 0; "data": AVRenderResult; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | AVRenderResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/setAttrViewSorts": {
        request: SetAttrViewSortsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/setAttributeViewBlockAttr": {
        request: SetAttributeViewBlockAttrRequestInput;
        response: { "code": 0; "data": AVValueData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/setDatabaseBlockView": {
        request: SetDatabaseBlockViewRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/sortAttributeViewKey": {
        request: SortAttributeViewKeyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/av/sortAttributeViewViewKey": {
        request: SortAttributeViewViewKeyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 取消请求会停止当前下载及后续更新；已提交的包会保留并完成运行时刷新。
     */
    "/api/bazaar/batchUpdatePackage": {
        request: BatchUpdatePackageRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/bazaar/getBazaarIcon": {
        request: GetBazaarIconRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getBazaarPackage": {
        request: GetBazaarPackageRequestInput;
        response: { "code": 0; "data": BazaarPackageDetail; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getBazaarPackageREADME": {
        request: GetBazaarPackageREADMERequestInput;
        response: { "code": 0; "data": BazaarREADMEData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getBazaarPackageRating": {
        request: GetBazaarPackageRatingRequestInput;
        response: { "code": 0; "data": BazaarRatingResult; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | BazaarRatingResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getBazaarPackageRatings": {
        request: GetBazaarPackageRatingsRequestInput;
        response: { "code": 0; "data": BazaarRatingsData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getBazaarPackageUserRatings": {
        request: GetBazaarPackageUserRatingsRequestInput;
        response: { "code": 0; "data": BazaarUserRatingsResult; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | BazaarUserRatingsResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getBazaarPlugin": {
        request: GetBazaarPluginRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getBazaarTemplate": {
        request: GetBazaarTemplateRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getBazaarTheme": {
        request: GetBazaarThemeRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getBazaarWidget": {
        request: GetBazaarWidgetRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getInstalledIcon": {
        request: GetInstalledIconRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getInstalledPackageSize": {
        request: GetInstalledPackageSizeRequestInput;
        response: { "code": 0; "data": BazaarPackageSizeData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getInstalledPlugin": {
        request: GetInstalledPluginRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getInstalledTemplate": {
        request: GetInstalledTemplateRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getInstalledTheme": {
        request: GetInstalledThemeRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getInstalledWidget": {
        request: GetInstalledWidgetRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/getUpdatedPackage": {
        request: GetUpdatedPackageRequestInput;
        response: { "code": 0; "data": BazaarUpdatedData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 安装完成提示使用可选请求头 X-SiYuan-App-ID 定向；外观刷新事件仍广播。
     * 请求取消会中止下载、解压及尚未提交的替换；已提交的安装不会回滚，仍完成运行时刷新。
     */
    "/api/bazaar/installBazaarIcon": {
        request: InstallBazaarIconRequestInput;
        response: { "code": 0; "data": BazaarAppearancePackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 安装完成提示使用可选请求头 X-SiYuan-App-ID 定向；插件重载事件仍广播。
     * 请求取消会中止下载、解压及尚未提交的替换；已提交的安装不会回滚，仍完成运行时刷新。
     */
    "/api/bazaar/installBazaarPlugin": {
        request: InstallBazaarPluginRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 安装完成提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播。
     * 请求取消会中止下载、解压及尚未提交的替换；已提交的安装不会回滚，仍完成运行时刷新。
     */
    "/api/bazaar/installBazaarTemplate": {
        request: InstallBazaarTemplateRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 安装完成提示使用可选请求头 X-SiYuan-App-ID 定向；外观刷新事件仍广播。
     * 请求取消会中止下载、解压及尚未提交的替换；已提交的安装不会回滚，仍完成运行时刷新。
     */
    "/api/bazaar/installBazaarTheme": {
        request: InstallBazaarThemeRequestInput;
        response: { "code": 0; "data": BazaarAppearancePackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 安装完成提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播。
     * 请求取消会中止下载、解压及尚未提交的替换；已提交的安装不会回滚，仍完成运行时刷新。
     */
    "/api/bazaar/installBazaarWidget": {
        request: InstallBazaarWidgetRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/bazaar/installLocalBazaarPackage": {
        request: InstallLocalBazaarPackageRequestInput;
        response: { "code": 0; "data": BazaarLocalInstallResult; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | BazaarLocalInstallResult; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/bazaar/setBazaarPackageRating": {
        request: SetBazaarPackageRatingRequestInput;
        response: { "code": 0; "data": BazaarRatingResult; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | BazaarRatingResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/bazaar/uninstallBazaarIcon": {
        request: UninstallBazaarIconRequestInput;
        response: { "code": 0; "data": BazaarAppearancePackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/bazaar/uninstallBazaarPlugin": {
        request: UninstallBazaarPluginRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/bazaar/uninstallBazaarTemplate": {
        request: UninstallBazaarTemplateRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/bazaar/uninstallBazaarTheme": {
        request: UninstallBazaarThemeRequestInput;
        response: { "code": 0; "data": BazaarAppearancePackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/bazaar/uninstallBazaarWidget": {
        request: UninstallBazaarWidgetRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 安装完成提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，离线目标不回退广播。
     * 请求取消会中止下载、解压及尚未提交的替换；已提交的更新不会回滚。
     */
    "/api/bazaar/updateBazaarPackage": {
        request: UpdateBazaarPackageRequestInput;
        response: { "code": 0; "data": BazaarPackagesData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 目标为原生页签或脑图容器时，只能插入各自的项目块。
     * 输入同类型容器片段时展开其直属项目，保留目标容器属性及项目 ID；非法子块由事务校验拒绝。
     * 原生页签和脑图的结构化编辑使用 getBlockDOM 和 dataType="dom"，并保留已有 ID 和属性。
     */
    "/api/block/appendBlock": {
        request: AppendBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/appendDailyNoteBlock": {
        request: DailyNoteBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/appendHeadingChildren": {
        request: AppendHeadingChildrenRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/batchAppendBlock": {
        request: BatchParentBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/batchInsertBlock": {
        request: BatchInsertBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/batchPrependBlock": {
        request: BatchParentBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/batchUpdateBlock": {
        request: BatchUpdateBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/batchUpdateTaskListItemMarker": {
        request: BatchTaskListMarkerRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/checkBlockExist": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": boolean; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/checkBlockFold": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": BlockFoldData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/checkBlockRef": {
        request: CheckBlockRefRequestInput;
        response: { "code": 0; "data": boolean; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | boolean; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 接收 ids，忽略非字符串及无效块 ID，重复 ID 合并为一个结果。
     * notebook 为加密笔记本时只查询该库；省略或传入普通笔记本时查询全局库及本请求已持有租约的加密库。
     * 不存在或已锁定且无法确定归属的块返回 false；显式指定已锁定的加密笔记本返回 code=-1、data=null。
     * 发布读者的不可访问块不返回结果，加密响应租约保持到响应发送完成。
     */
    "/api/block/checkBlocksExist": {
        request: CheckBlocksExistRequestInput;
        response: { "code": 0; "data": Record<string, boolean> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/deleteBlock": {
        request: DeleteBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/foldBlock": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/getBlockBreadcrumb": {
        request: BlockBreadcrumbRequestInput;
        response: { "code": 0; "data": Array<BlockPath | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getBlockBreadcrumbChildren": {
        request: BlockBreadcrumbChildrenRequestInput;
        response: { "code": 0; "data": BlockBreadcrumbChildren | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getBlockDOM": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": BlockDOMData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getBlockDOMWithEmbed": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": BlockDOMData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getBlockDOMs": {
        request: BlocksQueryRequestInput;
        response: { "code": 0; "data": Record<string, string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getBlockDOMsWithEmbed": {
        request: BlocksQueryRequestInput;
        response: { "code": 0; "data": Record<string, string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getBlockDefIDsByRefText": {
        request: RefTextQueryRequestInput;
        response: { "code": 0; "data": RefDefsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getBlockIndex": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": number; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getBlockInfo": {
        request: BlockInfoRequestInput;
        response: { "code": 0; "data": BlockInfoData; "msg": string; } | { "code": -1 | 3; "data": { "closeTimeout": number; } | null | string; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 默认输出供阅读的 Markdown，将原生页签平铺并将脑图输出为普通列表。
     * 原生页签和脑图的结构化编辑应使用 getBlockDOM，并保留已有 ID 和属性。
     */
    "/api/block/getBlockKramdown": {
        request: BlockKramdownRequestInput;
        response: { "code": 0; "data": BlockKramdownData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getBlockKramdowns": {
        request: BlocksKramdownRequestInput;
        response: { "code": 0; "data": Record<string, string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getBlockRelevantIDs": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": BlockRelevantData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getBlockSiblingID": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": BlockSiblingData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 标题结果包含可选的 `headingChildren`，表示完整文档同一容器内是否有下辖块。
     * 空段落也算下辖块，结果不受折叠或分页影响；非标题及旧版内核省略该字段，省略不能视为空标题。
     */
    "/api/block/getBlockTreeInfos": {
        request: BlocksQueryRequestInput;
        response: { "code": 0; "data": Record<string, BlockTreeInfo | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getBlocksIndexes": {
        request: BlocksQueryRequestInput;
        response: { "code": 0; "data": Record<string, number> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getBlocksWordCount": {
        request: BlocksWordCountRequestInput;
        response: { "code": 0; "data": WordCountData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getChildBlocks": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": Array<ChildBlock | null>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/block/getContentWordCount": {
        request: ContentWordCountRequestInput;
        response: { "code": 0; "data": WordCountData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getDOMText": {
        request: DOMTextRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getDocBlocksOrders": {
        request: DocOrdersRequestInput;
        response: { "code": 0; "data": Array<string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getDocHeadingLevelTransaction": {
        request: DocHeadingLevelRequestInput;
        response: { "code": 0; "data": DocHeadingLevelData | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/getDocInfo": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": DocInfo | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getDocsInfo": {
        request: DocsInfoRequestInput;
        response: { "code": 0; "data": Array<DocInfo | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getHeadingChildrenDOM": {
        request: HeadingChildrenRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getHeadingChildrenIDs": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": Array<string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getHeadingDeleteTransaction": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": BlockTransaction | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/block/getHeadingFoldTransaction": {
        request: HeadingFoldRequestInput;
        response: { "code": 0; "data": BlockTransaction | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/block/getHeadingInsertTransaction": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": BlockTransaction | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/block/getHeadingLevelTransaction": {
        request: HeadingLevelRequestInput;
        response: { "code": 0; "data": BlockTransaction | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/block/getOrderedListContinueStart": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": OrderedListStartData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/block/getRecentUpdatedBlocks": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<SearchBlock | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getRefIDs": {
        request: RefIDsRequestInput;
        response: { "code": 0; "data": RefIDsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getRefIDsByFileAnnotationID": {
        request: FileAnnotationRefRequestInput;
        response: { "code": 0; "data": RefDefsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getRefText": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getTailChildBlocks": {
        request: TailChildBlocksRequestInput;
        response: { "code": 0; "data": Array<ChildBlock | null>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/block/getTreeStat": {
        request: TreeStatRequestInput;
        response: { "code": 0; "data": TreeStatData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/block/getUnfoldedParentID": {
        request: BlockQueryRequestInput;
        response: { "code": 0; "data": UnfoldedParentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 按 nextID、previousID、parentID 的顺序选择插入位置。
     * 生效的同级锚点必须是非文档块；未使用的定位参数不参与节点类型校验，文档 parentID 插入到文档开头。
     * 目标非法时返回 code=-1、data=null，成功返回已落盘的操作。
     * 目标为原生页签或脑图容器时，只能插入各自的项目块；同类型容器片段展开为其直属项目。
     * 展开保留目标容器属性及项目 ID；非法子块由事务校验拒绝。
     * 原生页签和脑图的结构化编辑使用 getBlockDOM 和 dataType="dom"，并保留已有 ID 和属性。
     */
    "/api/block/insertBlock": {
        request: InsertBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 要求管理员身份，保留只读保护及加密笔记本请求租约；请求必须提供文档 id 和 notebook。
     * 保存历史后在一次可撤销事务中转换能够完整解析的旧 mindmap 列表，返回 converted 数量与文档脑图的
     * 权威 blocks（id、dom）。重复请求返回当前块内容而不重复转换，不完整的原文保持不变。
     */
    "/api/block/migrateLegacyMindmaps": {
        request: MigrateLegacyMindmapsRequestInput;
        response: { "code": 0; "data": MigrateLegacyMindmapsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 同步移动块，previousID 优先于 parentID，省略 previousID 时移动到父块开头。
     * 成功和主动跳过返回 code=0、data=null；事务校验或提交失败返回 code=-1、data=null 和原因。
     * 事务回滚时通知界面重载并显示错误；访问受加密笔记本权限及跨加密边界限制。
     */
    "/api/block/moveBlock": {
        request: MoveBlockRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/moveOutlineHeading": {
        request: MoveBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 目标为原生页签或脑图容器时，只能插入各自的项目块。
     * 输入同类型容器片段时展开其直属项目，保留目标容器属性及项目 ID；非法子块由事务校验拒绝。
     * 响应在事务排队后返回，code=0 不代表事务已通过校验；事务失败不落盘。
     * 原生页签和脑图的结构化编辑使用 getBlockDOM 和 dataType="dom"，并保留已有 ID 和属性。
     */
    "/api/block/prependBlock": {
        request: PrependBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/prependDailyNoteBlock": {
        request: DailyNoteBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/setBlockReminder": {
        request: BlockReminderRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * refID 指定引用块，defID 指定定义块；includeChildren 控制标题或列表的子块范围。
     * originalToEmbed 省略或为 false 时在原定义位置保留引用，为 true 时替换为查询已移动定义 ID 的嵌入块。
     * 成功响应的 data 为 null；可撤销的编辑器操作使用 /api/transactions 的 swapBlockRef 动作。
     */
    "/api/block/swapBlockRef": {
        request: SwapBlockRefRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/transferBlockRef": {
        request: TransferBlockRefRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/unfoldBlock": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/updateBlock": {
        request: UpdateBlockRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/block/updateTaskListItemMarker": {
        request: TaskListMarkerRequestInput;
        response: { "code": 0; "data": Array<BlockTransaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/bookmark/getBookmark": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<Bookmark | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/bookmark/removeBookmark": {
        request: RemoveBookmarkRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/bookmark/renameBookmark": {
        request: RenameBookmarkRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/broadcast/getChannelInfo": {
        request: BroadcastChannelRequestInput;
        response: { "code": 0; "data": BroadcastChannelData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/broadcast/getChannels": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": BroadcastChannelsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/broadcast/postMessage": {
        request: BroadcastMessageRequestInput;
        response: { "code": 0; "data": BroadcastChannelData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/broadcast/publish": {
        request: Record<string, Array<string | Blob>>;
        response: { "code": 0; "data": BroadcastPublishData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/clipboard/cleanupRichText": {
        request: CleanupRichTextRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 接收已解锁的加密 notebook 和 assets 引用数组，返回原引用到新引用的映射。
     * 普通附件复制为独立加密副本，原文件保持不变；同一笔记本内复用已有附件，拒绝跨加密笔记本复制。
     * 引用仅限工作空间 assets/ 路径，可包含查询参数、片段和 PDF 标注 ID；PDF 标注文件随附件复制。
     * 整批准备成功后调用方再插入内容；失败返回 code=-1、data=null，并清理本批次新建附件。
     * 要求管理员权限，禁止只读写入，响应持有加密笔记本请求租约。
     */
    "/api/clipboard/preparePasteAssets": {
        request: PreparePasteAssetsRequestInput;
        response: { "code": 0; "data": Record<string, string>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/clipboard/prepareRichText": {
        request: PrepareRichTextRequestInput;
        response: { "code": 0; "data": RichClipboardPrepared | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/clipboard/readFilePaths": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<ClipboardFile>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/clipboard/writeFilePath": {
        request: ClipboardPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/cloud/getCloudSpace": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": CloudSpaceData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/cloud/setCloudReminder": {
        request: CloudReminderRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/convert/pandoc": {
        request: PandocRequestInput;
        response: { "code": 0; "data": PandocData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/export/copyExportFile": {
        request: CopyExportFileRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | -2; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/export/export2Liandi": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/export/exportAsFile": {
        request: ExportAsFileRequestInput;
        response: { "code": 0; "data": ExportFileData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportAsciiDoc": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportAttributeView": {
        request: ExportAttributeViewRequestInput;
        response: { "code": 0; "data": ExportZipData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportBrowserHTML": {
        request: ExportBrowserHTMLRequestInput;
        response: { "code": 0; "data": ExportZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportCodeBlock": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportPathData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportData": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": ExportZipData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportDataInFolder": {
        request: ExportFolderRequestInput;
        response: { "code": 0; "data": ExportNameData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportDocx": {
        request: ExportDocxRequestInput;
        response: { "code": 0; "data": ExportPathData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportEPUB": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportHTML": {
        request: ExportHTMLRequestInput;
        response: { "code": 0; "data": ExportHTMLData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * Markdown 导出按文档标题编号开关和编辑器编号格式添加编号，不修改源文档。
     */
    "/api/export/exportMd": {
        request: ExportMarkdownRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * Markdown 内容按文档标题编号开关和编辑器编号格式添加编号，局部导出保留原文档编号。
     */
    "/api/export/exportMdContent": {
        request: ExportMarkdownContentRequestInput;
        response: { "code": 0; "data": ExportMarkdownContentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportMdHTML": {
        request: ExportMarkdownHTMLRequestInput;
        response: { "code": 0; "data": ExportHTMLData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * Markdown 导出按各文档的标题编号开关和编辑器编号格式添加编号，不修改源文档。
     */
    "/api/export/exportMds": {
        request: ExportDocumentsMarkdownRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportMediaWiki": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * Markdown 导出按各文档的标题编号开关和编辑器编号格式添加编号，不修改源文档。
     */
    "/api/export/exportNotebookMd": {
        request: ExportNotebookMarkdownRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportNotebookSY": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * Markdown 导出按各文档的标题编号开关和编辑器编号格式添加编号，不修改源文档。
     */
    "/api/export/exportNotebooksMd": {
        request: ExportNotebooksMarkdownRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportNotebooksSY": {
        request: ExportNotebooksRequestInput;
        response: { "code": 0; "data": ExportZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportODT": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportOPML": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportOrgMode": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 导出图片或 PDF 预览时，可选的 keepJSEmbed: true 保留脚本嵌入占位，默认不保留。
     * 内核不执行脚本；调用方须遵守安全模式限制，并等待异步渲染完成后再导出。
     * image=true 或 pdf=true 时可用 excludeTitleImage=true 排除题头图；省略、null 或 false 保留，独立于 addTitle。
     * 未指定图片或 PDF 模式时忽略 excludeTitleImage；原始文档、正文图片及加密笔记本读取授权不受影响。
     */
    "/api/export/exportPreviewHTML": {
        request: ExportPreviewHTMLRequestInput;
        response: { "code": 0; "data": ExportPreviewHTMLData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportRTF": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportReStructuredText": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportResources": {
        request: ExportResourcesRequestInput;
        response: { "code": 0; "data": ExportPathData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | string; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportSY": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportSYs": {
        request: ExportIDsRequestInput;
        response: { "code": 0; "data": ExportZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportTempContent": {
        request: ExportTempContentRequestInput;
        response: { "code": 0; "data": ExportURLData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/exportTextile": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportNamedZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/export/preview": {
        request: ExportIDRequestInput;
        response: { "code": 0; "data": ExportPreviewData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * exportAssets=true 时仅复制 PDF 实际资源链接需要的外部文件，同名文件另存并更新链接，不覆盖已有文件。
     * removeAssets=true 时把链接目标嵌入为附件，不在输出目录复制或清理资源；页面图片不额外复制。
     * exportAssets 省略、null 或 false 保持已有处理方式；启用时保留加密笔记本读取租约，禁止写入加密目录。
     * 启用时 path 必须为绝对路径，资源读取或 PDF 写入失败会报错，并撤销本次新建的外部资源文件。
     */
    "/api/export/processPDF": {
        request: ProcessPDFRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/extension/copy": {
        request: ({ "assets"?: string; "clipType"?: string; "dom": string; "href"?: string; "notebook"?: string; } & Record<string, string | Blob | Array<string | Blob>>);
        response: { "code": 0; "data": ExtensionCopyData | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | ExtensionCopyData | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 在写入前检查文档源格式及规范路径，预检失败返回 -1。
     * 目标为文档 ID 路径时，未知格式和标题冲突均返回 -1；实际写入在文件锁内重新校验现有源，不规范化内容。
     * 新复制的文档标题含 ASCII / 时必须声明 Spec >= 6，否则返回 -1 和 document title requires spec 6；已有源的读取和恢复不受此写入检查影响。
     * 工作空间外的加密资源解密导出仍要求既有授权和操作租约。
     */
    "/api/file/copyFile": {
        request: CopyFileRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | -2; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/file/getFile": {
        request: FilePathRequestInput;
        response: Blob | { "code": -1 | -3 | 403 | 404 | 409 | 500 | 503; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
        output: "binary";
    };
    "/api/file/getUniqueFilename": {
        request: FilePathRequestInput;
        response: { "code": 0; "data": FilePathData; "msg": string; } | { "code": -1 | -3; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 在创建目标目录及复制前预检整批规范路径和文档源；预检不兼容时返回 -1，不写入目标。
     * 新复制的文档标题含 ASCII / 时必须声明 Spec >= 6，否则返回 -1 和 document title requires spec 6；不自动改写原始内容。
     * 文档 ID 路径同时检查传入内容及现有源，实际写入前再次校验；后续并发变化或 I/O 失败不回滚已完成的复制。
     * 原有敏感路径、加密笔记本和符号链接限制继续生效。
     */
    "/api/file/globalCopyFiles": {
        request: CopyFilesRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | -2 | -3 | 403; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 在创建目录、写入内容及更新时间前校验文档源格式与规范路径；不兼容时返回 -1。
     * 文档 ID 路径检查传入内容及现有源的格式和标题；未知格式或标题冲突返回 -1，原文件和时间保持不变。
     * 新传入的标题含 ASCII / 时必须声明 Spec >= 6，否则返回 -1 和 document title requires spec 6；已有低 Spec 源仍可读取并由合法内容替换。
     * 实际文档写入在同一文件锁内重新校验现有源，保留请求字节；附件和插件文件不按文档格式解释。
     */
    "/api/file/putFile": {
        request: PutFileRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | -3 | 400 | 403 | 500; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "form";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/file/readDir": {
        request: ReadDirectoryRequestInput;
        response: { "code": 0; "data": Array<DirectoryEntry>; "msg": string; } | { "code": -1 | -3 | 403 | 404 | 409 | 500; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 保留既有敏感路径和加密边界检查；整本删除时校验树内全部文档寻址记录。
     */
    "/api/file/removeFile": {
        request: RemoveFileRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | -3 | 403 | 404 | 500; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 在创建目标父目录或移动源文件前预检文档源格式与规范路径，失败返回 -1。
     * 移入由笔记本及文档 ID 组成的 .sy 路径时检查全部源文档；未知格式或标题冲突返回 -1，保留来源。
     * 新移入的标题含 ASCII / 时必须声明 Spec >= 6，否则返回 -1 和 document title requires spec 6；不自动改写原始内容。
     */
    "/api/file/renameFile": {
        request: RenameFileRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | -3 | 403 | 404 | 409 | 500; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 在创建目标目录及复制前预检整批规范路径和文档源；预检不兼容时返回 -1，不写入目标。
     * 新复制的文档标题含 ASCII / 时必须声明 Spec >= 6，否则返回 -1 和 document title requires spec 6；不自动改写原始内容。
     * 文档 ID 路径同时检查传入内容及现有源，实际写入前再次校验；后续并发变化或 I/O 失败不回滚已完成的复制。
     * 原有敏感路径、加密笔记本和符号链接限制继续生效。
     */
    "/api/file/workspaceCopyFiles": {
        request: CopyFilesRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | -2 | -3 | 403; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/authFilePublishAccess": {
        request: FileTreeAuthPublishRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
        additionalErrorStatuses: [429];
    };
    "/api/filetree/changeSort": {
        request: FileTreeChangeSortRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 省略 date、传空串或 null 时，按当天的命名和路径模板复用或创建，与日记按钮、快捷键一致。
     * 显式指定日期（包括今天）时，先按目标笔记本的日记日期属性复用，改名或移动后仍可找到原日记。
     * 多个日期匹配优先选择模板目标，否则按 ID 升序选择；无日期匹配时再复用或创建模板目标。
     * 两种入口复用已有文档均不重新应用正文模板；普通入口补建模板目标后，日期入口可能改为优先选择该目标。
     */
    "/api/filetree/createDailyNote": {
        request: FileTreeDailyNoteRequestInput;
        response: { "code": 0; "data": FileTreeCreateData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/createDoc": {
        request: FileTreeCreateRequestInput;
        response: { "code": 0; "data": FileTreeCreateData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 在显式父文档 ID 或 null 根位置创建固定 ID 文档，不接收 path/hPath 或名称回退。
     * title.format 首版只接受 plain，text 可为空；无效字符、超长标题及不支持的格式原样拒绝，不截断或清洗。
     * 可选父路径 revision 与至多 128 项名称条件在源提交前分别校验；条件只能涉及目标祖先和最终父级。
     * ID 冲突不覆盖、不自动更换；错误 data 包含稳定 reason、commitState、阶段及已完成步骤。
     * 已落盘但排序或正文模板失败时保留源文档并返回其 ID，调用方不得把该错误当作未创建而重复提交。
     * 保留标题中的 /，新写入含斜杠标题使用 Spec 6；普通文档不统一升级规格。
     * 加密笔记本使用原有认证写入与响应租约；寻址规则不改变密文格式或密钥材料。
     */
    "/api/filetree/createDocByParent": {
        request: CreateDocByParentRequestInput;
        response: { "code": 0; "data": CreateDocByParentResult; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | CreateDocByParentResult; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 使用编辑器 Markdown 语法选项，并按 `/api/import/importStdMd` 的规则转换标准脚注。
     * 转义的脚注语法保留为字面文本；返回创建的文档 ID，访问受笔记本权限限制。
     * Every parent prefix is checked before writing; slash/empty-title candidates return pathAmbiguous.
     * Multiple clean parents also return pathAmbiguous unless a valid matching parentID selects their
     * real ancestor chain. An ID cannot bypass unsupported candidates. Unready or inconsistent metadata
     * returns indexUnavailable. Prefer createDocByParent with a separate parent identity and title.
     */
    "/api/filetree/createDocWithMd": {
        request: FileTreeCreateMarkdownRequestInput;
        response: { "code": 0; "data": LegacyPathDocumentResult; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | LegacyPathDocumentResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/doc2Heading": {
        request: FileTreeDocHeadingRequestInput;
        response: { "code": 0; "data": FileTreeDocHeadingData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * evaluates block collection rules for the new document and its blocks, initializing only new rows.
     */
    "/api/filetree/duplicateDoc": {
        request: FileTreeIDRequestInput;
        response: { "code": 0; "data": FileTreeDuplicateData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 将单篇文档及全部子文档复制到同一笔记本的原父目录，返回副本根文档的 id、notebook、path 和 hPath。
     * 为副本文档和块执行块收集规则，仅初始化新行。
     * 副本内部块引用、块链接和查询嵌入的显式块 ID 统一重映射，数据库定义与行绑定保持为共享镜像。
     * 源快照经过认证读取且不执行修复写回；运行期失败时清理新建文档并恢复排序，属运行时补偿，
     * 不保证进程崩溃时的事务原子性。
     */
    "/api/filetree/duplicateDocTree": {
        request: FileTreeIDRequestInput;
        response: { "code": 0; "data": FileTreeDuplicateData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 按日期属性预览日记，不创建文档；省略 date、传空串或 null 时查询当天。
     * 多个日期匹配优先选择模板目标，否则按 ID 升序选择；无日期匹配时再检查模板目标。
     */
    "/api/filetree/getDailyNoteInfo": {
        request: DailyNoteInfoRequestInput;
        response: { "code": 0; "data": DailyNoteInfo | null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/filetree/getDoc": {
        request: FileTreeGetDocRequestInput;
        response: { "code": 0; "data": FileTreeGetDocData; "msg": string; } | { "code": -1 | 1 | 3; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 旧模板保持既有渲染及回退；对应的新目标对象生效时返回 structuredTemplateRequired，不读取历史路径。
     */
    "/api/filetree/getDocCreateSavePath": {
        request: FileTreeNotebookRequestInput;
        response: { "code": 0; "data": FileTreeCreateSavePathResult; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | FileTreeCreateSavePathResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 返回指定用途的有效目标及正文模板，不渲染模板、不猜测上下文或日期。
     * version=1 保留旧路径语法；version=2 独立保存祖先和标题段。revision 覆盖生效配置及继承来源，
     * 由配置创建时传回 expectedTarget，配置变化即返回 planChanged。读取需管理员及源笔记本操作租约。
     */
    "/api/filetree/getDocCreateTarget": {
        request: GetDocCreateTargetRequestInput;
        response: { "code": 0; "data": DocumentCreateTargetData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 在指定笔记本内按文档 ID 读取结构化祖先链，要求管理员权限，加密响应保留操作租约。
     * ids 必须包含 1 至 128 项，按首次出现顺序去重；缺失、其他笔记本或内容块身份列入 missingIDs。
     * 文档标题、segments 与 revision 来自同一快照，displayPath 仅用于显示，不能反向解析身份。
     * 索引未就绪返回 indexUnavailable，源格式和认证错误不能伪装成缺失；批量结果不承诺全局快照。
     */
    "/api/filetree/getDocPaths": {
        request: GetDocPathsRequestInput;
        response: { "code": 0; "data": DocumentPathsResult; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | DocumentPathsResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/filetree/getFullHPathByID": {
        request: FileTreeOptionalIDRequestInput;
        response: { "code": 0; "data": string | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/filetree/getHPathByID": {
        request: FileTreeIDRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/filetree/getHPathByPath": {
        request: FileTreePathRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/filetree/getHPathsByPaths": {
        request: FileTreePathsRequestInput;
        response: { "code": 0; "data": Array<string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * queries exact legacy display paths and verifies each candidate's real ancestor chain.
     * Clean candidates have nonempty titles without ASCII / and no empty-title flag at every level.
     * Returns every clean ID, an empty array for no matches, pathAmbiguous for mixed candidates,
     * or legacyPathUnsupported for unsupported candidates only. Error data may include cleanIDs and
     * unsupportedIDs, filtered by existing access restrictions. Missing, pending, inconsistent or failed
     * metadata returns indexUnavailable. Prefer resolveDocPath with independent title segments.
     */
    "/api/filetree/getIDsByHPath": {
        request: FileTreeOptionalPathRequestInput;
        response: { "code": 0; "data": LegacyPathIDsResult; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | LegacyPathIDsResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/filetree/getPathByID": {
        request: FileTreeTrimIDRequestInput;
        response: { "code": 0; "data": FileTreeDocPathData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 按置顶顺序返回普通文档及与文档树一致的大小、属性和时间信息。
     * 关闭笔记本的条目标记 unavailable，详细信息为空；加密笔记本不返回置顶条目。
     */
    "/api/filetree/getPinnedDocs": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<PinnedDoc>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/filetree/getPublishAccess": {
        request: FileTreePublishIDsRequestInput;
        response: { "code": 0; "data": FileTreePublishData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/getRefCreateSavePath": {
        request: FileTreeNotebookRequestInput;
        response: { "code": 0; "data": FileTreeSavePathResult; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | FileTreeSavePathResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/filetree/getShorthandSavePath": {
        request: FileTreeNotebookRequestInput;
        response: { "code": 0; "data": FileTreeSavePathData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/filetree/heading2Doc": {
        request: FileTreeHeadingDocRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/li2Doc": {
        request: FileTreeListItemDocRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/listDocTree": {
        request: FileTreePathRequestInput;
        response: { "code": 0; "data": FileTreeDocTreeData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/listDocsByPath": {
        request: FileTreeListRequestInput;
        response: { "code": 0; "data": FileTreeListData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * evaluates block collection rules for moved documents and descendants entering a watched scope.
     * Existing database rows and their field values are preserved. A collection failure is returned after the
     * physical move; successfully moved documents remain at their new locations.
     */
    "/api/filetree/moveDocs": {
        request: FileTreeMoveRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * has the same collection and partial-failure behavior as MoveDocs.
     */
    "/api/filetree/moveDocsByID": {
        request: FileTreeMoveIDsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/moveLocalShorthands": {
        request: FileTreeNotebookRequestInput;
        response: { "code": 0; "data": Array<string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 只读编译有效创建目标，同一次计划使用相同时间，日期可指定为 YYYY-MM-DD。
     * contextID 是源笔记本内的文档，child 使用该位置，configured 使用配置目标；title 可显式替换最终标题。
     * 调用方提前保存最终 id，返回步骤已分配全部祖先 ID。按顺序向 createDocByParent 提交，不承诺跨文件原子性。
     * reuse 仅用于明确允许复用的业务。existingID 非空时不创建；普通新建应保持 reuse=false。
     * 上一步创建父文档后，将其返回的 revision 传为下一步 expectedParentRevision；错误或响应丢失时保留计划核对 ID。
     */
    "/api/filetree/planDocCreate": {
        request: PlanDocCreateRequestInput;
        response: { "code": 0; "data": DocumentCreatePlan; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/filetree/removeDoc": {
        request: FileTreePathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/removeDocByID": {
        request: FileTreeTrimIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/removeDocs": {
        request: FileTreePathsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/removeIndexes": {
        request: FileTreePathsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/renameDoc": {
        request: FileTreeRenameRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/renameDocByID": {
        request: FileTreeRenameIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/reorderDocs": {
        request: FileTreeReorderRequestInput;
        response: { "code": 0; "data": FileTreeReorderData | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | FileTreeReorderData | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 从显式根位置或父文档 ID 逐级精确匹配 0 至 128 个非空标题段，只解析不创建。
     * 标题不作 Unicode 归一化、宽窄转换或百分号解码；同父同名返回 ambiguous，不任取候选。
     * candidates 按 ID 排序且最多 128 项，candidatesTruncated 标记截断；nameConditions 保留唯一及缺失条件。
     * 空段数组返回起点，根位置的 resolved 为 null，start.id 为 null；笔记本文档 ID 规范化为逻辑根。
     * 索引未就绪返回 indexUnavailable；标题段保留字面 /，不按笔记本选择不同的寻址模式。
     */
    "/api/filetree/resolveDocPath": {
        request: ResolveDocPathRequestInput;
        response: { "code": 0; "data": ResolveDocPathResult; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | ResolveDocPathResult; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 保留兼容展示 hPath，并单独返回文档或笔记本的纯文本 title；客户端不能从 hPath 拆出标题或层级。
     */
    "/api/filetree/searchDocs": {
        request: FileTreeSearchRequestInput;
        response: { "code": 0; "data": Array<FileTreeSearchDoc | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/filetree/setDocSortMode": {
        request: FileTreeSortModeRequestInput;
        response: { "code": 0; "data": FileTreeSortModeData | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | FileTreeSortModeData | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/setPublishAccess": {
        request: FileTreeSetPublishRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/setSort": {
        request: FileTreeSetSortRequestInput;
        response: { "code": 0; "data": FileTreeSetSortData | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | FileTreeSetSortData | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/updatePinnedDocs": {
        request: UpdatePinnedDocsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/filetree/upsertIndexes": {
        request: FileTreePathsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 格式化成功写盘后清理文档及关联跨文档撤销记录，并广播更新后的撤销状态。
     */
    "/api/format/autoSpace": {
        request: TrimmedIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 转换成功写盘后清理文档及关联跨文档撤销记录；未改写文档时保留历史。
     */
    "/api/format/netAssets2LocalAssets": {
        request: TrimmedIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 转换成功写盘后清理文档及关联跨文档撤销记录；未改写文档时保留历史。
     */
    "/api/format/netImg2LocalAssets": {
        request: NetImageAssetsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 图谱查询需要与配置写入互斥；查询自带的配置由配置段发布负责通知。
     */
    "/api/graph/getGraph": {
        request: GlobalGraphRequestInput;
        response: { "code": 0; "data": GlobalGraphResult | (GraphCorrelation & { "box"?: never; "conf"?: never; "links"?: never; "nodes"?: never; }); "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | GlobalGraphResult | (GraphCorrelation & { "box"?: never; "conf"?: never; "links"?: never; "nodes"?: never; }); "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/graph/getLocalGraph": {
        request: LocalGraphRequestInput;
        response: { "code": 0; "data": LocalGraphResult | (GraphCorrelation & { "box"?: never; "conf"?: never; "id"?: never; "links"?: never; "nodes"?: never; }); "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | LocalGraphResult | (GraphCorrelation & { "box"?: never; "conf"?: never; "id"?: never; "links"?: never; "nodes"?: never; }); "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/graph/resetGraph": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": ResetGraphData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/graph/resetLocalGraph": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": ResetLocalGraphData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/graph/setGraphConf": {
        request: SetGraphConfRequestInput;
        response: { "code": 0; "data": GlobalGraphConf | (LocalGraphConf & { "minRefs"?: never; }); "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/history/clearWorkspaceHistory": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/history/createAssetHistory": {
        request: CreateAssetHistoryRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/history/createDocHistory": {
        request: CreateDocHistoryRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/history/diffDocVersions": {
        request: DiffDocVersionsRequestInput;
        response: { "code": 0; "data": DocVersionDiffResult | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/history/getDocHistoryContent": {
        request: DocHistoryContentRequestInput;
        response: { "code": 0; "data": DocHistoryContentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 接收文档 id、最多 32 个 searchHistory 时间戳 created，以及可选的 op（默认 all）。
     * 每条结果包含 created、historyPath 和 snapshots，按快照创建时间倒序。
     * snapshots 的每项包含 id、fileID、tags、memo 和 created；同一快照的多个标记合并到 tags。
     * 仅匹配本地标记快照中认证解密后完整 .sy 数据相同的文件，不保证资源、数据库或引用内容相同。
     * 无仓库密钥时关联为空；缺失历史、格式错误、读取或认证失败返回错误。
     * 要求管理员权限，加密笔记本必须解锁，响应持有请求租约；不下载云端内容，不持久化摘要。
     */
    "/api/history/getDocHistorySnapshots": {
        request: DocHistorySnapshotsRequestInput;
        response: { "code": 0; "data": DocHistorySnapshotsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/history/getHistoryItems": {
        request: HistoryItemsRequestInput;
        response: { "code": 0; "data": HistoryItemsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/history/getNotebookHistory": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": NotebookHistoryData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/history/reindexHistory": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/history/rollbackAssetsHistory": {
        request: HistoryPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/history/rollbackAttributeViewHistory": {
        request: HistoryPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/history/rollbackDocHistory": {
        request: HistoryPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/history/rollbackNotebookHistory": {
        request: HistoryPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/history/searchHistory": {
        request: SearchHistoryRequestInput;
        response: { "code": 0; "data": SearchHistoryData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 取消尚未提交的 Data.zip 预检，包括过期预检；不能删除已提交批次的恢复材料。
     */
    "/api/import/cancelDataImport": {
        request: DataImportRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/import/cancelImportSY": {
        request: ImportTokenRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/import/cancelObsidianVaultTask": {
        request: ObsidianTaskRequestInput;
        response: { "code": 0; "data": ObsidianVaultTask | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | ObsidianVaultTask | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 按路径覆盖并保留目标独有文件，skip 保留冲突目录及其密钥材料，返回明确的跳过清单。
     * 导入加密内容必须提供可认证兼容密钥的主密码；不同数据密钥或加密状态不能直接合并。
     * 旧备份不回退当前密码或丢弃历史密钥；完整预检后提交，失败和中断可回滚，加密笔记本保持锁定。
     * 成功批次的原件、旧密文和密钥材料保留在工作空间 conf/data-imports 下。
     */
    "/api/import/commitDataImport": {
        request: CommitDataImportRequestInput;
        response: { "code": 0; "data": DataImportResult; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/import/continueImportSY": {
        request: ContinueImportSYRequestInput;
        response: { "code": 0; "data": ImportDocumentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/import/getObsidianVaultTask": {
        request: ObsidianTaskRequestInput;
        response: { "code": 0; "data": ObsidianVaultTask | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 旧 Data.zip 入口仍拒绝覆盖已有加密笔记本，也拒绝加密来源覆盖同 ID 的普通笔记本。
     * 不会隐式选择冲突策略；交互式冲突处理使用 prepareDataImport、commitDataImport 和 cancelDataImport。
     */
    "/api/import/importData": {
        request: ImportDataRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * `.sy.zip` 导入复用同名同内容的自定义表情。
     * 同名不同内容时返回错误并保留已有表情文件。
     */
    "/api/import/importSY": {
        request: ImportSYRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * `.sy.zip` 导入复用同名同内容的自定义表情。
     * 同名不同内容时返回错误并保留已有表情文件。
     */
    "/api/import/importSYAuto": {
        request: ImportSYRequestInput;
        response: { "code": 0; "data": (ImportAutoDocument & { "notebook"?: never; "notebooks"?: never; }) | (ImportAutoNotebook & { "notebooks"?: never; "token"?: never; }) | (ImportAutoNotebooks & { "notebook"?: never; "token"?: never; }); "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | (ImportAutoDocument & { "notebook"?: never; "notebooks"?: never; }) | (ImportAutoNotebook & { "notebooks"?: never; "token"?: never; }) | (ImportAutoNotebooks & { "notebook"?: never; "token"?: never; }); "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * `.sy.zip` 导入复用同名同内容的自定义表情。
     * 同名不同内容时返回错误并保留已有表情文件。
     */
    "/api/import/importSYNotebook": {
        request: ImportDataRequestInput;
        response: { "code": 0; "data": (ImportedNotebook & { "notebooks"?: never; }) | (ImportedNotebooks & { "notebook"?: never; }); "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 标准脚注定义保存为独立列表项，正文引用转换为指向列表项的上标静态块引用。
     * 多段内容保留在同一列表项内；多次引用共享目标，标签匹配忽略大小写，重复定义引用第一个匹配项。
     * 未定义的脚注不生成块引用，代码和转义的脚注文本保持原样；反链复用块引用索引。
     * 根据编辑器 mathDelimiterCompatibility 设置兼容 \(...\)、\[...\]，默认开启；保存和导出仍使用既有公式格式。
     */
    "/api/import/importStdMd": {
        request: ImportMarkdownRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 压缩包中的 Markdown 使用与 `/api/import/importStdMd` 相同的标准脚注转换规则。
     * 同样遵循编辑器 mathDelimiterCompatibility 设置，默认识别 \(...\)、\[...\]。
     */
    "/api/import/importZipMd": {
        request: ImportZipMarkdownRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 预检 Data.zip 并保存原件，返回加密冲突及需要认证的笔记本 ID，不修改活动数据。
     * 预检有效期为 30 分钟；提交前必须显式选择 skip 或 overwrite，取消会移除尚未提交的暂存文件。
     * 过期且未提交的预检在启动或下一次导入时清理；预检失败时也清理本次暂存副本。
     * 存在未完成批次时，先在独占访问下恢复；恢复失败会继续阻断其他写入、笔记本操作和同步。
     */
    "/api/import/prepareDataImport": {
        request: ImportDataRequestInput;
        response: { "code": 0; "data": DataImportPlan; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/import/startObsidianVaultAnalysis": {
        request: ObsidianAnalysisRequestInput;
        response: { "code": 0; "data": ObsidianVaultTask | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * Markdown 公式分隔符遵循编辑器 mathDelimiterCompatibility 设置，默认兼容 \(...\)、\[...\]。
     */
    "/api/import/startObsidianVaultImport": {
        request: ObsidianImportRequestInput;
        response: { "code": 0; "data": ObsidianVaultTask | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/inbox/getShorthand": {
        request: TrimmedIDRequestInput;
        response: { "code": 0; "data": Shorthand | null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/inbox/getShorthands": {
        request: ShorthandsRequestInput;
        response: { "code": 0; "data": ShorthandsData | null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/inbox/removeShorthands": {
        request: RemoveShorthandsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 标准 Markdown 复制按文档标题编号开关和编辑器编号格式添加编号，局部导出保留原文档编号。
     */
    "/api/lute/copyStdMarkdown": {
        request: CopyStdMarkdownRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 根据编辑器 mathDelimiterCompatibility 设置识别正文中的 \(...\) 和独占段落的 \[...\]，默认开启。
     * 保留表格和文字格式，跳过代码及已有公式；未闭合分隔符保留为正文。输出使用既有公式节点。
     */
    "/api/lute/html2BlockDOM": {
        request: HTMLClipboardRequestInput;
        response: { "code": 0; "data": string | HTMLClipboardPreflight; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/lute/md2html": {
        request: MarkdownHTMLRequestInput;
        response: { "code": 0; "data": HTMLData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/lute/spinBlockDOM": {
        request: DOMTextRequestInput;
        response: { "code": 0; "data": DOMData; "msg": string; } | { "code": -1 | 413; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/lute/wpsPresentation2BlockDOM": {
        request: WPSPresentationRequestInput;
        response: { "code": 0; "data": WPSPresentationData; "msg": string; } | { "code": -1; "data": ({ "closeTimeout": number; } & { "converted"?: never; "dom"?: never; }) | null | (WPSPresentationData & { "closeTimeout"?: never; }); "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 接收 name 和精确匹配的 redirectURI，返回客户端 id 及仅显示一次的 secret。
     * 要求管理员权限并禁止只读模式；OAuth 令牌只用于 /mcp，不解锁加密笔记本。
     */
    "/api/mcp/addOAuthClient": {
        request: MCPOAuthClientRequestInput;
        response: { "code": 0; "data": MCPOAuthClientSecret; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 返回内置 MCP 服务端 OAuth 的公开地址、开关和预注册客户端列表，不返回凭证摘要或客户端密钥。
     * 要求管理员权限；服务端 OAuth 与思源连接外部 MCP 的客户端 OAuth 配置相互独立，默认关闭。
     * OAuth 使用授权码与 PKCE S256，支持 client_secret_basic 和 client_secret_post，不支持动态注册。
     * 访问令牌最长有效一小时；offline_access 刷新令牌轮换并在授权后三十天过期，重放会撤销同一授权。
     * OAuth 令牌只用于 /mcp，不能用于管理接口或其他内核 API，且不会解锁加密笔记本。
     */
    "/api/mcp/getOAuth": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": MCPOAuthStatus; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 接收 id 删除客户端并撤销授权，或传 all: true 撤销全部授权但保留注册。
     * 要求管理员权限并禁止只读模式。
     */
    "/api/mcp/removeOAuthClient": {
        request: MCPOAuthRemoveRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 接收 enabled 和不含路径的 HTTPS publicURL，要求管理员权限并禁止只读模式。
     * 启用需要锁屏密码或 OIDC 登录；关闭、修改地址或管理员认证配置会撤销已有授权。
     * 服务端 OAuth 与连接外部 MCP 的客户端 OAuth 配置相互独立，默认关闭；协议说明见 `/api/mcp/getOAuth`。
     */
    "/api/mcp/setOAuth": {
        request: MCPOAuthConfigInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * URL、TLS 和 Cookie 诊断对象包含标准库的原始 JSON。
     * 已声明字段及其类型保持稳定；工具链新增的诊断字段通过 JSONValue 索引读取，不保证跨版本存在。
     */
    "/api/network/echo": {
        request: Blob;
        response: { "code": 0; "data": NetworkEchoData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "raw";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * URL、TLS 和 Cookie 诊断对象包含标准库的原始 JSON。
     * 已声明字段及其类型保持稳定；工具链新增的诊断字段通过 JSONValue 索引读取，不保证跨版本存在。
     */
    "/api/network/echo/*path": {
        request: Blob;
        response: { "code": 0; "data": NetworkEchoData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "raw";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/network/forwardProxy": {
        request: NetworkForwardRequestInput;
        response: { "code": 0; "data": NetworkForwardData; "msg": string; } | { "code": -1 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/network/proxy": {
        request: Blob;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "raw";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
        output: "proxy";
        proxy: {"kind":"http","contentType":"application/octet-stream","upstreamStatuses":true};
    };
    /**
     * 改密恢复和密钥切换保留现存加密笔记本的认证、信封格式及中断恢复检查。
     */
    "/api/notebook/changeMasterPassword": {
        request: ChangeMasterPasswordRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/changeSortNotebook": {
        request: ChangeSortNotebookRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/closeNotebook": {
        request: CloseNotebookRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 移出已导出的加密笔记本，要求管理员权限并禁止只读模式；saved: true 表示用户确认已保存归档。
     * 提交前重新检查源文件，内容变化需重新导出；重复提交同一归档不会重复移出，未选择的笔记本不受影响。
     * 移出前保留归档及源目录检查，失败时保留原归档和密钥材料。
     */
    "/api/notebook/commitNotebookArchive": {
        request: CommitNotebookArchiveRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/createEncryptedNotebook": {
        request: CreateEncryptedNotebookRequestInput;
        response: { "code": 0; "data": CreateNotebookData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/createNotebook": {
        request: CreateNotebookRequestInput;
        response: { "code": 0; "data": CreateNotebookData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/disableEncryptedNotebooks": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/enableEncryptedNotebooks": {
        request: NotebookPasswordRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/exportNotebookCryptoBackup": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": NotebookCryptoBackupData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/getEncryptedNotebookStatus": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": EncryptedNotebookStatusData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/notebook/getNotebookArchiveCandidates": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": NotebookArchiveCandidatesData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 保留配置与权限过滤；管理员响应包含 documentCapabilities。
     * structuredPaths 声明 ID 与标题段接口支持，literalSlash 仅在 indexState=ready 时为 true。
     * titleFormats 列出支持的标题格式；revision 标识能力声明，不是文档路径或配置版本。
     * 能力声明不授予关闭或锁定笔记本的访问权，也不表示允许与旧客户端混用。
     * 认证、锁定和网络失败不能解释为缺少能力对象，失败后不得回退到旧接口继续写入。
     */
    "/api/notebook/getNotebookConf": {
        request: CloseNotebookRequestInput;
        response: { "code": 0; "data": NotebookConfData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/notebook/getNotebookInfo": {
        request: NotebookIDRequestInput;
        response: { "code": 0; "data": NotebookInfoData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 接收 multipart 的 file、旧 password 和可选密钥备份 key，要求管理员权限并禁止只读模式。
     * 恢复目标必须关闭同步，且没有加密密钥配置或加密数据；密文全部通过认证后才发布，恢复后保持锁定。
     * 认证后、安装任何数据或密钥前检查全部源身份的寻址能力；不能通过旧归档降低本机已确认的要求。
     */
    "/api/notebook/importNotebookArchive": {
        request: ImportNotebookArchiveRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/importNotebookCryptoBackup": {
        request: ImportNotebookCryptoBackupRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/lockEncryptedNotebooksOnSystemLock": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/lockNotebook": {
        request: NotebookIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/lsNotebooks": {
        request: ListNotebooksRequestInput;
        response: { "code": 0; "data": ListNotebooksData | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "legacyOptional";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/notebook/openNotebook": {
        request: OpenNotebookRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 接收已锁定的加密笔记本 ID，返回归档 ID 和下载路径，不删除源数据，要求管理员权限。
     * 下载完成后，必须由用户确认已保存归档，再调用 `/api/notebook/commitNotebookArchive` 并传入 saved: true。
     * 源格式或认证检查失败时返回 -1，保留源目录及密钥材料。
     */
    "/api/notebook/prepareNotebookArchive": {
        request: PrepareNotebookArchiveRequestInput;
        response: { "code": 0; "data": NotebookArchiveData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/removeNotebook": {
        request: NotebookIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/renameNotebook": {
        request: RenameNotebookRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/reorder": {
        request: ReorderNotebooksRequestInput;
        response: { "code": 0; "data": ReorderData | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | ReorderData | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 保存本机加密笔记本锁屏策略，成功后广播 system 设置变更通知，供其他客户端重新读取配置。
     */
    "/api/notebook/setEncryptedNotebookFollowSystemLock": {
        request: EncryptedNotebookFollowSystemLockRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/setNotebookConf": {
        request: SetNotebookConfRequestInput;
        response: { "code": 0; "data": NotebookConf | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 自动锁定分钟数由内核内存值驱动锁定行为，写入后无需广播供其他客户端重读。
     */
    "/api/notebook/setNotebookCryptoAutoLock": {
        request: NotebookCryptoAutoLockRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/setNotebookIcon": {
        request: SetNotebookIconRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/notebook/touchEncryptedNotebooks": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 解锁及挂载均保留源格式与认证检查；失败时不发布解锁状态或修复源数据。
     */
    "/api/notebook/unlockAndOpenNotebook": {
        request: UnlockNotebookRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 密钥恢复和解锁保持既有认证及源格式检查，保留原密文和恢复材料。
     */
    "/api/notebook/unlockNotebook": {
        request: UnlockNotebookRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/notification/pushErrMsg": {
        request: NotificationRequestInput;
        response: { "code": 0; "data": NotificationData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/notification/pushMsg": {
        request: NotificationRequestInput;
        response: { "code": 0; "data": NotificationData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/outline/getDocHeadingNumbers": {
        request: HeadingNumbersRequestInput;
        response: { "code": 0; "data": Record<string, string> | null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/outline/getDocOutline": {
        request: OutlineRequestInput;
        response: { "code": 0; "data": Array<SearchPath | null> | null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/petal/getPluginPublishInfo": {
        request: PluginPublishRequestInput;
        response: { "code": 0; "data": PluginPublishInfo; "msg": string; } | { "code": -1 | 400 | 403 | 500; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/petal/loadPetals": {
        request: LoadPetalsRequestInput;
        response: { "code": 0; "data": Array<Petal | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/petal/loadPluginPublishData": {
        request: PluginPublishRequestInput;
        response: { "code": 0; "data": Record<string, null | string | number | boolean>; "msg": string; } | { "code": -1 | 400 | 403 | 404 | 500; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/petal/savePluginPublishData": {
        request: SavePluginPublishDataRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 400 | 403 | 500; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/petal/setPetalEnabled": {
        request: SetPetalEnabledRequestInput;
        response: { "code": 0; "data": Petal | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/petal/setPetalPublishEnabled": {
        request: SetPetalPublishEnabledRequestInput;
        response: { "code": 0; "data": Petal | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/petal/setPluginPublishDataGrant": {
        request: SetPluginPublishDataGrantRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 400 | 403 | 500; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/plugin/getLoadedPlugin": {
        request: LoadedPluginRequestInput;
        response: { "code": 0; "data": LoadedPlugin | null; "msg": string; } | { "code": -1 | 1 | 2 | 3 | 4; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/plugin/listLoadedPlugins": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<LoadedPlugin | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 实际 RPC 方法与通知在脚本执行至 Promise 完成期间保留工作空间写入租约，
     * 取消 HTTP 等待者不会提前释放；准入失败沿用 -32603，通知仍不回复。
     */
    "/api/plugin/rpc": {
        request: PluginRPCRequestFieldsInput | [PluginRPCRequestFieldsInput, ...Array<PluginRPCRequestFieldsInput>];
        response: (PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; }) | [(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; }), ...Array<(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; })>] | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
        output: "directJSON";
        noContent: true;
    };
    /**
     * 与查询参数形式使用相同的逐方法写入准入规则。
     */
    "/api/plugin/rpc/:name": {
        request: PluginRPCRequestFieldsInput | [PluginRPCRequestFieldsInput, ...Array<PluginRPCRequestFieldsInput>];
        response: (PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; }) | [(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; }), ...Array<(PluginRPCSuccess & { "error"?: never; }) | (PluginRPCFailure & { "result"?: never; })>] | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
        output: "directJSON";
        noContent: true;
    };
    /**
     * 执行全局派生索引库 SQL，要求管理员身份及可写运行环境。
     * mode 省略、null 或空字符串时允许单条读写语句；readonly 仅允许单条只读 SELECT 或 WITH 查询。
     * multiple 按顺序执行多条读写语句，返回最后一条的结果；失败后停止，已完成的写入不自动回滚。
     * 无结果列的语句成功时返回空数组，RETURNING 保留结果行；校验失败返回 -1，执行失败返回 1。
     * 返回行数沿用搜索上限及显式外层 LIMIT 规则；直接修改索引不更新源文档、全文索引和块缓存。
     */
    "/api/query/sql": {
        request: SQLQueryRequestInput;
        response: { "code": 0; "data": Array<Record<string, null | string | number | boolean> | null>; "limit": number; "msg": string; "truncated": boolean; } | ({ "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; } & { "limit"?: never; "truncated"?: never; });
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 提及数量提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，发布读者不发送提示。
     * 可选 sourceFilter.database 按单个数据库的字段筛选反链及数量，不影响提及或数据库原视图。
     */
    "/api/ref/getBacklink2": {
        request: BacklinkListRequestInput;
        response: { "code": 0; "data": (BacklinkList & { "refDefs"?: never; }) | (BacklinkRefDefs & { "backlinks"?: never; "backmentions"?: never; "box"?: never; "k"?: never; "linkRefsCount"?: never; "mentionsCount"?: never; "mk"?: never; "revision"?: never; "unchanged"?: never; }) | null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null | (BacklinkList & { "refDefs"?: never; }) | (BacklinkRefDefs & { "backlinks"?: never; "backmentions"?: never; "box"?: never; "k"?: never; "linkRefsCount"?: never; "mentionsCount"?: never; "mk"?: never; "revision"?: never; "unchanged"?: never; }) | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 返回实际绑定反链来源的数据库名称及字段元数据，不返回条目值。
     * 忽略当前数据库条件并应用其他来源限制；发布读者不可查询，保持加密笔记本隔离及请求租约。
     */
    "/api/ref/getBacklinkDatabases": {
        request: BacklinkDatabasesRequestInput;
        response: { "code": 0; "data": Array<BacklinkDatabase | null> | null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * sourceFilter.database 在父块合并前按来源块的数据库字段筛选，不修改原数据库视图。
     * 无条件仅筛数据库成员，失效字段不放宽结果；原来源筛选、排序及加密笔记本租约保持不变。
     * blockSort 为 0（默认）时保持正文顺序，1 按匹配引用的锚文本自然升序，2 为自然降序，其他值回退正文顺序。
     * 条目取首个匹配引用的锚文本并去除首尾空白；排序键相同时保持正文顺序，无锚文本的条目在两个方向均置后。
     * 来源文档内部把整篇文档条目展开为可独立排序的引用，恢复正文顺序时重新合并；排序模式参与上下文版本哈希。
     */
    "/api/ref/getBacklinkDoc": {
        request: BacklinkDocumentRequestInput;
        response: { "code": 0; "data": BacklinkContextData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 提及数量提示使用可选请求头 X-SiYuan-App-ID 定向；无标识时广播，发布读者不发送提示。
     */
    "/api/ref/getBackmentionDoc": {
        request: BackmentionDocumentRequestInput;
        response: { "code": 0; "data": BacklinkContextData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 数据库条件与列表快照一致，不修改来源数据或原数据库视图。
     * 必需的 snapshot 与最多 20 个属于该快照的块 ids 返回可独立编辑的块正文，保留面包屑和数据库引用信息。
     * 返回前重新检查来源权限并持有加密笔记本请求租约；发布阅读者不能读取加密笔记本。
     */
    "/api/ref/getGlobalBacklinkContexts": {
        request: GlobalBacklinkContextRequestInput;
        response: { "code": 0; "data": GlobalBacklinkContextData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * sourceFilter.database 在完整结果分页前求值，快照绑定全部筛选条件；原分页、排序和访问检查保持不变。
     */
    "/api/ref/getGlobalBacklinks": {
        request: GlobalBacklinkListRequestInput;
        response: { "code": 0; "data": GlobalBacklinkListData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/ref/refreshBacklink": {
        request: RefreshBacklinkRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 只读检查变更，复用已确认的本机大小及精细时间，记录缺失或变化时读取内容。
     * 不下载资源或写入缓存；大小和时间完全相同且没有本进程写入标记的外部修改需使用完整校验。
     */
    "/api/repo/checkSnapshot": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": CheckSnapshotData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/repo/checkoutRepo": {
        request: CheckoutRepoRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 创建快照；fullCheck 默认为 false，为 true 时读取所有本地已落盘文件核对内容。
     * 未下载资源沿用其逻辑版本；无变化时返回原快照并令 created 为 false。大文件较多时完整校验耗时更长。
     */
    "/api/repo/createSnapshot": {
        request: CreateSnapshotRequestInput;
        response: { "code": 0; "data": CreateSnapshotData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/repo/diffRepoSnapshots": {
        request: DiffRepoSnapshotsRequestInput;
        response: { "code": 0; "data": RepoDiffData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/repo/downloadCloudSnapshot": {
        request: DownloadCloudSnapshotRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/repo/exportRepoFile": {
        request: ExportRepoFileRequestInput;
        response: { "code": 0; "data": RepoExportData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 可选的 startTime、endTime 按创建时间筛选后分页，筛选遍历索引页。
     * 时间为非负整数 Unix 毫秒时间戳，包含起点、不包含终点；省略或为 0 表示该端无界。
     * 两端均非 0 时终点必须大于起点；读取失败返回错误，不返回部分结果。
     */
    "/api/repo/getCloudRepoSnapshots": {
        request: GetCloudRepoSnapshotsRequestInput;
        response: { "code": 0; "data": RepoCloudSnapshotsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/repo/getCloudRepoTagSnapshots": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": RepoCloudTagsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 每个文件版本包含 snapshots，按文件 ID 关联全部本地标记快照。
     * snapshots 按快照创建时间倒序，同一快照的多个标记合并；无关联时为空数组，不读取文件正文。
     */
    "/api/repo/getRepoDocHistory": {
        request: GetRepoDocHistoryRequestInput;
        response: { "code": 0; "data": RepoDocHistoryData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/repo/getRepoFile": {
        request: GetRepoFileRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
        output: "binary";
    };
    /**
     * 可选的 `id` 按 7 至 40 位十六进制 ID 前缀查询本地快照，忽略首尾空白和大小写。
     * 前缀匹配多个快照时全部返回，按创建时间降序；page 仍为必填，但按 ID 查询时不参与分页。
     * 省略或留空 ID 时按页查询；未找到返回空列表，格式错误、损坏或读取失败返回错误。
     * includeFiles 默认为 false；传入 true 时必须提供完整 ID，并返回该快照的文件元数据，不读取正文。
     * 结果的 tags 包含按名称排序的全部标记，未标记时为空数组；分页与 ID 查询均返回此字段。
     * 可选的 startTime、endTime 按创建时间筛选后分页，也应用于 ID 查询。
     * 时间为非负整数 Unix 毫秒时间戳，包含起点、不包含终点；省略或为 0 表示该端无界。
     * 两端均非 0 时终点必须大于起点；ID 查询应用时间范围后仍忽略分页。
     * 要求管理员权限，返回已有的快照元数据及资源下载状态，不下载或回滚快照。
     */
    "/api/repo/getRepoSnapshots": {
        request: GetRepoSnapshotsRequestInput;
        response: { "code": 0; "data": RepoSnapshotsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 按标记逐行返回快照，tag 是当前行供上传、移除使用的标记，tags 是全部别名。
     */
    "/api/repo/getRepoTagSnapshots": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": RepoTagsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/repo/importRepoKey": {
        request: ImportRepoKeyRequestInput;
        response: { "code": 0; "data": RepoKeyData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/repo/initRepoKey": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": RepoKeyData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/repo/initRepoKeyFromPassphrase": {
        request: InitRepoKeyFromPassphraseRequestInput;
        response: { "code": 0; "data": RepoKeyData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/repo/openRepoSnapshotFile": {
        request: OpenRepoSnapshotFileRequestInput;
        response: { "code": 0; "data": RepoOpenFileData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/repo/purgeCloudRepo": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/repo/purgeRepo": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/repo/removeCloudRepoTagSnapshot": {
        request: RemoveCloudRepoTagSnapshotRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/repo/removeRepoTagSnapshot": {
        request: RemoveRepoTagSnapshotRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/repo/resetRepo": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/repo/rollbackRepoSnapshotFile": {
        request: RollbackRepoSnapshotFileRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/repo/searchRepoFile": {
        request: SearchRepoFileRequestInput;
        response: { "code": 0; "data": RepoSearchData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/repo/setRepoIndexRetentionDays": {
        request: SetRepoIndexRetentionDaysRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/repo/setRetentionIndexesDaily": {
        request: SetRetentionIndexesDailyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/repo/setSnapshotMemo": {
        request: SetSnapshotMemoRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/repo/tagSnapshot": {
        request: TagSnapshotRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/repo/uploadCloudSnapshot": {
        request: UploadCloudSnapshotRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * waits for the document and deck transaction; persistence or commit
     * failures return code -1 with null data instead of reporting an unsaved deck.
     */
    "/api/riff/addRiffCards": {
        request: RiffDeckCardsRequestInput;
        response: { "code": 0; "data": RiffDeck | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/riff/batchSetRiffCardsDueTime": {
        request: SetRiffCardsDueRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/riff/createRiffDeck": {
        request: CreateRiffDeckRequestInput;
        response: { "code": 0; "data": RiffDeck | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/riff/getNotebookRiffCards": {
        request: RiffCardsRequestInput;
        response: { "code": 0; "data": RiffCardsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/riff/getNotebookRiffDueCards": {
        request: RiffNotebookDueCardsRequestInput;
        response: { "code": 0; "data": RiffDueCardsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 按到期时间升序分页，零到期时间的新卡排在前面，相同到期时间按卡片 ID 排序。
     */
    "/api/riff/getRiffCards": {
        request: RiffCardsRequestInput;
        response: { "code": 0; "data": RiffCardsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/riff/getRiffCardsByBlockIDs": {
        request: RiffBlockIDsRequestInput;
        response: { "code": 0; "data": RiffBlocksData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/riff/getRiffDecks": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<RiffDeck | null>; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/riff/getRiffDueCards": {
        request: RiffDueCardsRequestInput;
        response: { "code": 0; "data": RiffDueCardsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/riff/getTreeRiffCards": {
        request: RiffCardsRequestInput;
        response: { "code": 0; "data": RiffCardsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/riff/getTreeRiffDueCards": {
        request: RiffTreeDueCardsRequestInput;
        response: { "code": 0; "data": RiffDueCardsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * waits for the document and deck transaction; persistence or
     * commit failures return code -1 with null data. Empty deckID removes from all decks.
     */
    "/api/riff/removeRiffCards": {
        request: RiffDeckCardsRequestInput;
        response: { "code": 0; "data": RiffDeck | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/riff/removeRiffDeck": {
        request: RiffDeckRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/riff/renameRiffDeck": {
        request: RenameRiffDeckRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/riff/resetRiffCards": {
        request: ResetRiffCardsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/riff/reviewRiffCard": {
        request: ReviewRiffCardRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/riff/skipReviewRiffCard": {
        request: RiffCardRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * method 缺省或为 null 时使用文本替换，支持文本（0）、查询语法（1）和正则表达式（3）。
     * SQL（2）和语义搜索（4）返回 code=1 与提示信息，不执行替换；ids 为空时表示替换全部。
     * 文本与查询语法替换的所有启用类型遵循搜索配置的 caseSensitive，替换串按字面量写入。
     * 正则模式的大小写匹配由表达式决定，替换串支持捕获组展开。
     * 每次文档写盘成功后清理该文档及关联跨文档撤销记录，并广播更新后的撤销状态。
     * 同一文档的标题、标签及正文汇总后仅提交一次，普通和加密文档均以已认证扫描源做条件写入。
     * 并发修改或删除导致 code=1，保留当前文件及其撤销记录；此前已成功提交的文档不回滚。
     */
    "/api/search/findReplace": {
        request: FindReplaceRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 使用 method 选择 0（关键词）、1（查询语法）、2（管理员 SQL）或 3（正则表达式）。
     * orderBy 为 0 时优先返回相关度高的结果，为 1 时优先返回相关度低的结果；2/3 分别为更新时间升序/降序。
     * 相关度按 FTS5 的 BM25 分数解释（越小越相关）；正则无 FTS 相关度，相关度排序选项按路径排序；SQL 使用自身的排序。
     */
    "/api/search/fullTextSearchAssetContent": {
        request: SearchAssetContentRequestInput;
        response: { "code": 0; "data": SearchAssetContentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * SQL 模式保留换行、注释与字面量大小写，支持带别名的完整块投影。
     * 关键字和查询语法模式下，精确块 ID 仍遵循笔记本、文档路径、类型、子类型和忽略条件。
     * 关键字模式的多词文档搜索按字面量匹配 %、_ 和反斜杠；按文档分组只整理当前页，不改变分页单位。
     */
    "/api/search/fullTextSearchBlock": {
        request: FullTextSearchBlockRequestInput;
        response: { "code": 0; "data": FullTextSearchBlockData | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 按索引记录 ID 获取完整预览；queryMethod 为 0（关键词）或 1（查询语法）时使用 FTS 高亮，
     * 为 3 时按搜索使用的 Go 正则语义高亮；为 2（SQL）时不将 SQL 用作 MATCH，返回不高亮的完整内容。
     * 正则无效或仅命中文件名时仍返回完整内容；内容中的 HTML 会转义，仅输出 mark/br 标记。
     */
    "/api/search/getAssetContent": {
        request: AssetContentRequestInput;
        response: { "code": 0; "data": AssetContentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/search/getAssetContentByPath": {
        request: SearchPathRequestInput;
        response: { "code": 0; "data": AssetContentData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 返回的文档面包屑项可附带 documentTitle，name 保留完整路径；标题不受路径分隔符影响。
     */
    "/api/search/getEmbedBlock": {
        request: GetEmbedBlockRequestInput;
        response: { "code": 0; "data": EmbedBlocksData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/search/listInvalidBlockRefs": {
        request: SearchPageRequestInput;
        response: { "code": 0; "data": SearchBlocksData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/search/removeTemplate": {
        request: SearchPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/search/searchAsset": {
        request: SearchAssetRequestInput;
        response: { "code": 0; "data": Array<SearchAsset | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 返回的文档面包屑项可附带 documentTitle，供客户端按偏好显示独立标题或完整 name 路径。
     */
    "/api/search/searchEmbedBlock": {
        request: SearchEmbedBlockRequestInput;
        response: { "code": 0; "data": EmbedBlocksData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 的 exactDocTitle 默认关闭，保留候选搜索行为；启用后仅匹配完整文档标题，
     * 先区分大小写，再忽略大小写，同级匹配按 ID 升序取一个，排除 id 和 rootID。
     * 精确匹配不受全文搜索字段、类型、忽略规则或结果上限影响；未匹配时 newDoc 为 true。
     * 保留发布权限、加密笔记本租约和原有响应变体，查询或文档读取失败时返回错误。
     */
    "/api/search/searchRefBlock": {
        request: SearchRefBlockRequestInput;
        response: { "code": 0; "data": SearchRefResult | (SearchRefCorrelation & { "blocks"?: never; "k"?: never; "newDoc"?: never; }); "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | SearchRefResult | (SearchRefCorrelation & { "blocks"?: never; "k"?: never; "newDoc"?: never; }); "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/search/searchTag": {
        request: SearchTagRequestInput;
        response: { "code": 0; "data": SearchTagData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/search/searchTemplate": {
        request: SearchKeywordRequestInput;
        response: { "code": 0; "data": SearchTemplateData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/search/searchWidget": {
        request: SearchKeywordRequestInput;
        response: { "code": 0; "data": SearchWidgetData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/search/semanticSearchBlock": {
        request: SearchBlockRequestInput;
        response: { "code": 0; "data": SearchBlocksData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/search/updateEmbedBlock": {
        request: UpdateEmbedBlockRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/setting/addVirtualBlockRefExclude": {
        request: VirtualBlockRefRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/setting/addVirtualBlockRefInclude": {
        request: VirtualBlockRefRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 确认 `/api/setting/resetSettings` 发起的重置，要求管理员权限并禁止只读写入。
     * 接收 prepareSettingsReset 通知中的一次性 token；已保存待提交内容时传入 saved: true，保存失败传 false。
     * 主客户端在确认前暂停布局保存；15 秒未确认则取消，收到 cancelSettingsReset 后恢复正常保存。
     */
    "/api/setting/confirmSettingsReset": {
        request: ConfirmSettingsResetRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/setting/getBootAppearances": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SettingBootAppearancesData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * `cached: true` 仅返回内存中的账户，未登录时返回 null。
     * 此模式忽略 token，不联网、不等待同步或切换资源来源；缓存结果不代表云端凭据仍然有效。
     * 省略 cached 或传入 false 时执行账户恢复和令牌刷新；非管理员在两种模式下均得到 null。
     * 客户端可先读取缓存完成初始化，再刷新账户，并通过 setCloudUser 主通道事件接收账户变化。
     */
    "/api/setting/getCloudUser": {
        request: SettingCloudUserRequestInput;
        response: { "code": 0; "data": SettingUser | null; "msg": string; } | { "code": -1 | 1 | 255; "data": { "closeTimeout": number; } | null | SettingUser | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/setting/getPandocBin": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/setting/getPublish": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SettingPublishData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 读取单个配置段，字段与脱敏规则与 /api/system/getConf 一致，仅返回请求的配置段以减少传输量。
     * namespace 必须是已注册的配置段；需要完整配置的启动和重连场景仍使用 /api/system/getConf。
     */
    "/api/setting/getSection": {
        request: SettingGetSectionRequestInput;
        response: { "code": 0; "data": SettingSectionData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/setting/login2faCloudUser": {
        request: SettingLogin2faRequestInput;
        response: Login2faEnvelope | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
        output: "directJSON";
    };
    "/api/setting/logoutCloudUser": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 保留省略字段，成功后客户端重新读取配置；通知不包含密码或密钥。
     * export.blockRefMode 的旧值 0、1、5 按旧设置接口的兼容语义转换为 4；启动迁移由配置版本控制。
     * 同步地址沿用专用保存接口的校验，更换来源须保留完整资源检查，间隔使用规范化后的值调度。
     * 存在字段诊断时在 data.issues 返回；error 阻止写入，warning 随已规范化的成功结果返回。
     * 编辑器、导出、搜索、文档树、外观、闪卡和智能体字段使用对应设置接口的范围规范化规则。
     * system.autoLaunch2 仅接受 0、1、2，lockScreenMode 仅接受 0、1，越界值回退 0。
     * sync.assetDownloadMode 的非法值仍拒绝写入；repo.indexRetentionDays 的正值不设上限。
     */
    "/api/setting/patch": {
        request: PatchSettingRequestInput;
        response: { "code": 0; "data": SettingPatchData | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null | SettingPatchData | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/setting/refreshVirtualBlockRef": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 接收可选的 exit（默认 false），要求管理员权限并禁止只读写入。
     * 仅重置当前工作空间的普通偏好、内置快捷键和当前布局；保留笔记、历史、历史保留天数、学习进度、
     * 账号、认证、同步、加密及恢复材料、AI/MCP、插件和代码片段及其启用状态、已保存布局、语言及应用级设置。
     * 已连接的主客户端收到 prepareSettingsReset 后，须保存待提交内容并暂停布局保存，再用通知中的一次性
     * token 调用 `/api/setting/confirmSettingsReset`，传入 saved: true；保存失败传 false，15 秒未确认则取消。
     * 成功后 settingsReset 通知所有主客户端直接重载；exit: true 仅让管理本地内核的桌面主窗口重载后正常退出，
     * 不直接停止远程内核；失败时 cancelSettingsReset 携带此次操作 ID，客户端应恢复正常保存。
     * 插件调用前应先取得用户确认，并确保未保存内容已经提交；重复调用恢复同一组默认值。
     */
    "/api/setting/resetSettings": {
        request: ResetSettingsRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 使用共享规范化规则；智能体确认超时负数回退 600 秒，0 保留无限等待语义。
     * web 初始搜索为 Exa、抓取为直接请求，可独立切换到共用密钥的 DeepSeek。
     * 工具调用轮数和输出 token 上限的负数归零；温度超出 0–2 回退 1。
     * 嵌入并发数和批大小省略、null 或小于 1 时分别使用 8 和 10，超过上限时分别限制为 64 和 128。
     * 旧客户端的平铺 decision.endpoint、apiKey、name、timeout 迁移到 profiles.typesafe；提交 profiles 时以该对象为准。
     * ChatGPT 账户绑定变化时与主配置一起可恢复提交，失败时回滚且不发布新配置；未变化时不访问绑定存储。
     */
    "/api/setting/setAI": {
        request: SetAIRequestInput;
        response: { "code": 0; "data": SettingAI | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 限定关闭按钮行为：closeButtonBehavior 仅接受 0、1，越界值回退 0。
     * entryVisibility 省略时保持当前方案，null 还原默认显隐方案。
     */
    "/api/setting/setAppearance": {
        request: SetAppearanceRequestInput;
        response: { "code": 0; "data": SettingAppearance | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/setting/setBazaar": {
        request: SetBazaarRequestInput;
        response: { "code": 0; "data": SettingBazaar | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/setting/setBazaarPetalDisabled": {
        request: SettingPetalDisabledRequestInput;
        response: { "code": 0; "data": SettingPetalDisabledData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/setting/setBootAppearance": {
        request: SettingBootAppearanceRequestInput;
        response: { "code": 0; "data": SettingBootAppearanceSelection | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 使用与启动、导入相同的规范化规则并同步保存。
     * 锚文本长度 1–5120 保持不变，小于 1 回退 64；字体大小超出 9–72 回退 16。
     * backlinkGlobalSort、backlinkBlockSort、floatWindowMode、headingEmbedMode 仅接受 0、1、2，越界值回退 0。
     * databaseAttrClickMode、databaseAttrViewMode 仅接受 0、1；codeTabSpaces 仅接受 0、2、4、6、8，越界值回退 0。
     * 只提交 fontFamily、fontWeight 时按新的首选字体重建 fontFamilies；显式提交 fontFamilies 时以该列表为准。
     */
    "/api/setting/setEditor": {
        request: SetEditorRequestInput;
        response: { "code": 0; "data": SettingEditor | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/setting/setEditorReadOnly": {
        request: EditorReadOnlyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/setting/setEmoji": {
        request: SettingEmojiRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 的版本 7 方案可用 defaults 指定 simple 或 full，未覆盖的显隐跟随该内置方案。
     * 省略 defaults 的方案及旧版本方案保留独立显隐语义；entries 中的布尔值始终优先，未知入口和插件排序保留。
     */
    "/api/setting/setEntryVisibility": {
        request: SetEntryVisibilityRequestInput;
        response: { "code": 0; "data": SettingEntryVisibility | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 合并提交的导出配置，将 blockRefMode 的废弃值 0、1、5 转换为 4 后同步保存并回显。
     * blockEmbedMode 仅接受 0、1，越界值回退 1；fileAnnotationRefMode 仅接受 0、1，越界值回退 0。
     * blockRefMode 的其他取值原样保留；省略的字段保持当前值，null 还原默认值。
     */
    "/api/setting/setExport": {
        request: SetExportRequestInput;
        response: { "code": 0; "data": SettingExport | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 使用与启动、导入相同的路径和数值规范化规则。
     * maxListCount 小于 1 回退 512，largeFileWarningSize 小于 2 回退 8，两者大于 10240 时截断至 10240。
     */
    "/api/setting/setFiletree": {
        request: SetFiletreeRequestInput;
        response: { "code": 0; "data": SettingFileTree | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 使用与启动、导入相同的规范化规则；保留零张上限，非法记忆参数和权重恢复默认值。
     * reviewMode 仅接受 0、1、2，越界值回退 0。
     */
    "/api/setting/setFlashcard": {
        request: SetFlashcardRequestInput;
        response: { "code": 0; "data": SettingFlashcard | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/setting/setIcon": {
        request: SettingIconRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 整体替换快捷键配置：data 必须提交完整的快捷键对象，只提交部分分组会清空未提交的快捷键。
     * 单条快捷键请使用 /api/setting/patch 的 keymap 命名空间，该接口按对象递归合并。
     */
    "/api/setting/setKeymap": {
        request: SettingKeymapRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 认证账户须提交完整数组，传 null 或空数组表示清空账户。
     */
    "/api/setting/setPublish": {
        request: SetPublishRequestInput;
        response: { "code": 0; "data": SettingPublishData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 使用与启动、导入相同的规范化规则；limit 小于 1 回退 64，1–31 提升至 32，大于 10240 时截断至 10240。
     * 反链提及关键词上限小于 1 回退 512。
     */
    "/api/setting/setSearch": {
        request: SetSearchRequestInput;
        response: { "code": 0; "data": SettingSearch | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/setting/setSecrets": {
        request: SetSecretsRequestInput;
        response: { "code": 0; "data": SettingSecrets | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/setting/setSnippet": {
        request: SetConfSnippetRequestInput;
        response: { "code": 0; "data": SettingSnpt | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/setting/setTheme": {
        request: SettingThemeRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/setting/setVariables": {
        request: SetVariablesRequestInput;
        response: { "code": 0; "data": SettingVariables | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 为管理员返回完整列表的 revision，即使结果按类型、启用状态或关键字筛选。
     * 全量编辑应读取 type="all"、enabled=2 且不设置 keyword；发布读者不获得 revision。
     */
    "/api/snippet/getSnippet": {
        request: GetSnippetRequestInput;
        response: { "code": 0; "data": SnippetsData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/snippet/removeSnippet": {
        request: TrimmedIDRequestInput;
        response: { "code": 0; "data": Snippet | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 可携带 getSnippet 返回的 revision，在同一临界区检查版本并保存。
     * 版本不匹配返回 code=-1、msg="snippet revision conflict"，不覆盖当前片段；调用方应保留草稿供用户合并。
     * 省略 revision 或传入 null 时无条件全量保存，不能防止旧列表覆盖并发修改。
     */
    "/api/snippet/setSnippet": {
        request: SetSnippetRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/sqlite/flushTransaction": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/storage/batchUpdateRecentDocCloseTime": {
        request: RecentDocsUpdateRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 清空当前工作区的全部最近浏览、打开和关闭记录，不删除文档，也不修改文档创建和修改时间。
     * 记录不参与数据同步；后续浏览、打开或关闭文档会重新产生记录。最近创建和最近修改列表不受影响。
     * 仅允许可写工作区的管理员调用，无需请求参数；重复清空仍返回成功。
     */
    "/api/storage/clearRecentDocs": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/storage/getCriteria": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<Criterion | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/storage/getInlineStyles": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": InlineStyles | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/storage/getLocalStorage": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": { [key: string]: JSONValue } | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/storage/getLocalStorageVal": {
        request: StorageKeyRequestInput;
        response: { "code": 0; "data": JSONValue; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/storage/getLocalStorageVals": {
        request: StorageKeysRequestInput;
        response: { "code": 0; "data": { [key: string]: JSONValue } | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/storage/getOutlineStorage": {
        request: OutlineStorageRequestInput;
        response: { "code": 0; "data": { [key: string]: JSONValue } | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/storage/getRecentDocs": {
        request: RecentDocsRequestInput;
        response: { "code": 0; "data": Array<RecentDoc | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "legacyOptional";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/storage/getViewState": {
        request: StorageKeyRequestInput;
        response: { "code": 0; "data": { [key: string]: JSONValue } | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/storage/patchViewState": {
        request: ViewStatePatchRequestInput;
        response: { "code": 0; "data": { [key: string]: JSONValue } | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/storage/removeCriterion": {
        request: RemoveCriterionRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/storage/removeLocalStorageVal": {
        request: StorageRemoveRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/storage/removeLocalStorageVals": {
        request: StorageRemoveKeysRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/storage/removeOutlineStorage": {
        request: OutlineStorageRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/storage/removeViewState": {
        request: StorageKeyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/storage/setCriterion": {
        request: SetCriterionRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 行级样式与数据库调色板变化由 reloadInlineStyles 专用推送通知其他窗口，不走配置段刷新。
     */
    "/api/storage/setInlineStyles": {
        request: SetInlineStylesRequestInput;
        response: { "code": 0; "data": InlineStyles | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/storage/setLocalStorageVal": {
        request: StorageSetRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/storage/setLocalStorageVals": {
        request: StorageSetKeysRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 写入 data/storage 下独立存储的端点都不是 conf.json 的配置段，因此只持锁不广播。
     */
    "/api/storage/setOutlineStorage": {
        request: OutlineStorageSetRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/storage/setWorkspaceAVPalette": {
        request: WorkspaceAVPaletteRequestInput;
        response: { "code": 0; "data": InlineStyles | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/storage/updateRecentDocCloseTime": {
        request: RecentDocUpdateRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/storage/updateRecentDocOpenTime": {
        request: RecentDocUpdateRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/storage/updateRecentDocViewTime": {
        request: RecentDocUpdateRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 请求取消当前文件恢复任务，taskID 必须来自当前 syncProgress 消息。
     * requested 只表示已接受取消请求，旧任务或已完成任务返回 false；可能先完成恢复，再收到请求。
     * 取消同时传递到准备、云端请求和文件替换边界，保留已完成文件并清理当前临时文件。
     * 解除界面编辑阻挡前同步已落盘变更的索引；不回滚已完成文件，不改变全部下载或按需下载设置。
     * 只读模式可请求取消，不会更改同步配置；调用要求登录和管理员权限。
     */
    "/api/sync/cancelSyncCheckout": {
        request: CancelSyncCheckoutRequestInput;
        response: { "code": 0; "data": CancelSyncCheckoutData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 清除 provider 为 2（S3）、3（WebDAV）或 4（本地文件系统）的配置并同步落盘。
     * 清除当前服务时先验证资源及历史快照完整性，再关闭同步；失败时保留原配置，不删除本地或云端数据。
     * 响应包含当前同步开关及被清除服务的默认配置；其他服务配置、仓库密钥和下载模式保持不变。
     */
    "/api/sync/clearSyncProviderConfig": {
        request: ClearSyncProviderConfigRequestInput;
        response: { "code": 0; "data": ClearSyncProviderConfigData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 确认当前连接已停止新输入并提交既有编辑，saved 为 false 时本轮应用中止。
     * token 仅来自该连接的 syncProgress 消息或状态查询，重复确认幂等，旧任务和未知令牌返回 requested 为 false。
     * 必须确认全部既有连接，且等待期间没有新接入的连接，内核才会应用本地改动。
     */
    "/api/sync/confirmSyncCheckout": {
        request: ConfirmSyncCheckoutRequestInput;
        response: { "code": 0; "data": CancelSyncCheckoutData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/sync/createCloudSyncDir": {
        request: SyncNameRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/sync/exportSyncProviderS3": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SyncProviderExportData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/sync/exportSyncProviderWebDAV": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SyncProviderExportData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/sync/getBootSync": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    /**
     * 查询当前同步任务及单调递增版本，空任务表示当前没有同步任务。
     * 普通后台同步不阻断编辑；准备落盘、应用改动和恢复索引期间 blocking 为 true。
     * 前端启动和重连时查询，以恢复错过的开始、取消或结束通知；appID 和 clientID 用于匹配当前主连接的准备令牌。
     * phase 为 preparing 时先阻止新输入、提交既有编辑，再使用 token 确认保存结果；取消不计入自动同步失败。
     */
    "/api/sync/getSyncCheckout": {
        request: SyncCheckoutClientRequestInput;
        response: { "code": 0; "data": SyncCheckoutSnapshot; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/sync/getSyncInfo": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SyncInfoData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/sync/getSyncLANStatus": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SyncLANStatus; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 返回服务类型 2（S3）、3（WebDAV）或 4（本地文件系统）的共用必填清单。
     * endpoint、bucket 可省略；仅 S3 返回 Endpoint 可能让对象键多出前缀的提示，提示不阻断保存或同步。
     * 此接口只做内存中的静态判定，不读取或保存用户配置，不接收凭据，不访问云端或文件系统。
     * 未知服务返回 code -1；规则提示不替代保存时的完整校验和资源来源保护。只读模式下也可调用。
     */
    "/api/sync/getSyncProviderConfigRules": {
        request: SyncProviderConfigRulesRequestInput;
        response: { "code": 0; "data": SyncProviderConfigRulesData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/sync/importSyncProviderS3": {
        request: SyncProviderImportRequestInput;
        response: { "code": 0; "data": SyncS3Data; "msg": string; } | { "code": -1; "data": ({ "closeTimeout": number; } & { "s3"?: never; }) | null | (SyncS3Data & { "closeTimeout"?: never; }); "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 导入后使用与保存接口相同的地址校验；空白或无效地址不覆盖原配置。
     */
    "/api/sync/importSyncProviderWebDAV": {
        request: SyncProviderImportRequestInput;
        response: { "code": 0; "data": SyncWebDAVData; "msg": string; } | { "code": -1; "data": ({ "closeTimeout": number; } & { "webdav"?: never; }) | null | (SyncWebDAVData & { "closeTimeout"?: never; }); "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/sync/listCloudSyncDir": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": CloudSyncDirsData; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/sync/performBootSync": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/sync/performSync": {
        request: PerformSyncRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/sync/removeCloudSyncDir": {
        request: SyncNameRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/sync/setCloudSyncDir": {
        request: SyncNameRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/sync/setSyncAssetDownloadMode": {
        request: SyncModeRequestInput;
        response: { "code": 0; "data": SyncAssetDownloadModeData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/sync/setSyncEnable": {
        request: SyncEnabledRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/sync/setSyncGenerateConflictDoc": {
        request: SyncEnabledRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/sync/setSyncInterval": {
        request: SyncIntervalRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/sync/setSyncLAN": {
        request: SyncLANRequestInput;
        response: { "code": 0; "data": SyncLANStatus; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/sync/setSyncMode": {
        request: SyncModeRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/sync/setSyncPerception": {
        request: SyncEnabledRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * completeAssets 为 true 时，在切换来源前从原提供商下载缺失的当前资源和历史快照内容；
     * 省略、null 与 false 保留只检查完整性的行为。补齐过程保留下载模式和恢复密钥，失败时保留原提供商。
     * 确认后的操作通过全局进度遮罩显示检查与补齐阶段，成功或失败均关闭遮罩。
     */
    "/api/sync/setSyncProvider": {
        request: SyncProviderRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 在解析绝对路径前拒绝空白地址，避免将其当作内核工作目录保存。
     * 保留现有路径存在性及工作空间边界校验；失败不覆盖原配置，更换来源仍须补齐资源和历史快照。
     */
    "/api/sync/setSyncProviderLocal": {
        request: SetSyncLocalRequestInput;
        response: { "code": 0; "data": SyncLocalData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/sync/setSyncProviderS3": {
        request: SetSyncS3RequestInput;
        response: { "code": 0; "data": SyncS3Data; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 保存有效的 HTTP(S) 地址；地址不能为空，省略协议时补为 HTTPS，保留协议占位符兼容。
     * 用户名和密码允许为空以支持匿名访问；校验失败保留原配置，更换来源仍须补齐资源和历史快照。
     */
    "/api/sync/setSyncProviderWebDAV": {
        request: SetSyncWebDAVRequestInput;
        response: { "code": 0; "data": SyncWebDAVData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 只探测候选配置：端点必须是已有目录且不能与工作空间重叠。
     * 在独占临时目录中写入、读回比对并尽力删除探针，不读取或保存同步配置；kind 沿用 S3 的 ok/config/network 语义。
     * 只读模式可调用，不修改快照或同步开关。删除失败只记脱敏日志，不改变探测结果。
     */
    "/api/sync/testSyncProviderLocal": {
        request: TestSyncProviderLocalRequestInput;
        response: { "code": 0; "data": TestSyncProviderS3Data; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 使用请求中的候选配置探测云端：写入探针对象、按前缀列举并比对、尽力删除探针，不读取或保存用户配置。
     * 请求字段与保存接口一致；缺少必填项或地址无效时同样返回 code 0，由 kind 为 config 表示，避免与网络故障混淆。
     * kind 为 ok 表示写入与列举指向同一个对象键；config 表示可确定的配置错误；network 表示网络或服务端不可达，无法判定配置。
     * 探测会在桶内创建再删除 repo/objects/.s/siyuan-probe-<随机值>-probe，需要该前缀的写入与列举权限；未删除的探针会作为未引用对象被云端清理回收。
     * 只读模式下也可调用，不修改已有快照或同步开关。
     */
    "/api/sync/testSyncProviderS3": {
        request: TestSyncProviderS3RequestInput;
        response: { "code": 0; "data": TestSyncProviderS3Data; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 只探测候选配置：验证端点为集合，创建独占探针目录并写入、读回比对，最后尽力删除。
     * 不读取或保存同步配置，不修改快照或同步开关；只读模式可调用。kind 沿用 S3 的 ok/config/network 语义。
     * cloudName 可省略；指定时在该云端目录的 siyuan/repo 下探测，省略时使用独占的随机云端目录并尽力删除。
     * 上传失败后同样尝试清理；删除失败只记脱敏日志，不改变探测结果。需要集合查询、目录创建、读写和删除权限。
     */
    "/api/sync/testSyncProviderWebDAV": {
        request: TestSyncProviderWebDAVRequestInput;
        response: { "code": 0; "data": TestSyncProviderS3Data; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/system/addCustomEmoji": {
        request: SystemCustomEmojiRequestInput;
        response: { "code": 0; "data": SystemPathData; "msg": string; } | { "code": -1 | 400 | 413; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "form";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/addMicrosoftDefenderExclusion": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/bootProgress": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": BootProgressData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
    };
    /**
     * 无需参数，要求管理员权限并允许只读模式，以当前内核进程身份诊断 data 目录的遍历。
     * text 为 JSON Lines，比较标准库和原始目录项，不读取正文、不写入工作空间、不下载或解密资源。
     * 首行包含思源版本、容器和移动端提供的系统版本，便于关联 Android/SDK 及具体内核版本。
     * Android/Linux 使用 4/8/32 KiB 缓冲区执行三轮；每轮至多 20000 个目录、100000 个目录项及 100 条详情。
     * 包含运行版本、UID、文件系统类型、零 inode、路径差异、目录变化及读取错误；路径相对于 data。
     * 不支持原始目录读取的平台返回 rawSupported=false，不将未执行的比较视为通过。
     * 并发诊断返回 code=-1；请求取消或 60 秒超时会停止后续扫描，不保证并发编辑时的原子快照。
     */
    "/api/system/checkFileTraversal": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SystemFileTraversalData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/system/checkUpdate": {
        request: SystemCheckUpdateRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/system/checkWorkspaceDir": {
        request: SystemPathRequestInput;
        response: { "code": 0; "data": SystemWorkspaceCheckData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/clearTempFiles": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/createWorkspaceDir": {
        request: SystemPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/currentTime": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": number; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
    };
    "/api/system/dismissOnboarding": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SystemOnboarding | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 异步下载当前更新通道中指定版本的桌面安装包，不修改自动下载设置。
     * version 必须与该通道当前可用的新版本完全一致；不接受下载 URL，不支持的运行环境或缺少校验值时返回 -1。
     * 成功返回 null，进度和完成状态沿用更新通知；下载包通过校验后可供退出安装，自动下载关闭时仍可使用。
     * 需要管理员和可写权限；已有下载任务时复用下载互斥保护，并通知正在下载。
     */
    "/api/system/downloadUpdate": {
        request: SystemDownloadUpdateRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/ensureOnboarding": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SystemOnboarding | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 默认保留退出同步及更新选择，返回 0 表示完成、1 表示同步失败、2 表示等待更新选择。
     * 普通退出请求断开时取消其同步或同步锁等待，不将取消报告为同步成功；已开始的数据清理仍完整执行。
     * force 跳过本次同步，并等待活动同步取消及收尾后再关闭数据库；本地未上传数据保留。
     * 可选 recoverExit 绑定当前进程和退出批次，只接管没有活动会话的桌面退出；不匹配返回 -1，有会话返回 3。
     * 接管默认正常同步，recoverExit.force 为 true 时跳过同步但仍执行数据清理；跳过安装提示且不修改工作空间顺序。
     * 顶层 force、execInstallPkg、setCurrentWorkspace 在接管时忽略；省略 recoverExit.force 保持正常同步。
     * 省略或传入 null 时保持原行为及数字截断规则，认证、管理员权限及加密笔记本关闭流程不变。
     */
    "/api/system/exit": {
        request: SystemExitRequestInput;
        response: { "code": 0; "data": SystemExitData; "msg": string; } | { "code": -1 | 1 | 2 | 3; "data": ({ "closeTimeout": number; } & { "installPkgPath"?: never; }) | null | SystemExitData; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 导出单个 JSON 文件的设置压缩包。
     */
    "/api/system/exportConf": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SystemExportConfData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/system/exportLog": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SystemZipData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/system/exportTLSCABundle": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SystemPathData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/system/exportTLSCACert": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SystemPathData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/system/getChangelog": {
        request: SystemChangelogRequestInput;
        response: { "code": 0; "data": SystemChangelogData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "legacyOptional";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/system/getConf": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SystemConfData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/system/getCustomFonts": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<SystemCustomFont | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/system/getEmojiConf": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<SystemEmojiGroup | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/system/getMobileWorkspaces": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<string> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/system/getNetwork": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": NetworkData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    /**
     * 无需请求体，要求管理员权限并允许只读模式，返回 {text} 诊断摘要：内核版本、运行时、操作系统、
     * 逻辑 CPU 数量、当前系统与进程内存，以及检测到的工作空间存储类型。
     * 无法探测的内存或存储返回 unknown，不把移动端存储推断为 SSD；文本不含工作空间路径、主机名和账户标识。
     */
    "/api/system/getRuntimeInfo": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": SystemRuntimeInfoData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/system/getSysFonts": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<SystemFont | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/system/getWorkspaceInfo": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": WorkspaceInfoData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 无需参数，要求管理员权限并允许只读模式，统计当前内核工作空间的本地文件大小。
     * totalSize 为普通文件字节数之和，assetsSize 是 data 的子集，不能重复累加；不含目录分配空间或链接目标。
     * directories 按 data、repo、history、temp、conf、other 排序，calculatedAt 为扫描完成的 Unix 毫秒时间。
     * 扫描不下载资源或解密文件，不返回绝对路径；并发请求共享扫描，完成后不缓存，不保证扫描期间的快照一致性。
     * 扫描期间已删除的子文件或子目录不计入；根目录丢失、权限错误等返回失败。
     * 读取失败或扫描超时返回 code=-1、data=null；调用方应保留旧结果的时间标记，并允许用户重试。
     */
    "/api/system/getWorkspaceStorage": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": WorkspaceStorageData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/system/getWorkspaces": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": Array<SystemWorkspace | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/system/ignoreAddMicrosoftDefenderExclusion": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 导入前按启动和设置接口的相同规则规范化编辑器、导出、文档树、搜索和闪卡偏好，并同步保存。
     * 同时导入外观及界面语言、OCR、代码片段总开关和普通变量；这些配置段缺失或为 null 时保留当前值。
     * 主题、图标和代码片段内容等独立资源不随设置包迁移，外观资源列表使用目标工作空间的可用资源。
     * 账号、API token、同步、锁屏密码、数据仓库和加密笔记本密钥保持不变；沿用本机代理及更新通道。
     * ChatGPT 账户引用从本机工作空间绑定加载，忽略导入文件中的引用；本机绑定读取失败时中止导入。
     * 忽略设置备份中的寻址模式记录，不改变笔记本源格式或加密恢复材料。
     */
    "/api/system/importConf": {
        request: SystemImportConfRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/importCustomFont": {
        request: SystemImportFileRequestInput;
        response: { "code": 0; "data": SystemCustomFont | null; "msg": string; } | { "code": -1 | 400 | 413; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/importTLSCABundle": {
        request: SystemImportFileRequestInput;
        response: { "code": 0; "data": SystemMessageData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 校验锁屏密码并建立当前工作空间的会话。
     * rememberMe 为 true 时 Cookie 有效期为 30 天；否则使用浏览器会话 Cookie，
     * 本机桌面端登录还绑定本次内核启动，工作空间退出重开后须重新认证；隐藏窗口或取消退出不使会话失效。
     * 浏览器、移动端及旧版未携带启动批次的 Cookie 保持原有有效性；旧会话重新登录后应用上述规则。
     */
    "/api/system/loginAuth": {
        request: SystemLoginAuthRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
    };
    "/api/system/logoutAuth": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
    };
    "/api/system/oidc/mobileCallback": {
        request: SystemOIDCMobileRequestInput;
        response: { "code": 0; "data": SystemOIDCMobileData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
    };
    "/api/system/oidc/poll": {
        request: SystemOIDCPollRequestInput;
        response: { "code": 0; "data": SystemOIDCPollData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
    };
    /**
     * 发起 OIDC 登录；rememberMe 的会话有效期及本机桌面启动绑定与 loginAuth 一致。
     */
    "/api/system/oidc/start": {
        request: SystemOIDCStartRequestInput;
        response: { "code": 0; "data": SystemOIDCStartData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
    };
    "/api/system/oidc/validate": {
        request: SystemOIDCRequestInput;
        response: { "code": 0; "data": SystemOIDCStartData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/oidc/validateActivate": {
        request: SystemOIDCPollRequestInput;
        response: { "code": 0; "data": SystemOIDCActivateData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/oidc/validateCancel": {
        request: SystemOIDCPollRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin"];
    };
    "/api/system/oidc/validatePoll": {
        request: SystemOIDCPollRequestInput;
        response: { "code": 0; "data": SystemOIDCValidatePollData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
    };
    "/api/system/rebuildDataIndex": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/removeCustomFont": {
        request: SystemRemoveCustomFontRequestInput;
        response: { "code": 0; "data": SystemRemoveCustomFontData; "msg": string; } | { "code": -1 | 400 | 404; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 删除本工作空间唯一的壁纸文件，需管理员写权限；文件不存在时仍成功。
     * 客户端应先通过配置 patch 关闭 appearance.lockScreenWallpaper，再删除图片。
     */
    "/api/system/removeLockScreenWallpaper": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/removeWorkspaceDir": {
        request: SystemPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/removeWorkspaceDirPhysically": {
        request: SystemPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/setAPIToken": {
        request: SystemAPITokenRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 修改锁屏密码并更新当前会话；已有有效会话保留其启动绑定及记住策略。
     * 没有有效会话时，本机桌面端新建的会话绑定本次内核启动。
     */
    "/api/system/setAccessAuthCode": {
        request: SystemAccessAuthCodeRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/setAppearanceMode": {
        request: SystemAppearanceModeRequestInput;
        response: { "code": 0; "data": SystemAppearanceData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/setAutoLaunch": {
        request: AutoLaunchRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/setDownloadInstallPkg": {
        request: DownloadInstallPkgRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/setFollowSystemLockScreen": {
        request: LockScreenRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/setNetworkProxy": {
        request: NetworkProxyInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/setNetworkServe": {
        request: NetworkServeRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/setNetworkServeTLS": {
        request: NetworkServeTLSRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/setOIDC": {
        request: SystemOIDCRequestInput;
        response: { "code": 0; "data": SystemOIDC | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 更新工作空间的独立设置窗口开关，仅桌面 Electron 客户端使用。
     */
    "/api/system/setSettingsWindow": {
        request: SettingsWindowRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/setUILayout": {
        request: SystemUILayoutRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/setUpdateChannel": {
        request: UpdateChannelRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/setWorkspaceDir": {
        request: SystemPathRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 从 URL 查询参数读取正整数 pid，不读取请求体；无效 pid 或注册表已满时返回空 200。
     */
    "/api/system/uiproc": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
        emptyResponseStatuses: [200];
    };
    /**
     * 替换本工作空间唯一的壁纸文件，需管理员写权限。
     * file 必须是 JPEG、PNG 或 WebP，最多 10 MiB、1600 万像素；重编码为 JPEG，移除元数据。
     * 图片保存在 conf/lockscreen/wallpaper.jpg，不同步、不包含在设置导出中。
     * 上传不修改 appearance.lockScreenWallpaper，客户端须通过配置 patch 启用；失败保留原文件。
     */
    "/api/system/uploadLockScreenWallpaper": {
        request: SystemWallpaperUploadRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "multipart";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/vacuumDataIndex": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/system/version": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
    };
    "/api/tag/getTag": {
        request: GetTagRequestInput;
        response: { "code": 0; "data": Array<TagData | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/tag/removeTag": {
        request: RemoveTagRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/tag/renameTag": {
        request: RenameTagRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/template/docSaveAsTemplate": {
        request: SaveTemplateRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1 | 1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/template/getDocSaveAsTemplateInfo": {
        request: TemplateDocumentRequestInput;
        response: { "code": 0; "data": TemplateDocumentInfo; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * 读取模板源码时，可选的 sourceDocID 表示导出模板末尾文档属性中的静态来源 ID。
     * 普通 Markdown、目录或未声明有效 ID 的模板不返回该字段；读取不会执行模板或检查源文档是否仍可访问。
     * 打开来源时需按当前工作空间的文档访问规则处理失败；该字段不是预览上下文，也不保证模板与源文档保持同步。
     */
    "/api/template/manage": {
        request: TemplateFileRequestInput;
        response: { "code": 0; "data": Array<TemplateFileEntry> | TemplateFileSource | (TemplateFileRevision & { "content"?: never; "path"?: never; "sourceDocID"?: never; }) | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "structJSON";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/template/render": {
        request: RenderTemplateRequestInput;
        response: { "code": 0; "data": RenderTemplateData; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/template/renderSprig": {
        request: RenderSprigRequestInput;
        response: { "code": 0; "data": string; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    /**
     * move 操作支持 nextID，将块移到该同级锚点之前，优先于 previousID 和 parentID。
     * 移动保留折叠标题下辖块顺序及源块身份，不将整列表自动拆成列表项；moveBlock 接口不接受 nextID。
     * 数据库自动化通过 setAttrViewAutomations 操作整体保存，配置 spec 为 1 至 8，所有视图共享数据库级规则。
     * blockSource.types 主类型包含全部子类型；spec 3 可指定 h:h1 至 h:h6、l:u/o/t、i:u/o/t、callout:类型名。
     * blockSource 的 tagMatch、attributeMatch 缺省为 and；spec 3 支持各组独立设置 or，空组不限制，组间仍为 and。
     * spec 4 的 blockSource.tagTarget 支持 block（标签所在块）和 container（最近合格容器），缺省保持原行为。
     * spec 5 的 blockSource.documentDepth 限制各文档范围的子文档深度，0 仅自身，1 包含自身及一级子文档。
     * spec 6 的属性 nameOperator 支持 contains 和 Go regex；缺省或 equals 保持精确名称匹配，值条件独立。
     * spec 7 支持 blockSource.includeSelectedDocuments=false，排除所选文档及其内部块，子文档仍按深度匹配；缺省、null 或 true 保持包含自身。
     * spec 8 的 blockSource.referenceID 匹配正文块引用；文档目标包含内部内容块，不含子文档、嵌入或数据库字段引用。
     * 引用来源按反链规则归并后匹配类型和属性，标签条件约束同一来源块，tagTarget 不参与选择；目标须在同一加密边界。
     * 排除自身不影响其他范围的并集；与 documentDepth=0 组合时对应文档范围为空。配置变更保留条目和字段，不自动补收或清理。
     * 深度缺省或 null 不限，不影响笔记本范围，各范围仍取并集；修改不自动清理或补收已有内容。
     * 容器按类型及属性条件选择并去重；全部标签须在同一个来源块中，文档容器须显式选择 d。
     * 类型和属性始终筛选最终对象；默认首个内容块优先归属合格列表项，每次标签命中只选择一个对象。
     * 无标签时收集对象不影响筛选；变更收集对象不转换已有条目，预览与实际收集使用相同规则。
     * 自动收集只添加条目，原文失配及规则变更均保留已有条目和字段，再次匹配不会重新初始化。
     * setAttrViewAutomations 新增范围最多包含 32 个去重后的笔记本或文档；既有超限规则可保留或删减，撤销重做不截断原范围。
     * cleanupAttrViewBlocks 按全部启用收集规则复查已确认条目及绑定，仅移出明确失配条目，并支持撤销。
     * 规则的 notifyOnSuccess 缺省或 null 为开启，仅实际变更且事务成功提交后通知，同一事务合并；错误提示不受其控制。
     * 手动收集及清理、无变化、撤销重放和失败回滚不发送成功通知。
     * addAttributeViewBlocks、setAttributeViewBlockAttr、batchSetAttributeViewBlockAttrs 触发启用的新增或字段变化规则。
     * 自动操作与原修改一同提交，失败一起回滚；普通 API 写入不生成编辑器撤销记录。
     * 自动化不串联，导入、同步、历史恢复和撤销重放不重新触发；重做保留原条目 ID 和触发时间。
     * 字段失效或目标数据库被删除时，后续条目写入停用规则并保留配置，源修改仍提交；提交后提示失效引用。
     * 修复后需手动启用，撤销源修改不重新启用规则；锁定、认证失败、损坏及实际写入失败仍一起回滚。
     * 跨库动作限于同一加密边界，要求目标可访问；单笔事务最多执行 1000 个自动操作。
     * swapBlockRef 必须独立提交：id 指定引用块，blockID 指定定义块，data 携带 includeChildren 和 originalToEmbed，
     * retData 返回受影响的文档 ID。逆向操作使用受影响顶层块的私有内存快照；快照不传给客户端，也不接受客户端提交。
     * 重放保留块 ID 和数据库绑定，内容或位置已改变时拒绝覆盖；提交失败时补偿已写入的文档。
     * 撤销与重放为所有受影响文档持有笔记本租约，直至响应序列化完成。
     */
    "/api/transactions": {
        request: PerformTransactionsRequestInput;
        response: { "code": 0; "data": Array<Transaction | null> | null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/transactions/clearHistory": {
        request: TransactionClearHistoryRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/transactions/redo": {
        request: TransactionHistoryRequestInput;
        response: { "code": 0; "data": (TransactionHistoryEmpty & { "doOperations"?: never; "failed"?: never; "isUndo"?: never; "msg"?: never; "mutatedRootIDs"?: never; "undoOperations"?: never; }) | (TransactionHistoryFailure & { "canRedo"?: never; "canUndo"?: never; "doOperations"?: never; "isUndo"?: never; "mutatedRootIDs"?: never; "undoOperations"?: never; }) | (TransactionHistoryApplied & { "failed"?: never; "msg"?: never; }); "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/transactions/undo": {
        request: TransactionHistoryRequestInput;
        response: { "code": 0; "data": (TransactionHistoryEmpty & { "doOperations"?: never; "failed"?: never; "isUndo"?: never; "msg"?: never; "mutatedRootIDs"?: never; "undoOperations"?: never; }) | (TransactionHistoryFailure & { "canRedo"?: never; "canUndo"?: never; "doOperations"?: never; "isUndo"?: never; "mutatedRootIDs"?: never; "undoOperations"?: never; }) | (TransactionHistoryApplied & { "failed"?: never; "msg"?: never; }); "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/transactions/undoState": {
        request: TransactionUndoStateRequestInput;
        response: { "code": 0; "data": TransactionUndoState; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated"];
    };
    "/api/ui/reloadAttributeView": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ui/reloadFiletree": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ui/reloadIcon": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ui/reloadProtyle": {
        request: BlockIDRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "json";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ui/reloadTag": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ui/reloadTheme": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/api/ui/reloadUI": {
        request: EmptyRequestInput;
        response: { "code": 0; "data": null; "msg": string; } | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "none";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
    };
    "/oauth/mcp/consent": {
        request: MCPOAuthConsentRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "form";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
        output: "binary";
        contentVariants: [{"status":302,"contentType":"text/html"},{"status":400,"contentType":"text/html"}];
    };
    "/oauth/mcp/revoke": {
        request: MCPOAuthTokenRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "form";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
        output: "binary";
        contentVariants: [{"status":200,"contentType":"application/json"},{"status":400,"contentType":"application/json"},{"status":401,"contentType":"application/json"},{"status":404,"contentType":"application/json"},{"status":429,"contentType":"application/json"},{"status":500,"contentType":"application/json"}];
    };
    "/oauth/mcp/token": {
        request: MCPOAuthTokenRequestInput;
        response: Blob | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "form";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["public"];
        output: "binary";
        contentVariants: [{"status":200,"contentType":"application/json"},{"status":400,"contentType":"application/json"},{"status":401,"contentType":"application/json"},{"status":404,"contentType":"application/json"},{"status":429,"contentType":"application/json"},{"status":500,"contentType":"application/json"}];
    };
    "/plugin/private/:name/*path": {
        request: Blob;
        response: Blob | JSONValue | { "code": -1; "data": { "closeTimeout": number; } | null; "msg": string; };
        body: "raw";
        /** 服务器路由要求；资源权限与笔记本租约仍由内核校验 */
        authorization?: readonly ["authenticated","admin","writable"];
        output: "pluginService";
        pluginService: {"variants":[{"mode":"JSON","statusPolicy":"plugin","mediaTypes":["application/json"],"payload":"json","headersOverrideMedia":true},{"mode":"JSONP","statusPolicy":"plugin","mediaTypes":["application/javascript","application/json"],"payload":"jsonp-or-json","headersOverrideMedia":true},{"mode":"AsciiJSON","statusPolicy":"plugin","mediaTypes":["application/json"],"payload":"json","headersOverrideMedia":true},{"mode":"IndentedJSON","statusPolicy":"plugin","mediaTypes":["application/json"],"payload":"json","headersOverrideMedia":true},{"mode":"PureJSON","statusPolicy":"plugin","mediaTypes":["application/json"],"payload":"json","headersOverrideMedia":true},{"mode":"SecureJSON","statusPolicy":"plugin","mediaTypes":["application/json"],"payload":"secure-json","headersOverrideMedia":true},{"mode":"XML","statusPolicy":"plugin","mediaTypes":["application/xml"],"payload":"xml","headersOverrideMedia":true},{"mode":"YAML","statusPolicy":"plugin","mediaTypes":["application/yaml"],"payload":"yaml","headersOverrideMedia":true},{"mode":"TOML","statusPolicy":"plugin","mediaTypes":["application/toml"],"payload":"toml","headersOverrideMedia":true},{"mode":"ProtoBuf","statusPolicy":"plugin","mediaTypes":["application/x-protobuf"],"payload":"protobuf","headersOverrideMedia":true},{"mode":"file","statusPolicy":"file","mediaTypes":["dynamic"],"payload":"bytes","headersOverrideMedia":true},{"mode":"string","statusPolicy":"plugin","mediaTypes":["text/plain"],"payload":"text","headersOverrideMedia":true},{"mode":"raw","statusPolicy":"plugin","mediaTypes":["dynamic"],"payload":"bytes","headersOverrideMedia":true},{"mode":"stream","statusPolicy":"plugin","mediaTypes":["dynamic"],"payload":"bytes","headersOverrideMedia":true},{"mode":"redirect","statusPolicy":"redirect","mediaTypes":["text/html"],"payload":"redirect","headersOverrideMedia":true},{"mode":"proxy","statusPolicy":"proxy","mediaTypes":["upstream"],"payload":"bytes","headersOverrideMedia":true},{"mode":"empty","statusPolicy":"plugin","mediaTypes":["optional"],"payload":"none","headersOverrideMedia":true},{"mode":"websocket","statusPolicy":"websocket","mediaTypes":["upgrade-or-text"],"payload":"frames","headersOverrideMedia":false},{"mode":"sse","statusPolicy":"sse","mediaTypes":["text/event-stream"],"payload":"events","headersOverrideMedia":false},{"mode":"admission","statusPolicy":"admission","mediaTypes":["text/plain"],"payload":"text","headersOverrideMedia":true}],"admissionStatuses":[400,404,500,503],"webSocketFrames":["text","binary","close","ping","pong"],"sseEventNames":"dynamic","sseData":"json-or-text","sseEvent":{"type":"object","properties":{"data":{"$ref":"#/$defs/JSONValue"},"event":{"type":"string"},"id":{"type":"string"},"retry":{"type":"integer"}},"required":["data"],"additionalProperties":false}};
    };
}

// 传输层合成的错误独立于业务错误；普通回调只接收消息处理后保留的非负错误码。
export interface APITransportError {
    code: -401 | -403 | -404;
    msg: string;
    data: null;
}

export interface APIFetchFailure {
    code: number;
    msg: string;
    data: null;
}

export interface APILegacyResponse {
    code: number;
    msg: string;
    data?: any;
    cmd?: string;
    callback?: string;
    sid?: string;
    context?: any;
}

type APIContract = {request: unknown; response: unknown; body: string};
export interface APIFormData<Request> extends FormData {
    readonly apiRequest: Request;
}
type APIRequestArgs<C extends APIContract> = C["body"] extends "multipart" | "form"
    ? [data: APIFormData<C["request"]>]
    : C["body"] extends "raw"
    ? [data?: JSONValue | FormData | null]
    : C["body"] extends "json" | "structJSON"
    ? [data: C["request"]]
    : [data?: C["request"] | null];
type NonNegative<C extends number> = C extends C ? `${C}` extends `-${string}` ? never : C : never;
export type APICallbackResponse<R> = R extends {code: infer C extends number}
    ? NonNegative<C> extends never ? never : R & {code: NonNegative<C>}
    : never;

type APIDirectCallbackResponse<R> = R extends {code: number} ? APICallbackResponse<R> : R;

type APIEmptyResponse<C> = C extends {emptyResponseStatuses: ReadonlyArray<number>} ? "" : never;
type APIPostEmptyResponse<C> = C extends {emptyResponseStatuses: infer S extends ReadonlyArray<number>}
    ? Exclude<S[number], 401 | 403 | 404> extends never ? never : "" : never;

type APIPostTail<C extends APIContract> = [
    cb?: (response: (C extends {output: "binary" | "proxy" | "pluginService"} ? JSONValue : C extends {output: "directJSON"} ? APIDirectCallbackResponse<C["response"]> | (C extends {noContent: true} ? "" : never) : C extends {output: "sse"} ? string | APICallbackResponse<C["response"]> : APICallbackResponse<C["response"]>) | APIPostEmptyResponse<C>) => void,
    headers?: Record<string, string>,
    failCallback?: (response: APIFetchFailure) => void,
    signal?: AbortSignal,
    timeout?: number
];
type LegacyPostArgs<Legacy> = [
    data?: any,
    cb?: (response: Legacy) => void,
    headers?: Record<string, string>,
    failCallback?: (response: Legacy) => void,
    signal?: AbortSignal,
    timeout?: number
];
type APISyncTail = [headers?: Record<string, string>, process?: boolean, signal?: AbortSignal];

// 路径只从首参推导，已知路径不能因请求参数不匹配而选择宽松重载。
export type FetchPost<Legacy = APILegacyResponse> = <Path extends string>(
    url: Path,
    ...args: Path extends keyof APIPOSTRoutes
        ? [...APIRequestArgs<APIPOSTRoutes[Path]>, ...APIPostTail<APIPOSTRoutes[Path]>]
        : string extends Path ? LegacyPostArgs<Legacy> : never
) => Promise<void>;

export type FetchSyncPost<Legacy = APILegacyResponse> = <Path extends string>(
    url: Path,
    ...args: Path extends keyof APIPOSTRoutes
        ? [...APIRequestArgs<APIPOSTRoutes[Path]>, ...APISyncTail]
        : string extends Path ? [data?: any, ...tail: APISyncTail] : never
) => Promise<Path extends keyof APIPOSTRoutes
    ? APIPOSTRoutes[Path] extends {output: "binary" | "proxy" | "pluginService"} ? JSONValue : APIPOSTRoutes[Path]["response"] | APITransportError
    : Legacy>;

export type FetchGet<Legacy = APILegacyResponse | string> = <Path extends string>(
    url: Path,
    ...args: Path extends keyof APIGETRoutes
        ? [cb: (response: APIGETRoutes[Path] extends {output: "binary" | "proxy" | "pluginService"} ? JSONValue : APIGETRoutes[Path]["response"] | APIEmptyResponse<APIGETRoutes[Path]> | (APIGETRoutes[Path] extends {output: "websocket" | "sse"} ? string : never)) => void]
        : Path extends keyof APIPOSTRoutes ? never
        : [cb: (response: Legacy) => void]
) => void;
