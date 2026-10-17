package apicontract

import (
	"encoding/json"
	"io"
	"mime/multipart"
)

// 闪卡传输结构保留结构体绑定的缺省、null、大小写及未知字段兼容行为。
// api 标记描述输入兼容性；业务层继续校验操作 ID、时间、实体载荷和引用，不改变已有数据格式。

// FlashcardV2JSON 保存由卡源、实体类型或事件类型约束的原始 JSON，保留省略与显式 null。
type FlashcardV2JSON json.RawMessage

func (value FlashcardV2JSON) MarshalJSON() ([]byte, error) {
	return json.RawMessage(value).MarshalJSON()
}
func (value *FlashcardV2JSON) UnmarshalJSON(data []byte) error {
	return (*json.RawMessage)(value).UnmarshalJSON(data)
}

type FlashcardV2AdvancedClozeGroup struct {
	ID           string   `json:"id" api:"optional,nullable"`
	DisplayOrder int      `json:"displayOrder" api:"optional,nullable"`
	BlockIDs     []string `json:"blockIDs,omitempty" api:"optional,nullable"`
	OcclusionIDs []string `json:"occlusionIDs,omitempty" api:"optional,nullable"`
}

type FlashcardV2AdvancedInlineOcclusion struct {
	ID           string `json:"id" api:"optional,nullable"`
	BlockID      string `json:"blockID" api:"optional,nullable"`
	DisplayOrder int    `json:"displayOrder" api:"optional,nullable"`
}

type FlashcardV2AdvancedSourceRequest struct {
	OperationID          string                               `json:"operationID" api:"optional,nullable"`
	SourceID             string                               `json:"sourceID" api:"optional,nullable"`
	DefaultPresetID      string                               `json:"defaultPresetID,omitempty" api:"optional,nullable"`
	Mode                 string                               `json:"mode" api:"optional,nullable"`
	BlockIDs             []string                             `json:"blockIDs" api:"optional,nullable"`
	ClozeGroups          []FlashcardV2AdvancedClozeGroup      `json:"clozeGroups,omitempty" api:"optional,nullable"`
	InlineOcclusions     []FlashcardV2AdvancedInlineOcclusion `json:"inlineOcclusions,omitempty" api:"optional,nullable"`
	ReviewSetIDs         []string                             `json:"reviewSetIDs,omitempty" api:"optional,nullable"`
	CreatedAt            int64                                `json:"createdAt" api:"optional,nullable"`
	ImageConfig          *FlashcardV2ImageOcclusionConfig     `json:"imageConfig,omitempty" api:"optional,nullable"`
	CorrectOptionIndexes []int                                `json:"correctOptionIndexes,omitempty" api:"optional,nullable"`
	RandomizeOptions     bool                                 `json:"randomizeOptions" api:"optional,nullable"`
	DistractorQuery      *FlashcardV2QueryAST                 `json:"distractorQuery,omitempty" api:"optional,nullable"`
	DynamicDistractors   int                                  `json:"dynamicDistractors,omitempty" api:"optional,nullable"`
	TypedConfig          *FlashcardV2TypedAnswerConfig        `json:"typedConfig,omitempty" api:"optional,nullable"`
}

type FlashcardV2AdvancedSourceResult struct {
	SourceRevision FlashcardV2EntityRevision  `json:"sourceRevision" api:"optional,nullable"`
	Cards          FlashcardV2ReconcileResult `json:"cards" api:"optional,nullable"`
	Memberships    []string                   `json:"memberships" api:"optional,nullable"`
}

type FlashcardV2AdvancedSourceUpdateRequest struct {
	OperationID          string                               `json:"operationID" api:"optional,nullable"`
	SourceID             string                               `json:"sourceID" api:"optional,nullable"`
	ExpectedRevision     string                               `json:"expectedRevisionID" api:"optional,nullable"`
	Mode                 string                               `json:"mode" api:"optional,nullable"`
	BlockIDs             []string                             `json:"blockIDs" api:"optional,nullable"`
	ClozeGroups          []FlashcardV2AdvancedClozeGroup      `json:"clozeGroups,omitempty" api:"optional,nullable"`
	InlineOcclusions     []FlashcardV2AdvancedInlineOcclusion `json:"inlineOcclusions,omitempty" api:"optional,nullable"`
	UpdatedAt            int64                                `json:"updatedAt" api:"optional,nullable"`
	ImageConfig          *FlashcardV2ImageOcclusionConfig     `json:"imageConfig,omitempty" api:"optional,nullable"`
	CorrectOptionIndexes []int                                `json:"correctOptionIndexes,omitempty" api:"optional,nullable"`
	RandomizeOptions     bool                                 `json:"randomizeOptions" api:"optional,nullable"`
	DistractorQuery      *FlashcardV2QueryAST                 `json:"distractorQuery,omitempty" api:"optional,nullable"`
	DynamicDistractors   int                                  `json:"dynamicDistractors,omitempty" api:"optional,nullable"`
	TypedConfig          *FlashcardV2TypedAnswerConfig        `json:"typedConfig,omitempty" api:"optional,nullable"`
}

type FlashcardV2AnkiDeckPreview struct {
	ID        int64  `json:"id" api:"optional,nullable"`
	Name      string `json:"name" api:"optional,nullable"`
	CardCount int    `json:"cardCount" api:"optional,nullable"`
}

type FlashcardV2AnkiFieldPreview struct {
	Name string `json:"name" api:"optional,nullable"`
	Ord  int    `json:"ord" api:"optional,nullable"`
}

type FlashcardV2AnkiImportReport struct {
	CollectionID   string `json:"collectionID" api:"optional,nullable"`
	PackageDigest  string `json:"packageDigest" api:"optional,nullable"`
	Notes          int    `json:"notes" api:"optional,nullable"`
	Cards          int    `json:"cards" api:"optional,nullable"`
	ReviewEvents   int    `json:"reviewEvents" api:"optional,nullable"`
	ReviewSets     int    `json:"reviewSets" api:"optional,nullable"`
	Tags           int    `json:"tags" api:"optional,nullable"`
	Media          int    `json:"media" api:"optional,nullable"`
	UpdatedSources int    `json:"updatedSources" api:"optional,nullable"`
	RetiredSources int    `json:"retiredSources" api:"optional,nullable"`
}

type FlashcardV2AnkiNoteTypePreview struct {
	ID         int64                            `json:"id" api:"optional,nullable"`
	Name       string                           `json:"name" api:"optional,nullable"`
	Kind       string                           `json:"kind" api:"optional,nullable"`
	NoteCount  int                              `json:"noteCount" api:"optional,nullable"`
	Fields     []FlashcardV2AnkiFieldPreview    `json:"fields" api:"optional,nullable"`
	Templates  []FlashcardV2AnkiTemplatePreview `json:"templates" api:"optional,nullable"`
	Conversion string                           `json:"conversion" api:"optional,nullable"`
}

type FlashcardV2AnkiPackagePreview struct {
	PackageDigest      string                           `json:"packageDigest" api:"optional,nullable"`
	CollectionID       string                           `json:"collectionID" api:"optional,nullable"`
	CollectionCrt      int64                            `json:"collectionCrt" api:"optional,nullable"`
	SchemaVersion      int                              `json:"schemaVersion" api:"optional,nullable"`
	NoteCount          int                              `json:"noteCount" api:"optional,nullable"`
	CardCount          int                              `json:"cardCount" api:"optional,nullable"`
	ReviewCount        int                              `json:"reviewCount" api:"optional,nullable"`
	MediaCount         int                              `json:"mediaCount" api:"optional,nullable"`
	NoteTypes          []FlashcardV2AnkiNoteTypePreview `json:"noteTypes" api:"optional,nullable"`
	Decks              []FlashcardV2AnkiDeckPreview     `json:"decks" api:"optional,nullable"`
	Unsupported        []string                         `json:"unsupported" api:"optional,nullable"`
	CollectionEntry    string                           `json:"collectionEntry" api:"optional,nullable"`
	legacyCollectionID string
}

type FlashcardV2AnkiTemplatePreview struct {
	Name           string `json:"name" api:"optional,nullable"`
	Ord            int    `json:"ord" api:"optional,nullable"`
	Conversion     string `json:"conversion" api:"optional,nullable"`
	UsesTypeAnswer bool   `json:"usesTypeAnswer" api:"optional,nullable"`
	HasScript      bool   `json:"hasScript" api:"optional,nullable"`
}

type FlashcardV2BasicDirectionRequest struct {
	OperationID      string `json:"operationID" api:"optional,nullable"`
	SourceID         string `json:"sourceID" api:"optional,nullable"`
	Direction        string `json:"direction" api:"optional,nullable"`
	ExpectedRevision string `json:"expectedRevision,omitempty" api:"optional,nullable"`
	UpdatedAt        int64  `json:"updatedAt" api:"optional,nullable"`
}

