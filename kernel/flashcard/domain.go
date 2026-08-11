// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package flashcard

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

const (
	// FormatVersion 是闪卡权威记录的主格式版本。
	FormatVersion = 2

	// ProjectionSchemaVersion 是本地 SQLite 投影的结构版本。
	ProjectionSchemaVersion = 5

	// SchedulerVersionFSRS6 标识当前确定性 FSRS 状态转换实现。
	SchedulerVersionFSRS6 = "go-fsrs-v3.3.1-fsrs6"
)

// EntityType 标识一种可版本化闪卡实体。
type EntityType string

const (
	EntityCardSchema          EntityType = "cardSchema"
	EntityCardTemplate        EntityType = "cardTemplate"
	EntityCardSource          EntityType = "cardSource"
	EntityCardSourceRef       EntityType = "cardSourceRef"
	EntityCard                EntityType = "card"
	EntityReviewState         EntityType = "reviewState"
	EntityReviewSet           EntityType = "reviewSet"
	EntityReviewSetMembership EntityType = "reviewSetMembership"
	EntitySchedulerPreset     EntityType = "schedulerPreset"
	EntityFlagDefinition      EntityType = "flagDefinition"
	EntityTag                 EntityType = "tag"
	EntityTagAssignment       EntityType = "tagAssignment"
	EntityStudyPolicy         EntityType = "studyPolicy"
	EntityStudySession        EntityType = "studySession"
	EntitySessionCard         EntityType = "sessionCard"
	EntityLegacyCardAlias     EntityType = "legacyCardAlias"
)

// RecordKind 标识操作批次中的记录类型。
type RecordKind string

const (
	RecordEntityRevision RecordKind = "entityRevision"
	RecordEvent          RecordKind = "event"
)

const (
	EventReview                 = "review"
	EventReviewUndone           = "reviewUndone"
	EventCardStateChanged       = "cardStateChanged"
	EventReviewConflictResolved = "reviewConflictResolved"
	EventMigrationPrepared      = "migrationPrepared"
	EventMigrationActivated     = "migrationActivated"
	EventLegacyDiverged         = "legacyDiverged"
	EventTagAssignmentsChanged  = "tagAssignmentsChanged"
	EventAnkiImportStarted      = "ankiImportStarted"
)

// GenerationStatus 描述生成卡片是否进入正常队列。
type GenerationStatus string

const (
	GenerationActive             GenerationStatus = "active"
	GenerationDisabledByTemplate GenerationStatus = "disabledByTemplate"
	GenerationOrphaned           GenerationStatus = "orphaned"
	GenerationDeleted            GenerationStatus = "deleted"
)

// MembershipMode 描述复习集中的手动成员关系。
type MembershipMode string

const (
	MembershipInclude MembershipMode = "include"
	MembershipExclude MembershipMode = "exclude"
	// MembershipAutomatic 仅用于成员设置请求，表示清除手动覆盖，不会保存到成员实体中。
	MembershipAutomatic MembershipMode = "automatic"
)

// CardSchema 定义卡源字段和可用模板。
type CardSchema struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	BuiltinType string            `json:"builtinType,omitempty"`
	Fields      []CardSchemaField `json:"fields"`
	TemplateIDs []string          `json:"templateIDs"`
	CreatedAt   int64             `json:"createdAt"`
	UpdatedAt   int64             `json:"updatedAt"`
}

// CardSchemaField 定义一个稳定的卡源字段。
type CardSchemaField struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Required bool   `json:"required"`
	Sort     int    `json:"sort"`
}

// CardTemplate 定义卡片生成与渲染方式。
type CardTemplate struct {
	ID             string          `json:"id"`
	SchemaID       string          `json:"schemaID"`
	Name           string          `json:"name"`
	GenerationRule json.RawMessage `json:"generationRule"`
	FrontSpec      json.RawMessage `json:"frontSpec"`
	BackSpec       json.RawMessage `json:"backSpec"`
	AnswerMode     string          `json:"answerMode"`
	ContextPolicy  json.RawMessage `json:"contextPolicy,omitempty"`
	Style          string          `json:"style,omitempty"`
	Enabled        bool            `json:"enabled"`
}

