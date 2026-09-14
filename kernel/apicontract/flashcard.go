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