type FlashcardV2BasicSourceRequest struct {
	OperationID     string   `json:"operationID" api:"optional,nullable"`
	SourceID        string   `json:"sourceID" api:"optional,nullable"`
	BlockIDs        []string `json:"blockIDs" api:"optional,nullable"`
	Direction       string   `json:"direction" api:"optional,nullable"`
	ReviewSetIDs    []string `json:"reviewSetIDs,omitempty" api:"optional,nullable"`
	CreatedAt       int64    `json:"createdAt" api:"optional,nullable"`
	DefaultPresetID string   `json:"defaultPresetID,omitempty" api:"optional,nullable"`
}

type FlashcardV2BasicSourceResult struct {
	SourceRevision FlashcardV2EntityRevision  `json:"sourceRevision" api:"optional,nullable"`
	Cards          FlashcardV2ReconcileResult `json:"cards" api:"optional,nullable"`
	Memberships    []string                   `json:"memberships" api:"optional,nullable"`
}

type FlashcardV2BlockPresence string

type FlashcardV2Card struct {
	ID               string                      `json:"id" api:"optional,nullable"`
	SourceID         string                      `json:"sourceID" api:"optional,nullable"`
	TemplateID       string                      `json:"templateID" api:"optional,nullable"`
	VariantKey       string                      `json:"variantKey" api:"optional,nullable"`
	VariantData      FlashcardV2JSON             `json:"variantData,omitempty" api:"optional,nullable"`
	GenerationStatus FlashcardV2GenerationStatus `json:"generationStatus" api:"optional,nullable,enum=active|disabledByTemplate|orphaned|deleted"`
	Flag             int                         `json:"flag" api:"optional,nullable"`
	PresetOverrideID string                      `json:"presetOverrideID,omitempty" api:"optional,nullable"`
	PriorityOverride string                      `json:"priorityOverride,omitempty" api:"optional,nullable"`
	EditLater        *FlashcardV2CardEditLater   `json:"editLater,omitempty" api:"optional,nullable"`
	CreatedAt        int64                       `json:"createdAt" api:"optional,nullable"`
	UpdatedAt        int64                       `json:"updatedAt" api:"optional,nullable"`
}

type FlashcardV2CardEditLater struct {
	Note      string `json:"note" api:"optional,nullable"`
	UpdatedAt int64  `json:"updatedAt" api:"optional,nullable"`
}

type FlashcardV2CardManagementRequest struct {
	OperationID            string            `json:"operationID" api:"optional,nullable"`
	CardIDs                []string          `json:"cardIDs" api:"optional,nullable"`
	Action                 string            `json:"action" api:"optional,nullable"`
	ChangedAt              int64             `json:"changedAt" api:"optional,nullable"`
	Due                    int64             `json:"due,omitempty" api:"optional,nullable"`
	BuriedUntil            int64             `json:"buriedUntil,omitempty" api:"optional,nullable"`
	Reason                 string            `json:"reason,omitempty" api:"optional,nullable"`
	Flag                   int               `json:"flag,omitempty" api:"optional,nullable"`
	PresetID               string            `json:"presetID,omitempty" api:"optional,nullable"`
	Priority               string            `json:"priority,omitempty" api:"optional,nullable"`
	ExpectedCardRevisions  map[string]string `json:"expectedCardRevisions,omitempty" api:"optional,nullable"`
	ExpectedStateRevisions map[string]string `json:"expectedStateRevisions,omitempty" api:"optional,nullable"`
}

type FlashcardV2CardManagementResult struct {
	Batch  FlashcardV2OperationBatch         `json:"batch" api:"optional,nullable"`
	Cards  map[string]FlashcardV2Card        `json:"cards" api:"optional,nullable"`
	States map[string]FlashcardV2ReviewState `json:"states" api:"optional,nullable"`
	Events []FlashcardV2Event                `json:"events" api:"optional,nullable"`
}

type FlashcardV2CardRenderModel struct {
	Card        FlashcardV2Card            `json:"card" api:"optional,nullable"`
	ReviewState FlashcardV2ReviewState     `json:"reviewState" api:"optional,nullable"`
	Source      FlashcardV2CardSource      `json:"source" api:"optional,nullable"`
	References  []FlashcardV2CardSourceRef `json:"references" api:"optional,nullable"`
	Template    FlashcardV2CardTemplate    `json:"template" api:"optional,nullable"`
	Schema      FlashcardV2CardSchema      `json:"schema" api:"optional,nullable"`
}

type FlashcardV2CardSchema struct {
	ID          string                       `json:"id" api:"optional,nullable"`
	Name        string                       `json:"name" api:"optional,nullable"`
	BuiltinType string                       `json:"builtinType,omitempty" api:"optional,nullable"`
	Fields      []FlashcardV2CardSchemaField `json:"fields" api:"optional,nullable"`
	TemplateIDs []string                     `json:"templateIDs" api:"optional,nullable"`
	CreatedAt   int64                        `json:"createdAt" api:"optional,nullable"`
	UpdatedAt   int64                        `json:"updatedAt" api:"optional,nullable"`
}

type FlashcardV2CardSchemaField struct {
	ID       string `json:"id" api:"optional,nullable"`
	Name     string `json:"name" api:"optional,nullable"`
	Type     string `json:"type" api:"optional,nullable"`
	Required bool   `json:"required" api:"optional,nullable"`
	Sort     int    `json:"sort" api:"optional,nullable"`
}

type FlashcardV2CardSearchOptions struct {
	Now              int64 `json:"now" api:"optional,nullable"`
	IncludeInactive  bool  `json:"includeInactive" api:"optional,nullable"`
	IncludeSuspended bool  `json:"includeSuspended" api:"optional,nullable"`
	IncludeBuried    bool  `json:"includeBuried" api:"optional,nullable"`
	IncludePaused    bool  `json:"includePaused" api:"optional,nullable"`
	IncludeConflicts bool  `json:"includeConflicts" api:"optional,nullable"`
	GroupBySource    bool  `json:"groupBySource" api:"optional,nullable"`
	ReturnCards      bool  `json:"returnCards" api:"optional,nullable"`
	Limit            int   `json:"limit" api:"optional,nullable"`
	Offset           int   `json:"offset" api:"optional,nullable"`
}

type FlashcardV2CardSearchResult struct {
	Card              FlashcardV2Card        `json:"card" api:"optional,nullable"`
	ReviewState       FlashcardV2ReviewState `json:"reviewState" api:"optional,nullable"`
	SourceType        string                 `json:"sourceType" api:"optional,nullable"`
	SourceStatus      string                 `json:"sourceStatus" api:"optional,nullable"`
	SourcePriority    string                 `json:"sourcePriority" api:"optional,nullable"`
	InheritedPriority string                 `json:"inheritedPriority" api:"optional,nullable"`
	DefaultPresetID   string                 `json:"defaultPresetID" api:"optional,nullable"`
	CardTagIDs        []string               `json:"cardTagIDs" api:"optional,nullable"`
	SourceTagIDs      []string               `json:"sourceTagIDs" api:"optional,nullable"`
	EffectiveTagIDs   []string               `json:"effectiveTagIDs" api:"optional,nullable"`
	EffectivePriority string                 `json:"effectivePriority" api:"optional,nullable"`
	EffectivePresetID string                 `json:"effectivePresetID" api:"optional,nullable"`
	SourceNotebookID  string                 `json:"sourceNotebookID,omitempty" api:"optional,nullable"`
	SourceRootID      string                 `json:"sourceRootID,omitempty" api:"optional,nullable"`
	SourcePath        string                 `json:"sourcePath,omitempty" api:"optional,nullable"`
	SourceAvailable   bool                   `json:"sourceAvailable" api:"optional,nullable"`
}

type FlashcardV2CardSource struct {
	ID                  string          `json:"id" api:"optional,nullable"`
	SchemaID            string          `json:"schemaID" api:"optional,nullable"`
	SourceType          string          `json:"sourceType" api:"optional,nullable"`
	PrimaryRefID        string          `json:"primaryRefID" api:"optional,nullable"`
	DefaultPresetID     string          `json:"defaultPresetID,omitempty" api:"optional,nullable"`
	Priority            string          `json:"priority,omitempty" api:"optional,nullable"`
	GenerationConfig    FlashcardV2JSON `json:"generationConfig" api:"optional,nullable"`
	Status              string          `json:"status" api:"optional,nullable"`
	PluginNamespace     string          `json:"pluginNamespace,omitempty" api:"optional,nullable"`
	PluginDataVersion   int             `json:"pluginDataVersion,omitempty" api:"optional,nullable"`
	PluginData          FlashcardV2JSON `json:"pluginData,omitempty" api:"optional,nullable"`
	DisabledTemplateIDs []string        `json:"disabledTemplateIDs,omitempty" api:"optional,nullable"`
}