// CardSource 描述一份可以生成多张卡片的知识实体。
type CardSource struct {
	ID                  string          `json:"id"`
	SchemaID            string          `json:"schemaID"`
	SourceType          string          `json:"sourceType"`
	PrimaryRefID        string          `json:"primaryRefID"`
	DefaultPresetID     string          `json:"defaultPresetID,omitempty"`
	Priority            string          `json:"priority,omitempty"`
	GenerationConfig    json.RawMessage `json:"generationConfig"`
	Status              string          `json:"status"`
	PluginNamespace     string          `json:"pluginNamespace,omitempty"`
	PluginDataVersion   int             `json:"pluginDataVersion,omitempty"`
	PluginData          json.RawMessage `json:"pluginData,omitempty"`
	DisabledTemplateIDs []string        `json:"disabledTemplateIDs,omitempty"`
}

// CardSourceRef 描述卡源对内容实体的有序字段引用。
type CardSourceRef struct {
	ID         string `json:"id"`
	SourceID   string `json:"sourceID"`
	FieldID    string `json:"fieldID,omitempty"`
	EntityType string `json:"entityType"`
	EntityID   string `json:"entityID"`
	Role       string `json:"role"`
	Sort       int    `json:"sort"`
	Required   bool   `json:"required"`
}

// Card 描述参与排期的最小单位。
type Card struct {
	ID               string           `json:"id"`
	SourceID         string           `json:"sourceID"`
	TemplateID       string           `json:"templateID"`
	VariantKey       string           `json:"variantKey"`
	VariantData      json.RawMessage  `json:"variantData,omitempty"`
	GenerationStatus GenerationStatus `json:"generationStatus"`
	Flag             int              `json:"flag"`
	PresetOverrideID string           `json:"presetOverrideID,omitempty"`
	PriorityOverride string           `json:"priorityOverride,omitempty"`
	CreatedAt        int64            `json:"createdAt"`
	UpdatedAt        int64            `json:"updatedAt"`
}

// ReviewStateSnapshot 保存一张卡在某个时刻的完整 FSRS 状态。
type ReviewStateSnapshot struct {
	State           string  `json:"state"`
	Due             int64   `json:"due"`
	LastReview      int64   `json:"lastReview,omitempty"`
	Stability       float64 `json:"stability"`
	Difficulty      float64 `json:"difficulty"`
	ElapsedDays     uint64  `json:"elapsedDays"`
	ScheduledDays   uint64  `json:"scheduledDays"`
	Reps            uint64  `json:"reps"`
	Lapses          uint64  `json:"lapses"`
	Suspended       bool    `json:"suspended"`
	BuriedUntil     int64   `json:"buriedUntil,omitempty"`
	BuriedReason    string  `json:"buriedReason,omitempty"`
	StateRevisionID string  `json:"stateRevisionID"`
}

// ReviewState 保存一张卡当前可变的排期状态。
type ReviewState struct {
	CardID string `json:"cardID"`
	ReviewStateSnapshot
}

// ReviewRating 是用户对一次正常复习的最终评分。
type ReviewRating string

const (
	ReviewAgain ReviewRating = "again"
	ReviewHard  ReviewRating = "hard"
	ReviewGood  ReviewRating = "good"
	ReviewEasy  ReviewRating = "easy"
)

// ReviewEventPayload 保存一次复习所需的完整审计和重放数据。
type ReviewEventPayload struct {
	CardID              string               `json:"cardID"`
	SourceID            string               `json:"sourceID"`
	OriginCardID        string               `json:"originCardID,omitempty"`
	Kind                string               `json:"kind"`
	Rating              ReviewRating         `json:"rating,omitempty"`
	ReviewedAt          int64                `json:"reviewedAt"`
	DurationMS          *int64               `json:"durationMS,omitempty"`
	BaseStateRevisionID string               `json:"baseStateRevisionID"`
	BeforeState         *ReviewStateSnapshot `json:"beforeState,omitempty"`
	AfterState          *ReviewStateSnapshot `json:"afterState,omitempty"`
	SchedulerVersion    string               `json:"schedulerVersion"`
	PresetRevisionID    string               `json:"presetRevisionID"`
	SchedulerInput      json.RawMessage      `json:"schedulerInput"`
	SessionID           string               `json:"sessionID,omitempty"`
	ReviewSetID         string               `json:"reviewSetID,omitempty"`
	ReviewMode          string               `json:"reviewMode"`
	AnswerResult        json.RawMessage      `json:"answerResult,omitempty"`
}

