package apicontract

import (
	"encoding/json"
	"io"
)

// QueryFlashcardsRequest 查询管理列表。query 省略或为 null 时匹配全部卡片，版本目前为 1。
// editLater 字段仅支持 equal、notEqual 与布尔值，用于筛选待编辑卡片；管理查询允许查看这些卡片。
// 复习入口始终排除待编辑卡片，完成编辑只清除待办，不会自动解除暂停、埋藏或修改到期时间。
// 保留结构体 JSON 绑定的未知字段、大小写、空值和默认值兼容行为。
type QueryFlashcardsRequest struct {
	Query   *FlashcardQuery        `json:"query,omitempty" api:"optional,nullable"`
	Options FlashcardSearchOptions `json:"options" api:"optional,nullable"`
}

type FlashcardQuery struct {
	Version int                      `json:"version"`
	Root    FlashcardQueryExpression `json:"root"`
}

// FlashcardQueryExpression 的 value 是由字段和比较运算约束的 JSON 值，可为标量或数组。
// and、or 使用 children；not 仅含一个子节点；matchAll 不带字段或值；predicate 使用字段比较。
type FlashcardQueryExpression struct {
	Operator   string                     `json:"operator"`
	Children   []FlashcardQueryExpression `json:"children,omitempty" api:"optional,nullable"`
	Field      string                     `json:"field,omitempty" api:"optional,nullable"`
	Comparator string                     `json:"comparator,omitempty" api:"optional,nullable"`
	Value      *JSONValue                 `json:"value,omitempty" api:"optional,nullable"`
}

// FlashcardQueryExpressionFields 明确声明自定义解码器的字段形状，解码只保留 value 的原始数值。
type FlashcardQueryExpressionFields FlashcardQueryExpression

// UnmarshalJSON 保留查询值的数字精度，以及未提供值和显式 null 的区别。
func (expression *FlashcardQueryExpression) UnmarshalJSON(data []byte) error {
	type plain FlashcardQueryExpression
	decoded := struct {
		*plain
		Value json.RawMessage `json:"value"`
	}{plain: (*plain)(expression)}
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	if len(decoded.Value) > 0 {
		value, err := EncodedJSONValue(decoded.Value)
		if err != nil {
			return err
		}
		expression.Value = &value
	}
	return nil
}

// FlashcardSearchOptions 的开关默认均为 false，now 为毫秒时间戳，limit 为 0 时最多返回一百万张。
// limit 与 offset 必须非负；groupBySource 按卡源分页并返回整组卡片，未分组时按卡片分页。
type FlashcardSearchOptions struct {
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

// FlashcardCard 的 editLater 省略时表示没有编辑待办；variantData 是由卡片类型定义的 JSON 数据。
type FlashcardCard struct {
	ID               string              `json:"id"`
	SourceID         string              `json:"sourceID"`
	TemplateID       string              `json:"templateID"`
	VariantKey       string              `json:"variantKey"`
	VariantData      *JSONValue          `json:"variantData,omitempty"`
	GenerationStatus string              `json:"generationStatus"`
	Flag             int                 `json:"flag"`
	PresetOverrideID string              `json:"presetOverrideID,omitempty"`
	PriorityOverride string              `json:"priorityOverride,omitempty"`
	EditLater        *FlashcardEditLater `json:"editLater,omitempty"`
	CreatedAt        int64               `json:"createdAt"`
	UpdatedAt        int64               `json:"updatedAt"`
}

type FlashcardReviewState struct {
	CardID          string  `json:"cardID"`
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

type FlashcardSearchResult struct {
	Card              FlashcardCard        `json:"card"`
	ReviewState       FlashcardReviewState `json:"reviewState"`
	SourceType        string               `json:"sourceType"`
	SourceStatus      string               `json:"sourceStatus"`
	SourcePriority    string               `json:"sourcePriority"`
	InheritedPriority string               `json:"inheritedPriority"`
	DefaultPresetID   string               `json:"defaultPresetID"`
	CardTagIDs        []string             `json:"cardTagIDs"`
	SourceTagIDs      []string             `json:"sourceTagIDs"`
	EffectiveTagIDs   []string             `json:"effectiveTagIDs"`
	EffectivePriority string               `json:"effectivePriority"`
	EffectivePresetID string               `json:"effectivePresetID"`
	SourceNotebookID  string               `json:"sourceNotebookID,omitempty"`
	SourceRootID      string               `json:"sourceRootID,omitempty"`
	SourcePath        string               `json:"sourcePath,omitempty"`
	SourceAvailable   bool                 `json:"sourceAvailable"`
	SourceBlockID     string               `json:"sourceBlockID,omitempty"`
	SourceTitle       string               `json:"sourceTitle,omitempty"`
}

type QueryFlashcardsData struct {
	Cards []FlashcardSearchResult `json:"cards" api:"nonnullable"`
}

func init() {
	QueryFlashcards.decodeRequest = func(reader io.Reader) (request QueryFlashcardsRequest, err error) {
		err = json.NewDecoder(reader).Decode(&request)
		return
	}
	QueryFlashcards.decodeFailure = func(err error) Response[QueryFlashcardsData] {
		return Failure[QueryFlashcardsData](-1, "invalid flashcard request: "+err.Error())
	}
}
