package apicontract

import (
	"encoding/json"
	"io"
)

type CreateQuickFlashcardSourcesRequest struct {
	OperationID     string   `json:"operationID"`
	BlockIDs        []string `json:"blockIDs"`
	CreatedAt       int64    `json:"createdAt"`
	Toggle          bool     `json:"toggle,omitempty" api:"optional,nullable"`
	DefaultPresetID string   `json:"defaultPresetID,omitempty" api:"optional,nullable"`
}

type QuickFlashcardSourcesData struct {
	SourceIDs []string `json:"sourceIDs" api:"nonnullable"`
	CardIDs   []string `json:"cardIDs" api:"nonnullable"`
	Action    string   `json:"action" api:"enum=created|removed"`
}

// SetFlashcardEditLaterRequest 设置或完成单张卡片的编辑待办。
// enabled 为 true 时仅该卡片退出正式复习和强化练习，note 可留空，最多 4000 个 Unicode 字符。
// enabled 为 false 时清除待办，此时 note 必须为空；操作不修改到期时间、FSRS、暂停、埋藏或同源卡片。
// operationID 与其余参数须原样重试；expectedRevisionID 可用于拒绝覆盖并发修改，changedAt 为毫秒时间戳。
type SetFlashcardEditLaterRequest struct {
	OperationID        string `json:"operationID"`
	CardID             string `json:"cardID"`
	Enabled            bool   `json:"enabled"`
	Note               string `json:"note,omitempty" api:"optional"`
	ChangedAt          int64  `json:"changedAt"`
	ExpectedRevisionID string `json:"expectedRevisionID,omitempty" api:"optional"`
}

// FlashcardEditLater 保存独立编辑留言，旧卡片缺少此字段时视为没有编辑待办。
type FlashcardEditLater struct {
	Note      string `json:"note"`
	UpdatedAt int64  `json:"updatedAt"`
}

// FlashcardEditLaterData 返回本次操作对应的卡片修订及待办，完成后 editLater 为 null。
type FlashcardEditLaterData struct {
	CardID     string              `json:"cardID"`
	RevisionID string              `json:"revisionID"`
	EditLater  *FlashcardEditLater `json:"editLater"`
}

func init() {
	// 保留结构体绑定的大小写、空值和解析错误语义。
	CreateQuickFlashcardSources.decodeRequest = func(reader io.Reader) (request CreateQuickFlashcardSourcesRequest, err error) {
		type QuickSourceRequest CreateQuickFlashcardSourcesRequest
		var decoded QuickSourceRequest
		err = json.NewDecoder(reader).Decode(&decoded)
		request = CreateQuickFlashcardSourcesRequest(decoded)
		return
	}
	CreateQuickFlashcardSources.decodeFailure = func(err error) Response[QuickFlashcardSourcesData] {
		return Failure[QuickFlashcardSourcesData](-1, "invalid flashcard request: "+err.Error())
	}
}