// ReviewUndoneEventPayload 保存一次复习撤销的目标和补偿修订，原始复习事件始终保留。
type ReviewUndoneEventPayload struct {
	ReviewEventID       string   `json:"reviewEventID"`
	CardID              string   `json:"cardID"`
	UndoneAt            int64    `json:"undoneAt"`
	RevertedRevisionIDs []string `json:"revertedRevisionIDs,omitempty"`
}

// CardManagementEventPayload 保存不经过 FSRS 评分的单卡管理操作前后状态。
type CardManagementEventPayload struct {
	CardID      string               `json:"cardID"`
	Action      string               `json:"action"`
	ChangedAt   int64                `json:"changedAt"`
	Input       json.RawMessage      `json:"input"`
	BeforeCard  *Card                `json:"beforeCard,omitempty"`
	AfterCard   *Card                `json:"afterCard,omitempty"`
	BeforeState *ReviewStateSnapshot `json:"beforeState,omitempty"`
	AfterState  *ReviewStateSnapshot `json:"afterState,omitempty"`
}

// ReviewSet 描述一组动态或手动选择的卡片。
type ReviewSet struct {
	ID                string          `json:"id"`
	Name              string          `json:"name"`
	LegacyDeckID      string          `json:"legacyDeckID,omitempty"`
	QueryAST          json.RawMessage `json:"queryAST,omitempty"`
	Order             json.RawMessage `json:"order,omitempty"`
	NewLimit          int             `json:"newLimit"`
	ReviewLimit       int             `json:"reviewLimit"`
	DefaultReviewMode string          `json:"defaultReviewMode"`
}

// ReviewSetOrder 保存复习集生成会话队列时使用的稳定排序方式。
type ReviewSetOrder struct {
	Mode string `json:"mode"`
}

const (
	ReviewSetOrderPriorityDue = "priorityDue"
	ReviewSetOrderDue         = "due"
	ReviewSetOrderAdded       = "added"
	ReviewSetOrderRandom      = "random"
)

// ReviewSetMembership 描述单张卡片的手动加入或排除关系。
type ReviewSetMembership struct {
	ID          string         `json:"id"`
	ReviewSetID string         `json:"reviewSetID"`
	CardID      string         `json:"cardID"`
	Mode        MembershipMode `json:"mode"`
}

// Tag 保存独立于内容标签的闪卡标签树节点。
type Tag struct {
	ID             string `json:"id"`
	ParentID       string `json:"parentID,omitempty"`
	Name           string `json:"name"`
	NormalizedName string `json:"normalizedName"`
}

// FlagDefinition 保存固定颜色旗标的工作区显示名称。
type FlagDefinition struct {
	ID   string `json:"id"`
	Flag int    `json:"flag"`
	Name string `json:"name"`
}

// FlagDefinitionID 返回一个旗标编号对应的稳定实体 ID。
func FlagDefinitionID(flag int) string {
	return fmt.Sprintf("flag-definition-%d", flag)
}

// TagAssignment 保存标签对卡源或单张卡片的独立分配。
type TagAssignment struct {
	ID         string `json:"id"`
	TagID      string `json:"tagID"`
	TargetType string `json:"targetType"`
	TargetID   string `json:"targetID"`
}

// TagAssignmentsChangedEventPayload 保存一次批量标签替换的目标和最终标签集合。
type TagAssignmentsChangedEventPayload struct {
	TargetType string   `json:"targetType"`
	TargetIDs  []string `json:"targetIDs"`
	TagIDs     []string `json:"tagIDs"`
	ChangedAt  int64    `json:"changedAt"`
}

// SchedulerPreset 保存 FSRS 参数和队列规则。
type SchedulerPreset struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	SchedulerVersion   string    `json:"schedulerVersion"`
	RequestRetention   float64   `json:"requestRetention"`
	MaximumInterval    int       `json:"maximumInterval"`
	Weights            []float64 `json:"weights"`
	NewLimit           int       `json:"newLimit"`
	ReviewLimit        int       `json:"reviewLimit"`
	BuryNewSiblings    bool      `json:"buryNewSiblings"`
	BuryReviewSiblings bool      `json:"buryReviewSiblings"`
	LeechThreshold     int       `json:"leechThreshold"`
	LeechAction        string    `json:"leechAction"`
}