type FlashcardV2CardSourceRef struct {
	ID         string `json:"id" api:"optional,nullable"`
	SourceID   string `json:"sourceID" api:"optional,nullable"`
	FieldID    string `json:"fieldID,omitempty" api:"optional,nullable"`
	EntityType string `json:"entityType" api:"optional,nullable"`
	EntityID   string `json:"entityID" api:"optional,nullable"`
	Role       string `json:"role" api:"optional,nullable"`
	Sort       int    `json:"sort" api:"optional,nullable"`
	Required   bool   `json:"required" api:"optional,nullable"`
}

type FlashcardV2CardTemplate struct {
	ID             string          `json:"id" api:"optional,nullable"`
	SchemaID       string          `json:"schemaID" api:"optional,nullable"`
	Name           string          `json:"name" api:"optional,nullable"`
	GenerationRule FlashcardV2JSON `json:"generationRule" api:"optional,nullable"`
	FrontSpec      FlashcardV2JSON `json:"frontSpec" api:"optional,nullable"`
	BackSpec       FlashcardV2JSON `json:"backSpec" api:"optional,nullable"`
	AnswerMode     string          `json:"answerMode" api:"optional,nullable"`
	ContextPolicy  FlashcardV2JSON `json:"contextPolicy,omitempty" api:"optional,nullable"`
	Style          string          `json:"style,omitempty" api:"optional,nullable"`
	Enabled        bool            `json:"enabled" api:"optional,nullable"`
}

type FlashcardV2Change struct {
	Kind     FlashcardV2RecordKind      `json:"kind" api:"optional,nullable"`
	Revision *FlashcardV2EntityRevision `json:"revision,omitempty" api:"optional,nullable"`
	Event    *FlashcardV2Event          `json:"event,omitempty" api:"optional,nullable"`
}

type FlashcardV2ConflictResolutionRequest struct {
	OperationID      string                `json:"operationID" api:"optional,nullable"`
	EntityType       FlashcardV2EntityType `json:"entityType" api:"optional,nullable"`
	EntityID         string                `json:"entityID" api:"optional,nullable"`
	SelectedRevision string                `json:"selectedRevisionID" api:"optional,nullable"`
	ResolvedAt       int64                 `json:"resolvedAt" api:"optional,nullable"`
}

type FlashcardV2DeleteInvalidSourcesRequest struct {
	OperationID string                     `json:"operationID" api:"optional,nullable"`
	Sources     []FlashcardV2InvalidSource `json:"sources" api:"optional,nullable"`
	ChangedAt   int64                      `json:"changedAt" api:"optional,nullable"`
}

type FlashcardV2DeleteInvalidSourcesResult struct {
	Deleted []string `json:"deleted" api:"optional,nullable"`
	Skipped []string `json:"skipped" api:"optional,nullable"`
}

type FlashcardV2EntityConflictGroup struct {
	EntityType         FlashcardV2EntityType       `json:"entityType" api:"optional,nullable"`
	EntityID           string                      `json:"entityID" api:"optional,nullable"`
	SelectedRevisionID string                      `json:"selectedRevisionID" api:"optional,nullable"`
	DetectedAt         int64                       `json:"detectedAt" api:"optional,nullable"`
	Revisions          []FlashcardV2EntityRevision `json:"revisions" api:"optional,nullable"`
}

type FlashcardV2EntityListOptions struct {
	IncludeDeleted bool `json:"includeDeleted" api:"optional,nullable"`
	Limit          int  `json:"limit" api:"optional,nullable"`
	Offset         int  `json:"offset" api:"optional,nullable"`
}

type FlashcardV2EntityMutation struct {
	EntityType         FlashcardV2EntityType `json:"entityType" api:"optional,nullable"`
	EntityID           string                `json:"entityID" api:"optional,nullable"`
	ExpectedRevisionID string                `json:"expectedRevisionID,omitempty" api:"optional,nullable"`
	RequireAbsent      bool                  `json:"requireAbsent,omitempty" api:"optional,nullable"`
	UpdatedAt          int64                 `json:"updatedAt" api:"optional,nullable"`
	Deleted            bool                  `json:"deleted" api:"optional,nullable"`
	Payload            FlashcardV2JSON       `json:"payload,omitempty" api:"optional,nullable"`
}

type FlashcardV2EntityMutationResult struct {
	Batch     FlashcardV2OperationBatch   `json:"batch" api:"optional,nullable"`
	Revisions []FlashcardV2EntityRevision `json:"revisions" api:"optional,nullable"`
}

type FlashcardV2EntityPage struct {
	Entities []FlashcardV2EntityRevision `json:"entities" api:"optional,nullable"`
	Total    int                         `json:"total" api:"optional,nullable"`
}

type FlashcardV2EntityRevision struct {
	EntityType        FlashcardV2EntityType `json:"entityType" api:"optional,nullable"`
	EntityID          string                `json:"entityID" api:"optional,nullable"`
	RevisionID        string                `json:"revisionID" api:"optional,nullable"`
	ParentRevisionIDs []string              `json:"parentRevisionIDs,omitempty" api:"optional,nullable"`
	UpdatedAt         int64                 `json:"updatedAt" api:"optional,nullable"`
	Deleted           bool                  `json:"deleted" api:"optional,nullable"`
	Payload           FlashcardV2JSON       `json:"payload" api:"optional,nullable"`
}

type FlashcardV2EntityType string

type FlashcardV2Event struct {
	EventType  string          `json:"eventType" api:"optional,nullable"`
	EventID    string          `json:"eventID" api:"optional,nullable"`
	EntityID   string          `json:"entityID,omitempty" api:"optional,nullable"`
	OccurredAt int64           `json:"occurredAt" api:"optional,nullable"`
	Payload    FlashcardV2JSON `json:"payload" api:"optional,nullable"`
}

type FlashcardV2FinishSessionRequest struct {
	OperationID string `json:"operationID" api:"optional,nullable"`
	SessionID   string `json:"sessionID" api:"optional,nullable"`
	Status      string `json:"status" api:"optional,nullable"`
	EndedAt     int64  `json:"endedAt" api:"optional,nullable"`
}

type FlashcardV2AnkiUploadRequest struct {
	File        *multipart.FileHeader `json:"file" api:"optional"`
	NotebookID  string                `json:"notebookID" api:"optional"`
	OperationID string                `json:"operationID" api:"optional"`
}

type FlashcardV2EntityData struct {
	Found    bool                      `json:"found" api:"optional,nullable"`
	Revision FlashcardV2EntityRevision `json:"revision" api:"optional,nullable"`
}

type FlashcardV2HistoryData struct {
	Events []FlashcardV2Event `json:"events" api:"optional,nullable"`
}

type FlashcardV2QueueData struct {
	Cards []FlashcardV2SessionQueueCard `json:"cards" api:"optional,nullable"`
}

type FlashcardV2SourceHistoryList struct {
	Versions []FlashcardV2EntityRevision `json:"versions" api:"optional,nullable"`
}

type FlashcardV2SourceHistoryRequest struct {
	SourceID   string `json:"sourceID" api:"optional,nullable"`
	RevisionID string `json:"revisionID" api:"optional,nullable"`
	Limit      int    `json:"limit" api:"optional,nullable"`
	Offset     int    `json:"offset" api:"optional,nullable"`
}

type FlashcardV2SummariesData struct {
	Summaries map[string]FlashcardV2ReviewSetSummary `json:"summaries" api:"optional,nullable"`
}

type FlashcardV2HistoryDocument struct {
	RootID     string `json:"rootID" api:"optional,nullable"`
	NotebookID string `json:"notebookID" api:"optional,nullable"`

	Title string `json:"title" api:"optional,nullable"`
}

type FlashcardV2SourceHistoryVersion struct {
	FlashcardV2SourceHistoryConfig

	Documents map[string]FlashcardV2HistoryDocument `json:"documents" api:"optional,nullable"`
}

type FlashcardV2GenerationRule struct {
	Mode        string          `json:"mode" api:"optional,nullable"`
	VariantKey  string          `json:"variantKey,omitempty" api:"optional,nullable"`
	VariantData FlashcardV2JSON `json:"variantData,omitempty" api:"optional,nullable"`
}

type FlashcardV2GenerationStatus string

type FlashcardV2ImageOcclusionConfig struct {
	AssetID   string                           `json:"assetID" api:"optional,nullable"`
	Shapes    []FlashcardV2ImageOcclusionShape `json:"shapes" api:"optional,nullable"`
	Groups    []FlashcardV2ImageOcclusionGroup `json:"groups" api:"optional,nullable"`
	FrontMode string                           `json:"frontMode" api:"optional,nullable"`
}

type FlashcardV2ImageOcclusionGroup struct {
	ID           string   `json:"id" api:"optional,nullable"`
	ShapeIDs     []string `json:"shapeIDs" api:"optional,nullable"`
	DisplayOrder int      `json:"displayOrder" api:"optional,nullable"`
}

type FlashcardV2ImageOcclusionPoint struct {
	X float64 `json:"x" api:"optional,nullable"`
	Y float64 `json:"y" api:"optional,nullable"`
}

