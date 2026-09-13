package apicontract

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type BlockTransaction struct {
	Timestamp             int64             `json:"timestamp"`
	DoOperations          []*BlockOperation `json:"doOperations"`
	UndoOperations        []*BlockOperation `json:"undoOperations"`
	TemplateDocTreePlanID string            `json:"templateDocTreePlanID,omitempty"`
}

type HeadingFoldRequest struct {
	ID    string `json:"id"`
	Scope string `json:"scope"`
}

type BlockDeleteData struct {
	CreateEmptyParagraph bool `json:"createEmptyParagraph"`
}

// BlockOperationData 区分块内容文本和删除文档内容时的空段落选项。
type BlockOperationData struct {
	text          *string
	deleteOptions *BlockDeleteData
}

func (d BlockOperationData) MarshalJSON() ([]byte, error) {
	if d.text != nil {
		return json.Marshal(*d.text)
	}
	return json.Marshal(d.deleteOptions)
}

func (d *BlockOperationData) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	*d = BlockOperationData{}
	if bytes.Equal(data, []byte("null")) {
		return nil
	}
	if len(data) > 0 && data[0] == '"' {
		return json.Unmarshal(data, &d.text)
	}
	var options struct {
		CreateEmptyParagraph *bool `json:"createEmptyParagraph"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&options); err != nil {
		return err
	}
	if options.CreateEmptyParagraph == nil {
		return fmt.Errorf("createEmptyParagraph must be a boolean")
	}
	d.deleteOptions = &BlockDeleteData{CreateEmptyParagraph: *options.CreateEmptyParagraph}
	return nil
}

// BlockOperationResult 保留块操作返回的文本、块 ID 数组和空值三种载荷。
type BlockOperationResult struct {
	text *string
	ids  []string
}

func (r BlockOperationResult) MarshalJSON() ([]byte, error) {
	if r.text != nil {
		return json.Marshal(*r.text)
	}
	return json.Marshal(r.ids)
}

func (r *BlockOperationResult) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	*r = BlockOperationResult{}
	if bytes.Equal(data, []byte("null")) {
		return nil
	}
	if len(data) > 0 && data[0] == '"' {
		return json.Unmarshal(data, &r.text)
	}
	var values []json.RawMessage
	if len(data) == 0 || data[0] != '[' {
		return fmt.Errorf("block operation result must be text, block IDs or null")
	}
	if err := json.Unmarshal(data, &values); err != nil {
		return err
	}
	r.ids = make([]string, len(values))
	for i, value := range values {
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("block ID must be text")
		}
		if err := json.Unmarshal(value, &r.ids[i]); err != nil {
			return err
		}
	}
	return nil
}

type BlockOperation struct {
	Action            string               `json:"action" api:"enum=delete|insert|update|foldHeading|unfoldHeading|setAttrs|moveOutlineHeading|appendInsert|prependInsert"`
	Data              BlockOperationData   `json:"data"`
	ID                string               `json:"id"`
	RootID            string               `json:"rootID"`
	ParentID          string               `json:"parentID"`
	PreviousID        string               `json:"previousID"`
	NextID            string               `json:"nextID"`
	RetData           BlockOperationResult `json:"retData"`
	BlockIDs          []string             `json:"blockIDs"`
	BlockID           string               `json:"blockID"`
	DeckID            string               `json:"deckID"`
	AvID              string               `json:"avID"`
	SrcIDs            []string             `json:"srcIDs"`
	Srcs              Null                 `json:"srcs"`
	IsDetached        bool                 `json:"isDetached"`
	Name              string               `json:"name"`
	Typ               string               `json:"type" api:"const=\"\""`
	Format            string               `json:"format"`
	KeyID             string               `json:"keyID"`
	RowID             string               `json:"rowID"`
	IsTwoWay          bool                 `json:"isTwoWay"`
	BackRelationKeyID string               `json:"backRelationKeyID"`
	RemoveDest        bool                 `json:"removeDest"`
	Layout            string               `json:"layout"`
	GroupID           string               `json:"groupID"`
	TargetGroupID     string               `json:"targetGroupID"`
	ViewID            string               `json:"viewID"`
	ViewIDs           []string             `json:"viewIDs,omitempty"`
	IgnoreDefaultFill bool                 `json:"ignoreDefaultFill"`
	Context           map[string]string    `json:"context"`
}
