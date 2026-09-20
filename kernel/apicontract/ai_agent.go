package apicontract

type AIReference struct {
	ID    string `json:"id" api:"optional,nullable"`
	Title string `json:"title" api:"optional,nullable"`
}

type AIEditorContext struct {
	ActiveDocID      string   `json:"activeDocID,omitempty" api:"optional,nullable"`
	ActiveDocTitle   string   `json:"activeDocTitle,omitempty" api:"optional,nullable"`
	NotebookID       string   `json:"notebookID,omitempty" api:"optional,nullable"`
	FocusedBlockID   string   `json:"focusedBlockID,omitempty" api:"optional,nullable"`
	SelectedBlockIDs []string `json:"selectedBlockIDs,omitempty" api:"optional,nullable"`
	VisibleBlockIDs  []string `json:"visibleBlockIDs,omitempty" api:"optional,nullable"`
}

type AIAgentToolCallProviderData struct {
	Google *AIAgentGoogleToolCallProviderData `json:"google,omitempty" api:"optional,nullable"`
}

type AIAgentGoogleToolCallProviderData struct {
	ThoughtSignature string `json:"thoughtSignature,omitempty" api:"optional,nullable"`
}

type AIAgentAttachment struct {
	Type       string `json:"type" api:"optional,nullable"`
	Data       []byte `json:"-" api:"optional,nullable"`
	MIMEType   string `json:"mimeType,omitempty" api:"optional,nullable"`
	Path       string `json:"path" api:"optional,nullable"`
	DocumentID string `json:"documentId" api:"optional,nullable"`
	Detail     string `json:"detail,omitempty" api:"optional,nullable"`
	Width      int    `json:"width,omitempty" api:"optional,nullable"`
	Height     int    `json:"height,omitempty" api:"optional,nullable"`
}

type AISessionEntryStep struct {
	Reasoning        string   `json:"reasoning" api:"optional,nullable"`
	ReasoningContent string   `json:"reasoningContent,omitempty" api:"optional,nullable"`
	ToolNames        []string `json:"toolNames,omitempty" api:"optional,nullable"`
	ToolCallIDs      []string `json:"toolCallIDs,omitempty" api:"optional,nullable"`
	Content          string   `json:"content,omitempty" api:"optional,nullable"`
	RoundID          string   `json:"roundID,omitempty" api:"optional,nullable"`
}

type AIAgentToolCall struct {
	ID            string                       `json:"id,omitempty" api:"optional,nullable"`
	Name          string                       `json:"name" api:"optional,nullable"`
	Arguments     map[string]JSONValue         `json:"arguments" api:"optional,nullable"`
	ArgumentsJSON string                       `json:"argumentsJSON,omitempty" api:"optional,nullable"`
	Result        string                       `json:"result,omitempty" api:"optional,nullable"`
	State         string                       `json:"state,omitempty" api:"optional,nullable"`
	Attachments   []AIAgentAttachment          `json:"attachments,omitempty" api:"optional,nullable"`
	ProviderData  *AIAgentToolCallProviderData `json:"providerData,omitempty" api:"optional,nullable"`
}

type AISessionEntry struct {
	ID                   string                 `json:"id,omitempty" api:"optional,nullable"`
	Type                 string                 `json:"type" api:"optional,nullable"`
	Content              string                 `json:"content,omitempty" api:"optional,nullable"`
	References           []AIReference          `json:"references,omitempty" api:"optional,nullable"`
	AIEditorContext      *AIEditorContext       `json:"editorContext,omitempty" api:"optional,nullable"`
	BlockHTML            string                 `json:"blockHTML,omitempty" api:"optional,nullable"`
	Steps                []AISessionEntryStep   `json:"steps,omitempty" api:"optional,nullable"`
	ToolCalls            []AIAgentToolCall      `json:"toolCalls,omitempty" api:"optional,nullable"`
	Duration             float64                `json:"duration,omitempty" api:"optional,nullable"`
	PromptTokens         int                    `json:"promptTokens,omitempty" api:"optional,nullable"`
	CompletionTok        int                    `json:"completionTokens,omitempty" api:"optional,nullable"`
	Timestamp            int64                  `json:"timestamp,omitempty" api:"optional,nullable"`
	ReasoningCont        string                 `json:"reasoningContent,omitempty" api:"optional,nullable"`
	NativeContent        *AINativeContent       `json:"nativeContent,omitempty" api:"optional,nullable"`
	ResponseOutput       []JSONValue            `json:"responseOutput,omitempty" api:"optional,nullable"`
	ResponseOutputTokens int                    `json:"responseOutputTokens,omitempty" api:"optional,nullable"`
	RoundID              string                 `json:"roundID,omitempty" api:"optional,nullable"`
	Name                 string                 `json:"name,omitempty" api:"optional,nullable"`
	Args                 map[string]JSONValue   `json:"args,omitempty" api:"optional,nullable"`
	ConfirmID            string                 `json:"confirmID,omitempty" api:"optional,nullable"`
	Status               string                 `json:"status,omitempty" api:"optional,nullable"`
	QuestionID           string                 `json:"questionID,omitempty" api:"optional,nullable"`
	Questions            []map[string]JSONValue `json:"questions,omitempty" api:"optional,nullable"`
	Answers              []string               `json:"answers,omitempty" api:"optional,nullable"`
	SnapshotID           string                 `json:"snapshotID,omitempty" api:"optional,nullable"`
}