type FlashcardV2ImageOcclusionShape struct {
	ID     string                           `json:"id" api:"optional,nullable"`
	Type   string                           `json:"type" api:"optional,nullable"`
	X      float64                          `json:"x,omitempty" api:"optional,nullable"`
	Y      float64                          `json:"y,omitempty" api:"optional,nullable"`
	Width  float64                          `json:"width,omitempty" api:"optional,nullable"`
	Height float64                          `json:"height,omitempty" api:"optional,nullable"`
	Points []FlashcardV2ImageOcclusionPoint `json:"points,omitempty" api:"optional,nullable"`
}

type FlashcardV2InvalidSource struct {
	SourceID   string                   `json:"sourceID" api:"optional,nullable"`
	RevisionID string                   `json:"revisionID" api:"optional,nullable"`
	BlockIDs   []string                 `json:"blockIDs" api:"optional,nullable"`
	CardCount  int                      `json:"cardCount" api:"optional,nullable"`
	Reason     FlashcardV2BlockPresence `json:"reason" api:"optional,nullable,enum=closed|missing|unknown"`
}

type FlashcardV2InvalidSourcesReport struct {
	Sources []FlashcardV2InvalidSource `json:"sources" api:"optional,nullable"`
}

type FlashcardV2LegacyActivationResult struct {
	PreparedBatch   FlashcardV2OperationBatch        `json:"preparedBatch" api:"optional,nullable"`
	ActivationBatch FlashcardV2OperationBatch        `json:"activationBatch" api:"optional,nullable"`
	Status          FlashcardV2LegacyMigrationStatus `json:"status" api:"optional,nullable"`
}

type FlashcardV2LegacyFileFingerprint struct {
	Path   string `json:"path" api:"optional,nullable"`
	Size   int64  `json:"size" api:"optional,nullable"`
	SHA256 string `json:"sha256" api:"optional,nullable"`
}

type FlashcardV2LegacyFlashcardMigrationPreview struct {
	MigrationID  string                             `json:"migrationID" api:"optional,nullable"`
	RecordDigest string                             `json:"recordDigest" api:"optional,nullable"`
	InputFiles   []FlashcardV2LegacyFileFingerprint `json:"inputFiles" api:"optional,nullable"`
	Report       FlashcardV2LegacyMigrationReport   `json:"report" api:"optional,nullable"`
}

type FlashcardV2LegacyMigrationReport struct {
	Complete              bool `json:"Complete" api:"optional,nullable"`
	LegacyDecks           int  `json:"LegacyDecks" api:"optional,nullable"`
	LegacyCards           int  `json:"LegacyCards" api:"optional,nullable"`
	MigratedSources       int  `json:"MigratedSources" api:"optional,nullable"`
	MigratedCards         int  `json:"MigratedCards" api:"optional,nullable"`
	ArchivedCards         int  `json:"ArchivedCards" api:"optional,nullable"`
	MergedCards           int  `json:"MergedCards" api:"optional,nullable"`
	ReviewSets            int  `json:"ReviewSets" api:"optional,nullable"`
	ReviewEvents          int  `json:"ReviewEvents" api:"optional,nullable"`
	OrphanedSources       int  `json:"OrphanedSources" api:"optional,nullable"`
	SkippedEncryptedCards int  `json:"SkippedEncryptedCards" api:"optional,nullable"`
	SkippedEncryptedLogs  int  `json:"SkippedEncryptedLogs" api:"optional,nullable"`
	InvalidCards          int  `json:"InvalidCards" api:"optional,nullable"`
	UnmappedLogs          int  `json:"UnmappedLogs" api:"optional,nullable"`
}

type FlashcardV2LegacyMigrationStatus struct {
	State       string            `json:"state" api:"optional,nullable"`
	MigrationID string            `json:"migrationID,omitempty" api:"optional,nullable"`
	Prepared    *FlashcardV2Event `json:"prepared,omitempty" api:"optional,nullable"`
	Activated   *FlashcardV2Event `json:"activated,omitempty" api:"optional,nullable"`
	Diverged    *FlashcardV2Event `json:"diverged,omitempty" api:"optional,nullable"`
}

type FlashcardV2MembershipMode string

type FlashcardV2OperationBatch struct {
	FormatVersion   int                 `json:"formatVersion" api:"optional,nullable"`
	BatchID         string              `json:"batchID" api:"optional,nullable"`
	OperationID     string              `json:"operationID" api:"optional,nullable"`
	OperationDigest string              `json:"operationDigest" api:"optional,nullable"`
	DeviceID        string              `json:"deviceID" api:"optional,nullable"`
	WriterID        string              `json:"writerID" api:"optional,nullable"`
	Sequence        uint64              `json:"sequence" api:"optional,nullable"`
	RecordedAt      int64               `json:"recordedAt" api:"optional,nullable"`
	Changes         []FlashcardV2Change `json:"changes" api:"optional,nullable"`
	Checksum        string              `json:"checksum" api:"optional,nullable"`
}

type FlashcardV2QueryAST struct {
	Version int                        `json:"version" api:"optional,nullable"`
	Root    FlashcardV2QueryExpression `json:"root" api:"optional,nullable"`
}

type FlashcardV2QueryComparator string

type FlashcardV2QueryExpression struct {
	Operator   FlashcardV2QueryOperator     `json:"operator" api:"optional,nullable"`
	Children   []FlashcardV2QueryExpression `json:"children,omitempty" api:"optional,nullable"`
	Field      string                       `json:"field,omitempty" api:"optional,nullable"`
	Comparator FlashcardV2QueryComparator   `json:"comparator,omitempty" api:"optional,nullable"`
	Value      FlashcardV2JSON              `json:"value,omitempty" api:"optional,nullable"`
}

type FlashcardV2QueryOperator string

type FlashcardV2ReconcileResult struct {
	Batch     *FlashcardV2OperationBatch `json:"batch,omitempty" api:"optional,nullable"`
	Created   []string                   `json:"created" api:"optional,nullable"`
	Updated   []string                   `json:"updated" api:"optional,nullable"`
	Unchanged []string                   `json:"unchanged" api:"optional,nullable"`
}

type FlashcardV2RecordKind string

type FlashcardV2RestoreSourceHistoryRequest struct {
	OperationID string `json:"operationID" api:"optional,nullable"`

	SourceID string `json:"sourceID" api:"optional,nullable"`

	RevisionID string `json:"revisionID" api:"optional,nullable"`

	ExpectedRevisionID string `json:"expectedRevisionID" api:"optional,nullable"`

	UpdatedAt int64 `json:"updatedAt" api:"optional,nullable"`
}

type FlashcardV2ReviewRating string

type FlashcardV2ReviewRequest struct {
	OperationID     string                  `json:"operationID" api:"optional,nullable"`
	CardID          string                  `json:"cardID" api:"optional,nullable"`
	Rating          FlashcardV2ReviewRating `json:"rating" api:"optional,nullable"`
	ReviewedAt      int64                   `json:"reviewedAt" api:"optional,nullable"`
	ReviewDayStart  int64                   `json:"reviewDayStart,omitempty" api:"optional,nullable"`
	ReviewDayEnd    int64                   `json:"reviewDayEnd,omitempty" api:"optional,nullable"`
	DurationMS      int64                   `json:"durationMS" api:"optional,nullable"`
	SessionID       string                  `json:"sessionID,omitempty" api:"optional,nullable"`
	ReviewSetID     string                  `json:"reviewSetID,omitempty" api:"optional,nullable"`
	ReviewMode      string                  `json:"reviewMode" api:"optional,nullable"`
	BuryUntil       int64                   `json:"buryUntil,omitempty" api:"optional,nullable"`
	AnswerResult    FlashcardV2JSON         `json:"answerResult,omitempty" api:"optional,nullable"`
	StateRevisionID string                  `json:"stateRevisionID,omitempty" api:"optional,nullable"`
}

type FlashcardV2ReviewResult struct {
	Batch                 FlashcardV2OperationBatch       `json:"batch" api:"optional,nullable"`
	Event                 FlashcardV2Event                `json:"event" api:"optional,nullable"`
	BeforeState           FlashcardV2ReviewStateSnapshot  `json:"beforeState" api:"optional,nullable"`
	AfterState            *FlashcardV2ReviewStateSnapshot `json:"afterState,omitempty" api:"optional,nullable"`
	BuriedSiblingIDs      []string                        `json:"buriedSiblingIDs" api:"optional,nullable"`
	SkippedSessionCardIDs []string                        `json:"skippedSessionCardIDs" api:"optional,nullable"`
	SessionCard           *FlashcardV2SessionCard         `json:"sessionCard,omitempty" api:"optional,nullable"`
	LeechTagged           bool                            `json:"leechTagged" api:"optional,nullable"`
	PresetRevisionID      string                          `json:"presetRevisionID" api:"optional,nullable"`
	SchedulerVersion      string                          `json:"schedulerVersion" api:"optional,nullable"`
}

type FlashcardV2ReviewSetCardPage struct {
	CardIDs []string                      `json:"cardIDs" api:"optional,nullable"`
	Cards   []FlashcardV2CardSearchResult `json:"cards,omitempty" api:"optional,nullable"`
	Total   int                           `json:"total" api:"optional,nullable"`
}

