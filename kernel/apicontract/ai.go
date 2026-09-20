package apicontract

import "strings"

// RequiresAI 标识受 AI 功能开关控制的接口，包含配置保存和 OAuth 回调。
func RequiresAI(path string) bool {
	return strings.HasPrefix(path, "/api/ai/") || path == "/api/setting/setAI"
}

type AIEditorChatRequest struct {
	TaskID  string            `json:"taskID" api:"optional,nullable"`
	IDs     []string          `json:"ids" api:"optional,nullable"`
	Input   string            `json:"input" api:"optional,nullable"`
	Action  string            `json:"action" api:"optional,nullable"`
	History []AIEditorMessage `json:"history" api:"optional,nullable"`
}

type AIConfirmRequest struct {
	ConfirmID string `json:"confirmID" api:"optional,nullable"`
	Approved  bool   `json:"approved" api:"optional,nullable"`
	Always    bool   `json:"always" api:"optional,nullable"`
}

type AIPermissionRequest struct {
	SessionID      string `json:"sessionID" api:"optional,nullable"`
	PermissionMode string `json:"permissionMode" api:"optional,nullable"`
}

type AIQuestionRequest struct {
	QuestionID string   `json:"questionID" api:"optional,nullable"`
	Answers    []string `json:"answers" api:"optional,nullable"`
}

type AITitleRequest struct {
	Message  string `json:"message" api:"optional,nullable"`
	Model    string `json:"model" api:"optional,nullable"`
	Language string `json:"language" api:"optional,nullable"`
}

type AISessionsRequest struct {
	Page     int    `json:"page" api:"optional,nullable"`
	PageSize int    `json:"pageSize" api:"optional,nullable"`
	Keyword  string `json:"keyword" api:"optional,nullable"`
}

type AISessionIDRequest struct {
	ID string `json:"id" api:"optional,nullable"`
}

type AISkillNameRequest struct {
	Name string `json:"name" api:"optional,nullable"`
}

type AISkillSaveRequest struct {
	Name    string `json:"name" api:"optional,nullable"`
	Content string `json:"content" api:"optional,nullable"`
}

type AISkillRenameRequest struct {
	OldName string `json:"oldName" api:"optional,nullable"`
	NewName string `json:"newName" api:"optional,nullable"`
}

type AIBrowserCapabilityResultRequest struct {
	CallID               string    `json:"callID" api:"optional,nullable"`
	Result               string    `json:"result" api:"optional,nullable"`
	StructuredContent    JSONValue `json:"structuredContent" api:"optional,nullable"`
	StructuredContentSet bool      `json:"structuredContentSet" api:"optional,nullable"`
	IsError              bool      `json:"isError" api:"optional,nullable"`
}

type AIEditorMessage struct {
	Role    string `json:"role" api:"optional,nullable"`
	Content string `json:"content" api:"optional,nullable"`
}

type AIEditorAction struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Action string `json:"action"`
}

type AIEmbeddingStat struct {
	Total           int  `json:"total"`
	Indexed         int  `json:"indexed"`
	Pending         int  `json:"pending"`
	Failed          int  `json:"failed"`
	IgnoredByLen    int  `json:"ignoredByLen"`
	IgnoredByConfig int  `json:"ignoredByConfig"`
	Enabled         bool `json:"enabled"`
}

type AIMCPStatus struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Status           string `json:"status"`
	Tools            int    `json:"tools"`
	Error            string `json:"error,omitempty"`
	AuthorizationURL string `json:"authorizationURL,omitempty"`
	Authorized       bool   `json:"authorized"`
}

type AISkillInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type AIUserSkillInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
	Shadowed    bool   `json:"shadowed"`
}

type AISessionIndex struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
	AgentRunning bool   `json:"agentRunning,omitempty"`
}

type AISessionList struct {
	Sessions []*AISessionIndex `json:"sessions"`
	Total    int               `json:"total"`
	Page     int               `json:"page"`
	PageSize int               `json:"pageSize"`
}

type AIToolEffects struct {
	LocalRead    bool `json:"localRead,omitempty" api:"optional,nullable"`
	LocalWrite   bool `json:"localWrite,omitempty" api:"optional,nullable"`
	DataEgress   bool `json:"dataEgress,omitempty" api:"optional,nullable"`
	ExternalCost bool `json:"externalCost,omitempty" api:"optional,nullable"`
}

type AICapabilityManifest struct {
	ID          string               `json:"id"`
	Name        string               `json:"name"`
	Title       string               `json:"title,omitempty"`
	Description string               `json:"description"`
	Source      string               `json:"source"`
	OwnerID     string               `json:"ownerId,omitempty"`
	OwnerName   string               `json:"ownerName,omitempty"`
	Runtime     string               `json:"runtime"`
	AgentOnly   bool                 `json:"agentOnly,omitempty"`
	Effects     AIToolEffects        `json:"effects,omitempty"`
	Available   bool                 `json:"available"`
	Actions     []AICapabilityAction `json:"actions,omitempty"`
}

type AICapabilityAction struct {
	Name    string        `json:"name"`
	Effects AIToolEffects `json:"effects,omitempty"`
}

type AIMessageRequest struct {
	Msg string `json:"msg" api:"trim"`
}
type AIActionRequest struct {
	IDs    []string `json:"ids"`
	Action string   `json:"action"`
}
type AIEditorActionSaveRequest struct {
	ID     string `json:"id" api:"optional,nullable"`
	Name   string `json:"name"`
	Action string `json:"action"`
}
type AIEditorActionIDRequest struct {
	ID string `json:"id" api:"trim"`
}
type AIProviderRequest struct {
	Provider       string           `json:"provider" api:"optional,nullable,ignoretype"`
	ProviderConfig *SettingProvider `json:"providerConfig" api:"optional,nullable,legacyobject"`
	providerError  error
}
type AIModelRequest struct {
	Model string `json:"model" api:"trim"`
	AIProviderRequest
}
type AIModelTestData struct {
	Available []string `json:"available"`
	Matched   bool     `json:"matched"`
	Msg       *string  `json:"msg,omitempty"`
}
type AIEmbeddingTestData struct {
	Matched    bool    `json:"matched"`
	Dimensions *int    `json:"dimensions,omitempty"`
	Msg        *string `json:"msg,omitempty"`
}
type AIRerankTestData struct {
	Matched bool    `json:"matched"`
	Msg     *string `json:"msg,omitempty"`
}

type AIDecisionTestData struct {
	Matched bool    `json:"matched"`
	Msg     *string `json:"msg,omitempty"`
}
type AIModelsData struct {
	Models         []string       `json:"models"`
	ContextLengths map[string]int `json:"contextLengths"`
	Msg            *string        `json:"msg,omitempty"`
}
type AIMCPEnvironmentData struct {
	Names    []string `json:"names"`
	Defaults []string `json:"defaults"`
}
type AIMCPIDRequest struct {
	ID string `json:"id" api:"optional,nullable,ignoretype"`
}
type AIPermissionData struct {
	PermissionMode string `json:"permissionMode"`
}
type AISkillData struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}