type AIAgentMessage struct {
	Role                 string            `json:"role" api:"optional,nullable"`
	Content              string            `json:"content" api:"optional,nullable"`
	ReasoningContent     string            `json:"reasoningContent,omitempty" api:"optional,nullable"`
	NativeContent        *AINativeContent  `json:"nativeContent,omitempty" api:"optional,nullable"`
	ResponseOutput       []JSONValue       `json:"responseOutput,omitempty" api:"optional,nullable"`
	ResponseOutputTokens int               `json:"responseOutputTokens,omitempty" api:"optional,nullable"`
	RoundID              string            `json:"roundID,omitempty" api:"optional,nullable"`
	References           []AIReference     `json:"references,omitempty" api:"optional,nullable"`
	AIEditorContext      *AIEditorContext  `json:"editorContext,omitempty" api:"optional,nullable"`
	ToolCalls            []AIAgentToolCall `json:"toolCalls,omitempty" api:"optional,nullable"`
	EntryID              string            `json:"entryID,omitempty" api:"optional,nullable"`
}

type AIFrontendCapability struct {
	ID            string                   `json:"id" api:"optional,nullable"`
	Title         string                   `json:"title,omitempty" api:"optional,nullable"`
	Description   string                   `json:"description" api:"optional,nullable"`
	InputSchema   map[string]JSONValue     `json:"inputSchema" api:"optional,nullable"`
	OutputSchema  map[string]JSONValue     `json:"outputSchema,omitempty" api:"optional,nullable"`
	Source        string                   `json:"source" api:"optional,nullable"`
	OwnerID       string                   `json:"ownerId,omitempty" api:"optional,nullable"`
	OwnerName     string                   `json:"ownerName,omitempty" api:"optional,nullable"`
	Effects       *AIToolEffects           `json:"effects,omitempty" api:"optional,nullable"`
	ActionEffects map[string]AIToolEffects `json:"actionEffects,omitempty" api:"optional,nullable"`
	Generation    uint64                   `json:"generation" api:"optional,nullable"`
}

type AIAgentChatRequest struct {
	SessionID            string                 `json:"sessionID" api:"optional,nullable"`
	UserEntryID          string                 `json:"userEntryID" api:"optional,nullable"`
	ContentRevision      *int64                 `json:"contentRevision" api:"optional,nullable"`
	Message              string                 `json:"message" api:"optional,nullable"`
	BlockHTML            *string                `json:"blockHTML" api:"optional,nullable"`
	Language             string                 `json:"language" api:"optional,nullable"`
	References           []AIReference          `json:"references" api:"optional,nullable"`
	AIEditorContext      AIEditorContext        `json:"editorContext" api:"optional,nullable"`
	FrontendCapabilities []AIFrontendCapability `json:"frontendCapabilities" api:"optional,nullable"`
	Model                string                 `json:"model,omitempty" api:"optional,nullable"`
	Regenerate           bool                   `json:"regenerate" api:"optional,nullable"`
	ReasoningEffort      string                 `json:"reasoningEffort,omitempty" api:"optional,nullable"`
}

type AISessionFields struct {
	ID                    string           `json:"id"`
	Title                 string           `json:"title,omitempty" api:"optional,nullable"`
	Titled                bool             `json:"titled,omitempty" api:"optional,nullable"`
	Model                 string           `json:"model,omitempty" api:"optional,nullable"`
	PermissionMode        string           `json:"permissionMode,omitempty" api:"optional,nullable"`
	AlwaysAllow           bool             `json:"alwaysAllow,omitempty" api:"optional,nullable"`
	Messages              []AIAgentMessage `json:"messages,omitempty" api:"optional,nullable"`
	Entries               []AISessionEntry `json:"entries,omitempty" api:"optional,nullable"`
	Snapshots             []string         `json:"snapshots,omitempty" api:"optional,nullable"`
	PromptTokens          int              `json:"promptTokens,omitempty" api:"optional,nullable"`
	CompletionTokens      int              `json:"completionTokens,omitempty" api:"optional,nullable"`
	TotalDuration         float64          `json:"totalDuration,omitempty" api:"optional,nullable"`
	ContextTokens         int              `json:"contextTokens,omitempty" api:"optional,nullable"`
	ContextTokenBreakdown map[string]int   `json:"contextTokenBreakdown,omitempty" api:"optional,nullable"`
	ContextCachedTokens   int              `json:"contextCachedTokens,omitempty" api:"optional,nullable"`
	ContextLimit          int              `json:"contextLimit,omitempty" api:"optional,nullable"`
	MessageHistory        []string         `json:"messageHistory,omitempty" api:"optional,nullable"`
	CreatedAt             int64            `json:"createdAt,omitempty" api:"optional,nullable"`
	UpdatedAt             int64            `json:"updatedAt,omitempty" api:"optional,nullable"`
	Revision              int64            `json:"revision,omitempty" api:"optional,nullable"`
	ExpectedRevision      *int64           `json:"expectedRevision,omitempty" api:"optional,nullable"`
	CommitTurnID          string           `json:"commitTurnID,omitempty" api:"optional,nullable"`
	LastCommittedTurnID   string           `json:"lastCommittedTurnID,omitempty" api:"optional,nullable"`
	RecoveryTurnID        string           `json:"recoveryTurnID,omitempty" api:"optional,nullable"`
	RecoveryState         string           `json:"recoveryState,omitempty" api:"optional,nullable"`
	RecoveryRevision      int64            `json:"recoveryRevision,omitempty" api:"optional,nullable"`
	AgentRunning          bool             `json:"agentRunning,omitempty" api:"optional,nullable"`
}
type AISessionSaveData struct {
	Revision int64      `json:"revision"`
	Session  *AISession `json:"session,omitempty"`
}