type FlashcardV2ReviewSetMembership struct {
	ID          string                    `json:"id" api:"optional,nullable"`
	ReviewSetID string                    `json:"reviewSetID" api:"optional,nullable"`
	CardID      string                    `json:"cardID" api:"optional,nullable"`
	Mode        FlashcardV2MembershipMode `json:"mode" api:"optional,nullable"`
}

type FlashcardV2ReviewSetSummary struct {
	ReviewSetID string `json:"reviewSetID" api:"optional,nullable"`
	Cards       int    `json:"cards" api:"optional,nullable"`
	Due         int    `json:"due" api:"optional,nullable"`
	Included    int    `json:"included" api:"optional,nullable"`
	Excluded    int    `json:"excluded" api:"optional,nullable"`
}

type FlashcardV2ReviewState struct {
	CardID string `json:"cardID" api:"optional,nullable"`
	FlashcardV2ReviewStateSnapshot
}

type FlashcardV2ReviewStateSnapshot struct {
	State           string  `json:"state" api:"optional,nullable"`
	Due             int64   `json:"due" api:"optional,nullable"`
	LastReview      int64   `json:"lastReview,omitempty" api:"optional,nullable"`
	Stability       float64 `json:"stability" api:"optional,nullable"`
	Difficulty      float64 `json:"difficulty" api:"optional,nullable"`
	ElapsedDays     uint64  `json:"elapsedDays" api:"optional,nullable"`
	ScheduledDays   uint64  `json:"scheduledDays" api:"optional,nullable"`
	Reps            uint64  `json:"reps" api:"optional,nullable"`
	Lapses          uint64  `json:"lapses" api:"optional,nullable"`
	Suspended       bool    `json:"suspended" api:"optional,nullable"`
	BuriedUntil     int64   `json:"buriedUntil,omitempty" api:"optional,nullable"`
	BuriedReason    string  `json:"buriedReason,omitempty" api:"optional,nullable"`
	StateRevisionID string  `json:"stateRevisionID" api:"optional,nullable"`
}

type FlashcardV2ReviewUndoRequest struct {
	OperationID   string `json:"operationID" api:"optional,nullable"`
	ReviewEventID string `json:"reviewEventID" api:"optional,nullable"`
	CardID        string `json:"cardID" api:"optional,nullable"`
	UndoneAt      int64  `json:"undoneAt" api:"optional,nullable"`
}

type FlashcardV2ReviewUndoResult struct {
	Batch                  FlashcardV2OperationBatch       `json:"batch" api:"optional,nullable"`
	Event                  FlashcardV2Event                `json:"event" api:"optional,nullable"`
	ReviewEventID          string                          `json:"reviewEventID" api:"optional,nullable"`
	CardID                 string                          `json:"cardID" api:"optional,nullable"`
	RestoredState          *FlashcardV2ReviewStateSnapshot `json:"restoredState,omitempty" api:"optional,nullable"`
	RestoredSiblingIDs     []string                        `json:"restoredSiblingIDs" api:"optional,nullable"`
	RestoredSessionCardIDs []string                        `json:"restoredSessionCardIDs" api:"optional,nullable"`
	SessionCard            *FlashcardV2SessionCard         `json:"sessionCard,omitempty" api:"optional,nullable"`
	LeechTagRemoved        bool                            `json:"leechTagRemoved" api:"optional,nullable"`
}

type FlashcardV2SaveStudyPolicyRequest struct {
	OperationID        string  `json:"operationID" api:"optional,nullable"`
	ScopeType          string  `json:"scopeType" api:"optional,nullable"`
	ScopeID            string  `json:"scopeID" api:"optional,nullable"`
	Priority           string  `json:"priority" api:"optional,nullable"`
	DefaultPresetID    *string `json:"defaultPresetID,omitempty" api:"optional,nullable"`
	TargetDate         *int64  `json:"targetDate,omitempty" api:"optional,nullable"`
	ExpectedRevisionID string  `json:"expectedRevisionID,omitempty" api:"optional,nullable"`
	UpdatedAt          int64   `json:"updatedAt" api:"optional,nullable"`
}

type FlashcardV2SaveTagRequest struct {
	OperationID        string `json:"operationID" api:"optional,nullable"`
	TagID              string `json:"tagID" api:"optional,nullable"`
	ParentID           string `json:"parentID,omitempty" api:"optional,nullable"`
	Name               string `json:"name" api:"optional,nullable"`
	ExpectedRevisionID string `json:"expectedRevisionID,omitempty" api:"optional,nullable"`
	UpdatedAt          int64  `json:"updatedAt" api:"optional,nullable"`
}

type FlashcardV2SessionCard struct {
	ID              string                           `json:"id" api:"optional,nullable"`
	SessionID       string                           `json:"sessionID" api:"optional,nullable"`
	CardID          string                           `json:"cardID" api:"optional,nullable"`
	StateRevisionID string                           `json:"stateRevisionID,omitempty" api:"optional,nullable"`
	Sort            int                              `json:"sort" api:"optional,nullable"`
	Status          string                           `json:"status" api:"optional,nullable,enum=queued|shown|reviewed|skipped"`
	SkipReason      string                           `json:"skipReason,omitempty" api:"optional,nullable"`
	OptionOrder     []string                         `json:"optionOrder,omitempty" api:"optional,nullable"`
	DynamicOptions  []FlashcardV2SessionChoiceOption `json:"dynamicOptions,omitempty" api:"optional,nullable"`
	StepResults     FlashcardV2JSON                  `json:"stepResults,omitempty" api:"optional,nullable"`
}

type FlashcardV2SessionCardUpdateRequest struct {
	OperationID string `json:"operationID" api:"optional,nullable"`
	SessionID   string `json:"sessionID" api:"optional,nullable"`
	CardID      string `json:"cardID" api:"optional,nullable"`
	Status      string `json:"status" api:"optional,nullable"`
	SkipReason  string `json:"skipReason,omitempty" api:"optional,nullable"`
	UpdatedAt   int64  `json:"updatedAt" api:"optional,nullable"`
}

type FlashcardV2SessionChoiceOption struct {
	ID         string `json:"id" api:"optional,nullable"`
	EntityType string `json:"entityType" api:"optional,nullable"`
	EntityID   string `json:"entityID" api:"optional,nullable"`
}

type FlashcardV2SessionQueueCard struct {
	SessionCard FlashcardV2SessionCard `json:"sessionCard" api:"optional,nullable"`
	Card        FlashcardV2Card        `json:"card" api:"optional,nullable"`
	ReviewState FlashcardV2ReviewState `json:"reviewState" api:"optional,nullable"`
	RepeatDue   int64                  `json:"repeatDue,omitempty" api:"optional,nullable"`
}

type FlashcardV2SetReviewSetMembershipsRequest struct {
	OperationID string                    `json:"operationID" api:"optional,nullable"`
	ReviewSetID string                    `json:"reviewSetID" api:"optional,nullable"`
	CardIDs     []string                  `json:"cardIDs" api:"optional,nullable"`
	Mode        FlashcardV2MembershipMode `json:"mode" api:"optional,nullable"`
	ChangedAt   int64                     `json:"changedAt" api:"optional,nullable"`
}

type FlashcardV2SetReviewSetMembershipsResult struct {
	Batch          FlashcardV2OperationBatch                 `json:"batch" api:"optional,nullable"`
	Memberships    map[string]FlashcardV2ReviewSetMembership `json:"memberships" api:"optional,nullable"`
	ClearedCardIDs []string                                  `json:"clearedCardIDs" api:"optional,nullable"`
}

type FlashcardV2SetTagAssignmentsRequest struct {
	OperationID string   `json:"operationID" api:"optional,nullable"`
	TargetType  string   `json:"targetType" api:"optional,nullable"`
	TargetIDs   []string `json:"targetIDs" api:"optional,nullable"`
	TagIDs      []string `json:"tagIDs" api:"optional,nullable"`
	ChangedAt   int64    `json:"changedAt" api:"optional,nullable"`
}

type FlashcardV2SetTagAssignmentsResult struct {
	Batch       FlashcardV2OperationBatch `json:"batch" api:"optional,nullable"`
	Assignments map[string][]string       `json:"assignments" api:"optional,nullable"`
}

type FlashcardV2SourceHistoryConfig struct {
	Revision FlashcardV2EntityRevision `json:"revision" api:"optional,nullable"`

	References []FlashcardV2CardSourceRef `json:"references" api:"optional,nullable"`

	Modes []string `json:"modes" api:"optional,nullable"`
}

type FlashcardV2SourceLifecycleRequest struct {
	OperationID      string `json:"operationID" api:"optional,nullable"`
	SourceID         string `json:"sourceID" api:"optional,nullable"`
	Action           string `json:"action" api:"optional,nullable"`
	ExpectedRevision string `json:"expectedRevision,omitempty" api:"optional,nullable"`
	ChangedAt        int64  `json:"changedAt" api:"optional,nullable"`
}