// StudyPolicy 保存文档或笔记本范围内的学习优先级与暂停策略。
type StudyPolicy struct {
	ID         string `json:"id"`
	ScopeType  string `json:"scopeType"`
	ScopeID    string `json:"scopeID"`
	Priority   string `json:"priority"`
	TargetDate *int64 `json:"targetDate,omitempty"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
}

// StudySession 保存一次连续复习过程的稳定参数和生命周期。
type StudySession struct {
	ID               string          `json:"id"`
	ReviewSetID      string          `json:"reviewSetID,omitempty"`
	QueryAST         json.RawMessage `json:"queryAST,omitempty"`
	ReviewMode       string          `json:"reviewMode"`
	Status           string          `json:"status"`
	Seed             string          `json:"seed"`
	NewLimit         int             `json:"newLimit"`
	ReviewLimit      int             `json:"reviewLimit"`
	IncludeSuspended bool            `json:"includeSuspended"`
	IncludeBuried    bool            `json:"includeBuried"`
	IncludePaused    bool            `json:"includePaused"`
	SelectionDigest  string          `json:"selectionDigest"`
	StartedAt        int64           `json:"startedAt"`
	EndedAt          *int64          `json:"endedAt,omitempty"`
}

// SessionCard 保存会话内卡片顺序、跳过状态和确定性选项顺序。
type SessionCard struct {
	ID             string                `json:"id"`
	SessionID      string                `json:"sessionID"`
	CardID         string                `json:"cardID"`
	Sort           int                   `json:"sort"`
	Status         string                `json:"status"`
	SkipReason     string                `json:"skipReason,omitempty"`
	OptionOrder    []string              `json:"optionOrder,omitempty"`
	DynamicOptions []SessionChoiceOption `json:"dynamicOptions,omitempty"`
	StepResults    json.RawMessage       `json:"stepResults,omitempty"`
}

// SessionChoiceOption 固化动态干扰项身份与内容引用，保证会话重放一致。
type SessionChoiceOption struct {
	ID         string `json:"id"`
	EntityType string `json:"entityType"`
	EntityID   string `json:"entityID"`
}

// LegacyCardAlias 保存旧卡片到统一卡片的可审计映射和迁移前状态。
type LegacyCardAlias struct {
	ID           string               `json:"id"`
	LegacyDeckID string               `json:"legacyDeckID"`
	LegacyCardID string               `json:"legacyCardID"`
	BlockID      string               `json:"blockID"`
	CardID       string               `json:"cardID"`
	Selected     bool                 `json:"selected"`
	HistoryOnly  bool                 `json:"historyOnly,omitempty"`
	State        *ReviewStateSnapshot `json:"state,omitempty"`
}

// EntityRevision 保存实体的一次不可变修订。
type EntityRevision struct {
	EntityType        EntityType      `json:"entityType"`
	EntityID          string          `json:"entityID"`
	RevisionID        string          `json:"revisionID"`
	ParentRevisionIDs []string        `json:"parentRevisionIDs,omitempty"`
	UpdatedAt         int64           `json:"updatedAt"`
	Deleted           bool            `json:"deleted"`
	Payload           json.RawMessage `json:"payload"`
}

// Event 保存不可变复习事件或领域事件。
type Event struct {
	EventType  string          `json:"eventType"`
	EventID    string          `json:"eventID"`
	EntityID   string          `json:"entityID,omitempty"`
	OccurredAt int64           `json:"occurredAt"`
	Payload    json.RawMessage `json:"payload"`
}

// Change 是操作批次中的一个有序记录。
type Change struct {
	Kind     RecordKind      `json:"kind"`
	Revision *EntityRevision `json:"revision,omitempty"`
	Event    *Event          `json:"event,omitempty"`
}

var deterministicIDNamespace = uuid.MustParse("61cb11fd-bf3c-54b7-8574-06a8167cf3ea")

// NewID 生成全局唯一标识符。
func NewID() string {
	return uuid.NewString()
}

// DeterministicID 根据命名空间和带长度前缀的字段生成稳定 ID。
func DeterministicID(namespace string, parts ...string) string {
	var data bytes.Buffer
	writeIDPart(&data, namespace)
	for _, part := range parts {
		writeIDPart(&data, part)
	}
	return uuid.NewSHA1(deterministicIDNamespace, data.Bytes()).String()
}

func writeIDPart(buf *bytes.Buffer, value string) {
	_ = binary.Write(buf, binary.BigEndian, uint64(len(value)))
	_, _ = buf.WriteString(value)
}

// NewEntityRevision 创建经过规范化的实体修订。
func NewEntityRevision(entityType EntityType, entityID string, parents []string, updatedAt int64, deleted bool,
	payload any) (EntityRevision, error) {
	canonicalPayload, err := CanonicalJSON(payload)
	if err != nil {
		return EntityRevision{}, fmt.Errorf("canonicalize entity payload: %w", err)
	}
	revision := EntityRevision{
		EntityType:        entityType,
		EntityID:          entityID,
		RevisionID:        NewID(),
		ParentRevisionIDs: append([]string(nil), parents...),
		UpdatedAt:         updatedAt,
		Deleted:           deleted,
		Payload:           canonicalPayload,
	}
	if err = revision.Validate(); err != nil {
		return EntityRevision{}, err
	}
	return revision, nil
}

// Validate 校验实体修订的结构约束。
func (revision *EntityRevision) Validate() error {
	if revision == nil {
		return errors.New("entity revision is nil")
	}
	if strings.TrimSpace(string(revision.EntityType)) == "" {
		return errors.New("entity type is required")
	}
	if strings.TrimSpace(revision.EntityID) == "" {
		return errors.New("entity ID is required")
	}
	if strings.TrimSpace(revision.RevisionID) == "" {
		return errors.New("revision ID is required")
	}
	if revision.UpdatedAt < 0 {
		return errors.New("updated time must not be negative")
	}
	parents := make(map[string]struct{}, len(revision.ParentRevisionIDs))
	for _, parent := range revision.ParentRevisionIDs {
		if strings.TrimSpace(parent) == "" {
			return errors.New("parent revision ID is required")
		}
		if parent == revision.RevisionID {
			return errors.New("revision cannot be its own parent")
		}
		if _, ok := parents[parent]; ok {
			return fmt.Errorf("duplicate parent revision [%s]", parent)
		}
		parents[parent] = struct{}{}
	}
	if len(revision.Payload) == 0 || !json.Valid(revision.Payload) {
		return errors.New("entity payload must be valid JSON")
	}
	return validateEntityPayload(revision)
}

// Validate 校验事件的结构约束。
func (event *Event) Validate() error {
	if event == nil {
		return errors.New("event is nil")
	}
	if strings.TrimSpace(event.EventType) == "" {
		return errors.New("event type is required")
	}
	if strings.TrimSpace(event.EventID) == "" {
		return errors.New("event ID is required")
	}
	if event.OccurredAt < 0 {
		return errors.New("event time must not be negative")
	}
	if len(event.Payload) == 0 || !json.Valid(event.Payload) {
		return errors.New("event payload must be valid JSON")
	}
	canonical, err := canonicalRawMessage(event.Payload)
	if err != nil {
		return fmt.Errorf("canonicalize event payload: %w", err)
	}
	if !bytes.Equal(canonical, event.Payload) {
		return errors.New("event payload is not canonical JSON")
	}
	if event.EventType == EventReview {
		return validateReviewEvent(event)
	}
	if event.EventType == EventReviewUndone {
		return validateReviewUndoneEvent(event)
	}
	return nil
}

// Validate 校验记录类型和载荷是否一一对应。
func (change *Change) Validate() error {
	if change == nil {
		return errors.New("change is nil")
	}
	switch change.Kind {
	case RecordEntityRevision:
		if change.Event != nil {
			return errors.New("entity revision change must not contain an event")
		}
		return change.Revision.Validate()
	case RecordEvent:
		if change.Revision != nil {
			return errors.New("event change must not contain an entity revision")
		}
		return change.Event.Validate()
	default:
		return fmt.Errorf("unsupported record kind [%s]", change.Kind)
	}
}