type AISSEStart struct {
	TaskID string `json:"taskID"`
}
type AISSEToken struct {
	Token string `json:"token"`
}
type AISSEFinish struct {
	FinishReason string `json:"finishReason"`
}
type AISSEMessage struct {
	Message string `json:"message"`
}
type AISSETurn struct {
	TurnID string `json:"turnID"`
}
type AISSEThinking struct {
	Reasoning string `json:"reasoning"`
	RoundID   string `json:"roundID"`
}
type AISSEConfirm struct {
	Name      string               `json:"name"`
	Arguments map[string]JSONValue `json:"arguments"`
	ConfirmID string               `json:"confirmID"`
	Effects   AIToolEffects        `json:"effects"`
	Forced    bool                 `json:"forced"`
}
type AISSEToolCall struct {
	Name      string               `json:"name"`
	Arguments map[string]JSONValue `json:"arguments"`
	CallID    string               `json:"callID"`
	RoundID   string               `json:"roundID"`
}
type AISSEToolResult struct {
	Name    string `json:"name"`
	CallID  string `json:"callID"`
	RoundID string `json:"roundID"`
	Result  string `json:"result"`
}
type AISSEUsage struct {
	PromptTokens     int            `json:"promptTokens"`
	CompletionTokens int            `json:"completionTokens"`
	LastPromptTokens int            `json:"lastPromptTokens"`
	TokenBreakdown   map[string]int `json:"tokenBreakdown"`
	CachedTokens     int            `json:"cachedTokens"`
	ContextLimit     int            `json:"contextLimit"`
}
type AISSERetry struct {
	Attempt    int `json:"attempt"`
	MaxRetries int `json:"maxRetries"`
}
type AISSEQuestion struct {
	QuestionID string               `json:"questionID"`
	RoundID    string               `json:"roundID"`
	Arguments  map[string]JSONValue `json:"arguments"`
}
type AISSEBrowserCapabilityCall struct {
	CallID       string               `json:"callID"`
	Name         string               `json:"name"`
	CapabilityID string               `json:"capabilityID"`
	Generation   uint64               `json:"generation"`
	Arguments    map[string]JSONValue `json:"arguments"`
}
type AISSESnapshot struct {
	SnapshotID string `json:"snapshotID"`
	RoundID    string `json:"roundID"`
}

func aiEditorSSEOptions() ResponseOptions {
	return SSEOptions(SSEEvent[AISSEStart]("start"), SSEEvent[AISSEToken]("reasoning"), SSEEvent[AISSEToken]("content"), SSEEvent[AISSEMessage]("error"), SSEEvent[AISSEMessage]("truncated"), SSEEvent[AISSEFinish]("done"))
}
func aiAgentSSEOptions() ResponseOptions {
	options := SSEOptions(SSEEvent[AISSETurn]("turn"), SSEEvent[AISSEToken]("content"), SSEEvent[AISSEThinking]("thinking"), SSEEvent[AISSEToken]("reasoning"), SSEEvent[AISSEConfirm]("confirm"), SSEEvent[AIPermissionData]("permission"), SSEEvent[AISSEToolCall]("tool_call"), SSEEvent[AISSEToolResult]("tool_result"), SSEEvent[AISSEMessage]("error"), SSEEvent[AISSEMessage]("interrupted"), SSEEvent[AISSEUsage]("usage"), SSEEvent[AISSETurn]("done"), SSEEvent[AISSERetry]("retry"), SSEEvent[AISSEQuestion]("question"), SSEEvent[AISSEBrowserCapabilityCall]("browser_capability_call"), SSEEvent[AISSESnapshot]("snapshot"))
	options.AdditionalErrorStatuses = []int{409}
	return options
}

// AINativeContent 保留供应商定义的原生内容块，协议和版本用于选择兼容的上下文读取方式。
type AINativeContent struct {
	Protocol string      `json:"protocol"`
	Version  int         `json:"version"`
	Blocks   []JSONValue `json:"blocks"`
}