type FlashcardV2SourceLifecycleResult struct {
	Batch          *FlashcardV2OperationBatch `json:"batch,omitempty" api:"optional,nullable"`
	SourceRevision FlashcardV2EntityRevision  `json:"sourceRevision" api:"optional,nullable"`
}

type FlashcardV2StatisticsBucket string

type FlashcardV2StatisticsDistributionPoint struct {
	Label string   `json:"label" api:"optional,nullable"`
	Min   float64  `json:"min" api:"optional,nullable"`
	Max   *float64 `json:"max" api:"optional,nullable"`
	Count int      `json:"count" api:"optional,nullable"`
}

type FlashcardV2StatisticsDuePoint struct {
	Start int64 `json:"start" api:"optional,nullable"`
	Cards int   `json:"cards" api:"optional,nullable"`
}

type FlashcardV2StatisticsHistory struct {
	Reviews           int            `json:"reviews" api:"optional,nullable"`
	UniqueCards       int            `json:"uniqueCards" api:"optional,nullable"`
	Ratings           map[string]int `json:"ratings" api:"optional,nullable"`
	Correct           int            `json:"correct" api:"optional,nullable"`
	Lapses            int            `json:"lapses" api:"optional,nullable"`
	Accuracy          float64        `json:"accuracy" api:"optional,nullable"`
	TrueRetention     float64        `json:"trueRetention" api:"optional,nullable"`
	RetentionReviews  int            `json:"retentionReviews" api:"optional,nullable"`
	DurationTotalMS   int64          `json:"durationTotalMS" api:"optional,nullable"`
	DurationKnown     int            `json:"durationKnown" api:"optional,nullable"`
	DurationUnknown   int            `json:"durationUnknown" api:"optional,nullable"`
	AverageDurationMS *float64       `json:"averageDurationMS,omitempty" api:"optional,nullable"`
}

type FlashcardV2StatisticsHourPoint struct {
	Hour      int     `json:"hour" api:"optional,nullable"`
	Reviews   int     `json:"reviews" api:"optional,nullable"`
	Correct   int     `json:"correct" api:"optional,nullable"`
	Retention float64 `json:"retention" api:"optional,nullable"`
}

type FlashcardV2StatisticsOverview struct {
	CurrentCards       int            `json:"currentCards" api:"optional,nullable"`
	DeletedCards       int            `json:"deletedCards" api:"optional,nullable"`
	ReviewStates       map[string]int `json:"reviewStates" api:"optional,nullable"`
	GenerationStatuses map[string]int `json:"generationStatuses" api:"optional,nullable"`
	Suspended          int            `json:"suspended" api:"optional,nullable"`
	Buried             int            `json:"buried" api:"optional,nullable"`
	Paused             int            `json:"paused" api:"optional,nullable"`
	Leeches            int            `json:"leeches" api:"optional,nullable"`
}

type FlashcardV2StatisticsRequest struct {
	ReviewSetID           string                      `json:"reviewSetID,omitempty" api:"optional,nullable"`
	Query                 *FlashcardV2QueryAST        `json:"query,omitempty" api:"optional,nullable"`
	CardIDs               []string                    `json:"cardIDs,omitempty" api:"optional,nullable"`
	From                  int64                       `json:"from,omitempty" api:"optional,nullable"`
	To                    int64                       `json:"to,omitempty" api:"optional,nullable"`
	Now                   int64                       `json:"now" api:"optional,nullable"`
	Bucket                FlashcardV2StatisticsBucket `json:"bucket" api:"optional,nullable"`
	TimezoneOffsetMinutes int                         `json:"timezoneOffsetMinutes" api:"optional,nullable"`
	FutureDays            int                         `json:"futureDays" api:"optional,nullable"`
}

type FlashcardV2StatisticsResult struct {
	Scope                      string                                   `json:"scope" api:"optional,nullable"`
	From                       int64                                    `json:"from" api:"optional,nullable"`
	To                         int64                                    `json:"to" api:"optional,nullable"`
	Overview                   FlashcardV2StatisticsOverview            `json:"overview" api:"optional,nullable"`
	History                    FlashcardV2StatisticsHistory             `json:"history" api:"optional,nullable"`
	Series                     []FlashcardV2StatisticsTimePoint         `json:"series" api:"optional,nullable"`
	ByHour                     []FlashcardV2StatisticsHourPoint         `json:"byHour" api:"optional,nullable"`
	Overdue                    int                                      `json:"overdue" api:"optional,nullable"`
	FutureDue                  []FlashcardV2StatisticsDuePoint          `json:"futureDue" api:"optional,nullable"`
	IntervalDistribution       []FlashcardV2StatisticsDistributionPoint `json:"intervalDistribution" api:"optional,nullable"`
	StabilityDistribution      []FlashcardV2StatisticsDistributionPoint `json:"stabilityDistribution" api:"optional,nullable"`
	DifficultyDistribution     []FlashcardV2StatisticsDistributionPoint `json:"difficultyDistribution" api:"optional,nullable"`
	RetrievabilityDistribution []FlashcardV2StatisticsDistributionPoint `json:"retrievabilityDistribution" api:"optional,nullable"`
}

type FlashcardV2StatisticsTimePoint struct {
	Start           int64 `json:"start" api:"optional,nullable"`
	Reviews         int   `json:"reviews" api:"optional,nullable"`
	UniqueCards     int   `json:"uniqueCards" api:"optional,nullable"`
	Correct         int   `json:"correct" api:"optional,nullable"`
	DurationTotalMS int64 `json:"durationTotalMS" api:"optional,nullable"`
	DurationKnown   int   `json:"durationKnown" api:"optional,nullable"`
}

type FlashcardV2StudyDayOptions struct {
	Now            int64 `json:"now,omitempty" api:"optional,nullable"`
	ReviewDayStart int64 `json:"reviewDayStart,omitempty" api:"optional,nullable"`
	ReviewDayEnd   int64 `json:"reviewDayEnd,omitempty" api:"optional,nullable"`
}

type FlashcardV2StudyQueueRequest struct {
	OperationID      string               `json:"operationID" api:"optional,nullable"`
	SessionID        string               `json:"sessionID" api:"optional,nullable"`
	ReviewSetID      string               `json:"reviewSetID,omitempty" api:"optional,nullable"`
	ReviewSetIDs     []string             `json:"reviewSetIDs,omitempty" api:"optional,nullable"`
	CardIDs          []string             `json:"cardIDs,omitempty" api:"optional,nullable"`
	Query            *FlashcardV2QueryAST `json:"query,omitempty" api:"optional,nullable"`
	ReviewMode       string               `json:"reviewMode,omitempty" api:"optional,nullable"`
	Seed             string               `json:"seed,omitempty" api:"optional,nullable"`
	Now              int64                `json:"now" api:"optional,nullable"`
	ReviewDayStart   int64                `json:"reviewDayStart,omitempty" api:"optional,nullable"`
	ReviewDayEnd     int64                `json:"reviewDayEnd,omitempty" api:"optional,nullable"`
	NewLimit         int                  `json:"newLimit" api:"optional,nullable"`
	ReviewLimit      int                  `json:"reviewLimit" api:"optional,nullable"`
	IncludeSuspended bool                 `json:"includeSuspended" api:"optional,nullable"`
	IncludeBuried    bool                 `json:"includeBuried" api:"optional,nullable"`
	IncludePaused    bool                 `json:"includePaused" api:"optional,nullable"`
}

type FlashcardV2StudyQueueResult struct {
	Batch        FlashcardV2OperationBatch `json:"batch" api:"optional,nullable"`
	Session      FlashcardV2StudySession   `json:"session" api:"optional,nullable"`
	SessionCards []FlashcardV2SessionCard  `json:"sessionCards" api:"optional,nullable"`
}

type FlashcardV2StudySession struct {
	ID               string          `json:"id" api:"optional,nullable"`
	ReviewSetID      string          `json:"reviewSetID,omitempty" api:"optional,nullable"`
	ReviewSetIDs     []string        `json:"reviewSetIDs,omitempty" api:"optional,nullable"`
	CardIDs          []string        `json:"cardIDs,omitempty" api:"optional,nullable"`
	QueryAST         FlashcardV2JSON `json:"queryAST,omitempty" api:"optional,nullable"`
	ReviewMode       string          `json:"reviewMode" api:"optional,nullable"`
	Status           string          `json:"status" api:"optional,nullable"`
	Seed             string          `json:"seed" api:"optional,nullable"`
	NewLimit         int             `json:"newLimit" api:"optional,nullable"`
	ReviewLimit      int             `json:"reviewLimit" api:"optional,nullable"`
	IncludeSuspended bool            `json:"includeSuspended" api:"optional,nullable"`
	IncludeBuried    bool            `json:"includeBuried" api:"optional,nullable"`
	IncludePaused    bool            `json:"includePaused" api:"optional,nullable"`
	SelectionDigest  string          `json:"selectionDigest" api:"optional,nullable"`
	StartedAt        int64           `json:"startedAt" api:"optional,nullable"`
	ReviewDayStart   int64           `json:"reviewDayStart,omitempty" api:"optional,nullable"`
	ReviewDayEnd     int64           `json:"reviewDayEnd,omitempty" api:"optional,nullable"`
	EndedAt          *int64          `json:"endedAt,omitempty" api:"optional,nullable"`
}

type FlashcardV2TypedAnswerConfig struct {
	CaseSensitive      bool    `json:"caseSensitive" api:"optional,nullable"`
	IgnoreDiacritics   bool    `json:"ignoreDiacritics" api:"optional,nullable"`
	FuzzyMaxDistance   int     `json:"fuzzyMaxDistance,omitempty" api:"optional,nullable"`
	FuzzyMaxRatio      float64 `json:"fuzzyMaxRatio,omitempty" api:"optional,nullable"`
	TrimWhitespace     bool    `json:"trimWhitespace" api:"optional,nullable"`
	CollapseWhitespace bool    `json:"collapseWhitespace" api:"optional,nullable"`
}

type FlashcardV2ActivateFlashcardMigrationRequest struct {
	MigrationID  string `json:"migrationID" api:"optional,nullable"`
	RecordDigest string `json:"recordDigest" api:"optional,nullable"`
}

type FlashcardV2DeleteFlashcardReviewSetRequest struct {
	OperationID        string `json:"operationID" api:"optional,nullable"`
	ReviewSetID        string `json:"reviewSetID" api:"optional,nullable"`
	ExpectedRevisionID string `json:"expectedRevisionID,omitempty" api:"optional,nullable"`
	DeletedAt          int64  `json:"deletedAt" api:"optional,nullable"`
}

type FlashcardV2GetFlashcardEntityRequest struct {
	EntityType FlashcardV2EntityType `json:"entityType" api:"optional,nullable"`
	EntityID   string                `json:"entityID" api:"optional,nullable"`
}

type FlashcardV2GetFlashcardHistoryRequest struct {
	CardID string `json:"cardID" api:"optional,nullable"`
	Limit  int    `json:"limit" api:"optional,nullable"`
	Offset int    `json:"offset" api:"optional,nullable"`
}

type FlashcardV2GetFlashcardRenderModelRequest struct {
	CardID string `json:"cardID" api:"optional,nullable"`
}

type FlashcardV2GetFlashcardSessionQueueRequest struct {
	FlashcardV2StudyDayOptions
	SessionID string `json:"sessionID" api:"optional,nullable"`
}

type FlashcardV2GetFlashcardStudyPolicyRequest struct {
	ScopeType string `json:"scopeType" api:"optional,nullable"`
	ScopeID   string `json:"scopeID" api:"optional,nullable"`
}

type FlashcardV2ListFlashcardConflictsRequest struct {
	Limit int `json:"limit" api:"optional,nullable"`
}

type FlashcardV2ListFlashcardEntitiesRequest struct {
	EntityType FlashcardV2EntityType        `json:"entityType" api:"optional,nullable"`
	Options    FlashcardV2EntityListOptions `json:"options" api:"optional,nullable"`
}

type FlashcardV2MutateFlashcardEntitiesRequest struct {
	OperationID string                      `json:"operationID" api:"optional,nullable"`
	Mutations   []FlashcardV2EntityMutation `json:"mutations" api:"optional,nullable"`
}

type FlashcardV2PreviewFlashcardReviewSetRequest struct {
	ReviewSetID string                       `json:"reviewSetID" api:"optional,nullable"`
	Query       *FlashcardV2QueryAST         `json:"query,omitempty" api:"optional,nullable"`
	Options     FlashcardV2CardSearchOptions `json:"options" api:"optional,nullable"`
}

type FlashcardV2ReconcileFlashcardSourceRequest struct {
	OperationID string `json:"operationID" api:"optional,nullable"`
	SourceID    string `json:"sourceID" api:"optional,nullable"`
	UpdatedAt   int64  `json:"updatedAt" api:"optional,nullable"`
}

type FlashcardV2SummarizeFlashcardReviewSetsRequest struct {
	ReviewSetIDs []string `json:"reviewSetIDs" api:"optional,nullable"`
	Now          int64    `json:"now" api:"optional,nullable"`
}

// FlashcardV2SourceHistoryData 返回配置修订列表或指定修订的详情，正文由文档历史管理。
type FlashcardV2SourceHistoryData struct {
	Versions []FlashcardV2EntityRevision      `json:"Versions" api:"optional,nullable"`
	Version  *FlashcardV2SourceHistoryVersion `json:"Version" api:"optional,nullable"`
}

func (data FlashcardV2SourceHistoryData) MarshalJSON() ([]byte, error) {
	if data.Version != nil {
		return json.Marshal(data.Version)
	}
	return json.Marshal(FlashcardV2SourceHistoryList{Versions: data.Versions})
}

func init() {
	ActivateFlashcardMigration.decodeRequest = decodeFlashcardV2Request[FlashcardV2ActivateFlashcardMigrationRequest]
	ActivateFlashcardMigration.decodeFailure = func(err error) Response[FlashcardV2LegacyActivationResult] {
		return Failure[FlashcardV2LegacyActivationResult](-1, "invalid flashcard request: "+err.Error())
	}
	CreateAdvancedFlashcardSource.decodeRequest = decodeFlashcardV2Request[FlashcardV2AdvancedSourceRequest]
	CreateAdvancedFlashcardSource.decodeFailure = func(err error) Response[FlashcardV2AdvancedSourceResult] {
		return Failure[FlashcardV2AdvancedSourceResult](-1, "invalid flashcard request: "+err.Error())
	}
	CreateBasicFlashcardSource.decodeRequest = decodeFlashcardV2Request[FlashcardV2BasicSourceRequest]
	CreateBasicFlashcardSource.decodeFailure = func(err error) Response[FlashcardV2BasicSourceResult] {
		return Failure[FlashcardV2BasicSourceResult](-1, "invalid flashcard request: "+err.Error())
	}
	DeleteInvalidFlashcardSources.decodeRequest = decodeFlashcardV2Request[FlashcardV2DeleteInvalidSourcesRequest]
	DeleteInvalidFlashcardSources.decodeFailure = func(err error) Response[FlashcardV2DeleteInvalidSourcesResult] {
		return Failure[FlashcardV2DeleteInvalidSourcesResult](-1, "invalid flashcard request: "+err.Error())
	}
	DeleteFlashcardReviewSet.decodeRequest = decodeFlashcardV2Request[FlashcardV2DeleteFlashcardReviewSetRequest]
	DeleteFlashcardReviewSet.decodeFailure = func(err error) Response[FlashcardV2EntityMutationResult] {
		return Failure[FlashcardV2EntityMutationResult](-1, "invalid flashcard request: "+err.Error())
	}
	FinishFlashcardSession.decodeRequest = decodeFlashcardV2Request[FlashcardV2FinishSessionRequest]
	FinishFlashcardSession.decodeFailure = func(err error) Response[FlashcardV2StudySession] {
		return Failure[FlashcardV2StudySession](-1, "invalid flashcard request: "+err.Error())
	}
	GetFlashcardHistory.decodeRequest = decodeFlashcardV2Request[FlashcardV2GetFlashcardHistoryRequest]
	GetFlashcardHistory.decodeFailure = func(err error) Response[FlashcardV2HistoryData] {
		return Failure[FlashcardV2HistoryData](-1, "invalid flashcard request: "+err.Error())
	}
	GetFlashcardEntity.decodeRequest = decodeFlashcardV2Request[FlashcardV2GetFlashcardEntityRequest]
	GetFlashcardEntity.decodeFailure = func(err error) Response[FlashcardV2EntityData] {
		return Failure[FlashcardV2EntityData](-1, "invalid flashcard request: "+err.Error())
	}
	GetFlashcardRenderModel.decodeRequest = decodeFlashcardV2Request[FlashcardV2GetFlashcardRenderModelRequest]
	GetFlashcardRenderModel.decodeFailure = func(err error) Response[FlashcardV2CardRenderModel] {
		return Failure[FlashcardV2CardRenderModel](-1, "invalid flashcard request: "+err.Error())
	}
	GetFlashcardSessionQueue.decodeRequest = decodeFlashcardV2Request[FlashcardV2GetFlashcardSessionQueueRequest]
	GetFlashcardSessionQueue.decodeFailure = func(err error) Response[FlashcardV2QueueData] {
		return Failure[FlashcardV2QueueData](-1, "invalid flashcard request: "+err.Error())
	}
	GetFlashcardSourceHistory.decodeFailure = func(err error) Response[FlashcardV2SourceHistoryData] {
		return Failure[FlashcardV2SourceHistoryData](-1, "invalid flashcard request: "+err.Error())
	}
	GetFlashcardStatistics.decodeRequest = decodeFlashcardV2Request[FlashcardV2StatisticsRequest]
	GetFlashcardStatistics.decodeFailure = func(err error) Response[FlashcardV2StatisticsResult] {
		return Failure[FlashcardV2StatisticsResult](-1, "invalid flashcard request: "+err.Error())
	}
	GetFlashcardStudyPolicy.decodeRequest = decodeFlashcardV2Request[FlashcardV2GetFlashcardStudyPolicyRequest]
	GetFlashcardStudyPolicy.decodeFailure = func(err error) Response[FlashcardV2EntityData] {
		return Failure[FlashcardV2EntityData](-1, "invalid flashcard request: "+err.Error())
	}
	ImportAnkiFlashcardPackage.decodeFailure = func(err error) Response[FlashcardV2AnkiImportReport] {
		return Failure[FlashcardV2AnkiImportReport](-1, err.Error())
	}
	ListFlashcardConflicts.decodeRequest = decodeFlashcardV2Request[FlashcardV2ListFlashcardConflictsRequest]
	ListFlashcardConflicts.decodeFailure = func(err error) Response[[]FlashcardV2EntityConflictGroup] {
		return Failure[[]FlashcardV2EntityConflictGroup](-1, "invalid flashcard request: "+err.Error())
	}
	ListFlashcardEntities.decodeRequest = decodeFlashcardV2Request[FlashcardV2ListFlashcardEntitiesRequest]
	ListFlashcardEntities.decodeFailure = func(err error) Response[FlashcardV2EntityPage] {
		return Failure[FlashcardV2EntityPage](-1, "invalid flashcard request: "+err.Error())
	}
	ManageFlashcards.decodeRequest = decodeFlashcardV2Request[FlashcardV2CardManagementRequest]
	ManageFlashcards.decodeFailure = func(err error) Response[FlashcardV2CardManagementResult] {
		return Failure[FlashcardV2CardManagementResult](-1, "invalid flashcard request: "+err.Error())
	}
	ManageFlashcardSourceLifecycle.decodeRequest = decodeFlashcardV2Request[FlashcardV2SourceLifecycleRequest]
	ManageFlashcardSourceLifecycle.decodeFailure = func(err error) Response[FlashcardV2SourceLifecycleResult] {
		return Failure[FlashcardV2SourceLifecycleResult](-1, "invalid flashcard request: "+err.Error())
	}
	MutateFlashcardEntities.decodeRequest = decodeFlashcardV2Request[FlashcardV2MutateFlashcardEntitiesRequest]
	MutateFlashcardEntities.decodeFailure = func(err error) Response[FlashcardV2EntityMutationResult] {
		return Failure[FlashcardV2EntityMutationResult](-1, "invalid flashcard request: "+err.Error())
	}
	PreviewAnkiFlashcardPackage.decodeFailure = func(err error) Response[FlashcardV2AnkiPackagePreview] {
		return Failure[FlashcardV2AnkiPackagePreview](-1, err.Error())
	}
	PreviewFlashcardReviewSet.decodeRequest = decodeFlashcardV2Request[FlashcardV2PreviewFlashcardReviewSetRequest]
	PreviewFlashcardReviewSet.decodeFailure = func(err error) Response[FlashcardV2ReviewSetCardPage] {
		return Failure[FlashcardV2ReviewSetCardPage](-1, "invalid flashcard request: "+err.Error())
	}
	ReconcileFlashcardSource.decodeRequest = decodeFlashcardV2Request[FlashcardV2ReconcileFlashcardSourceRequest]
	ReconcileFlashcardSource.decodeFailure = func(err error) Response[FlashcardV2ReconcileResult] {
		return Failure[FlashcardV2ReconcileResult](-1, "invalid flashcard request: "+err.Error())
	}
	ResolveFlashcardConflict.decodeRequest = decodeFlashcardV2Request[FlashcardV2ConflictResolutionRequest]
	ResolveFlashcardConflict.decodeFailure = func(err error) Response[FlashcardV2EntityRevision] {
		return Failure[FlashcardV2EntityRevision](-1, "invalid flashcard request: "+err.Error())
	}
	RestoreFlashcardSourceHistory.decodeRequest = decodeFlashcardV2Request[FlashcardV2RestoreSourceHistoryRequest]
	RestoreFlashcardSourceHistory.decodeFailure = func(err error) Response[FlashcardV2EntityRevision] {
		return Failure[FlashcardV2EntityRevision](-1, "invalid flashcard request: "+err.Error())
	}
	ReviewFlashcard.decodeRequest = decodeFlashcardV2Request[FlashcardV2ReviewRequest]
	ReviewFlashcard.decodeFailure = func(err error) Response[FlashcardV2ReviewResult] {
		return Failure[FlashcardV2ReviewResult](-1, "invalid flashcard request: "+err.Error())
	}
	SaveFlashcardStudyPolicy.decodeRequest = decodeFlashcardV2Request[FlashcardV2SaveStudyPolicyRequest]
	SaveFlashcardStudyPolicy.decodeFailure = func(err error) Response[FlashcardV2EntityRevision] {
		return Failure[FlashcardV2EntityRevision](-1, "invalid flashcard request: "+err.Error())
	}
	SaveFlashcardTag.decodeRequest = decodeFlashcardV2Request[FlashcardV2SaveTagRequest]
	SaveFlashcardTag.decodeFailure = func(err error) Response[FlashcardV2EntityRevision] {
		return Failure[FlashcardV2EntityRevision](-1, "invalid flashcard request: "+err.Error())
	}
	SetFlashcardReviewSetMemberships.decodeRequest = decodeFlashcardV2Request[FlashcardV2SetReviewSetMembershipsRequest]
	SetFlashcardReviewSetMemberships.decodeFailure = func(err error) Response[FlashcardV2SetReviewSetMembershipsResult] {
		return Failure[FlashcardV2SetReviewSetMembershipsResult](-1, "invalid flashcard request: "+err.Error())
	}
	SetFlashcardTagAssignments.decodeRequest = decodeFlashcardV2Request[FlashcardV2SetTagAssignmentsRequest]
	SetFlashcardTagAssignments.decodeFailure = func(err error) Response[FlashcardV2SetTagAssignmentsResult] {
		return Failure[FlashcardV2SetTagAssignmentsResult](-1, "invalid flashcard request: "+err.Error())
	}
	StartFlashcardSession.decodeRequest = decodeFlashcardV2Request[FlashcardV2StudyQueueRequest]
	StartFlashcardSession.decodeFailure = func(err error) Response[FlashcardV2StudyQueueResult] {
		return Failure[FlashcardV2StudyQueueResult](-1, "invalid flashcard request: "+err.Error())
	}
	SummarizeFlashcardReviewSets.decodeRequest = decodeFlashcardV2Request[FlashcardV2SummarizeFlashcardReviewSetsRequest]
	SummarizeFlashcardReviewSets.decodeFailure = func(err error) Response[FlashcardV2SummariesData] {
		return Failure[FlashcardV2SummariesData](-1, "invalid flashcard request: "+err.Error())
	}
	UndoFlashcardReview.decodeRequest = decodeFlashcardV2Request[FlashcardV2ReviewUndoRequest]
	UndoFlashcardReview.decodeFailure = func(err error) Response[FlashcardV2ReviewUndoResult] {
		return Failure[FlashcardV2ReviewUndoResult](-1, "invalid flashcard request: "+err.Error())
	}
	UpdateAdvancedFlashcardSource.decodeRequest = decodeFlashcardV2Request[FlashcardV2AdvancedSourceUpdateRequest]
	UpdateAdvancedFlashcardSource.decodeFailure = func(err error) Response[FlashcardV2AdvancedSourceResult] {
		return Failure[FlashcardV2AdvancedSourceResult](-1, "invalid flashcard request: "+err.Error())
	}
	UpdateBasicFlashcardDirection.decodeRequest = decodeFlashcardV2Request[FlashcardV2BasicDirectionRequest]
	UpdateBasicFlashcardDirection.decodeFailure = func(err error) Response[FlashcardV2BasicSourceResult] {
		return Failure[FlashcardV2BasicSourceResult](-1, "invalid flashcard request: "+err.Error())
	}
	UpdateFlashcardSessionCard.decodeRequest = decodeFlashcardV2Request[FlashcardV2SessionCardUpdateRequest]
	UpdateFlashcardSessionCard.decodeFailure = func(err error) Response[FlashcardV2SessionCard] {
		return Failure[FlashcardV2SessionCard](-1, "invalid flashcard request: "+err.Error())
	}
	GetFlashcardSourceHistory.decodeRequest = func(reader io.Reader) (request FlashcardV2SourceHistoryRequest, err error) {
		request.Limit = 50
		err = json.NewDecoder(reader).Decode(&request)
		return
	}
}

// decodeFlashcardV2Request 沿用结构体 JSON 绑定，保留缺省值、大小写和原有解析错误。
func decodeFlashcardV2Request[Request any](reader io.Reader) (request Request, err error) {
	err = json.NewDecoder(reader).Decode(&request)
	return
}
