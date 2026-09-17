package apicontract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

type RefreshBacklinkRequest struct {
	ID string `json:"id" api:"trim"`
}

type BackmentionDocumentRequest struct {
	DefID           string `json:"defID"`
	RefTreeID       string `json:"refTreeID"`
	Keyword         string `json:"keyword"`
	KnownRevision   string `json:"knownRevision" api:"optional,nullable,ignoretype"`
	Notebook        string `json:"notebook" api:"optional"`
	ContainChildren *bool  `json:"containChildren" api:"optional"`
	Highlight       *bool  `json:"highlight" api:"optional"`
}

type BacklinkAttributeViewMatch struct {
	ItemID  string   `json:"itemID"`
	KeyID   string   `json:"keyID"`
	ValueID string   `json:"valueID"`
	Title   string   `json:"title"`
	KeyName string   `json:"keyName"`
	DefIDs  []string `json:"defIDs"`
}

type BacklinkDocumentRequest struct {
	BackmentionDocumentRequest
	SourceFilter *BacklinkSourceFilter `json:"sourceFilter" api:"optional"`
	BlockSort    int                   `json:"blockSort" api:"optional"` // 0 正文顺序，1 锚文本自然升序，2 锚文本自然降序
}

type BacklinkSourceFilter struct {
	DailyNote           string   `json:"dailyNote" api:"optional,nullable,ignoretype"`
	ExcludeSelf         bool     `json:"excludeSelf" api:"optional,nullable"`
	ExcludedRefDefIDs   []string `json:"excludedRefDefIDs" api:"optional,nullable,filterstrings"`
	ExcludedNotebookIDs []string `json:"excludedNotebookIDs" api:"optional,nullable,filterstrings"`
}

type BacklinkAttributeViewTarget struct {
	BlockID string                        `json:"blockID"`
	Matches []*BacklinkAttributeViewMatch `json:"matches"`
}

type BacklinkContext struct {
	Type                 string                         `json:"type,omitempty"`
	ReferenceBlockID     string                         `json:"referenceBlockID,omitempty"`
	AttributeViewTargets []*BacklinkAttributeViewTarget `json:"attributeViewTargets,omitempty"`
	ID                   string                         `json:"id"`
	DOM                  string                         `json:"dom"`
	BlockPaths           []*BlockPath                   `json:"blockPaths"`
	Expand               bool                           `json:"expand"`
	Revision             string                         `json:"revision"`
}

type BacklinkContextData struct {
	Unchanged    bool               `json:"unchanged"`
	Revision     string             `json:"revision"`
	Backlinks    []*BacklinkContext `json:"backlinks"`
	Backmentions []*BacklinkContext `json:"backmentions"`
	Keywords     []string           `json:"keywords"`
}

func init() {
	GetBacklinkDoc.decodeRequest = func(reader io.Reader) (request BacklinkDocumentRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/ref/getBacklinkDoc")
		if err != nil {
			return request, err
		}
		data, err := json.Marshal(fields)
		if err != nil {
			return request, err
		}
		request.BackmentionDocumentRequest, err = GetBackmentionDoc.Decode(bytes.NewReader(data))
		if err != nil {
			return request, err
		}
		request.SourceFilter = decodeBacklinkSourceFilter(fields["sourceFilter"])
		if raw, exists := fields["blockSort"]; exists {
			if err = json.Unmarshal(raw, &request.BlockSort); err != nil || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
				return request, fmt.Errorf("invalid blockSort: expected integer")
			}
		}
		return request, nil
	}
	GetBackmentionDoc.decodeRequest = func(reader io.Reader) (request BackmentionDocumentRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/ref/getBackmentionDoc")
		if err != nil {
			return request, err
		}
		if request.DefID, err = legacyField[string](fields, "defID", "String", true); err != nil {
			return request, err
		}
		if request.RefTreeID, err = legacyField[string](fields, "refTreeID", "String", true); err != nil {
			return request, err
		}
		if request.Keyword, err = legacyField[string](fields, "keyword", "String", true); err != nil {
			return request, err
		}
		_ = json.Unmarshal(fields["knownRevision"], &request.KnownRevision)
		if _, exists := fields["notebook"]; exists {
			if request.Notebook, err = legacyField[string](fields, "notebook", "String", true); err != nil {
				return request, err
			}
		}
		for _, field := range []struct {
			name   string
			target **bool
		}{{"containChildren", &request.ContainChildren}, {"highlight", &request.Highlight}} {
			if _, exists := fields[field.name]; exists {
				value, decodeErr := legacyField[bool](fields, field.name, "Bool", true)
				if decodeErr != nil {
					return request, decodeErr
				}
				*field.target = &value
			}
		}
		return request, nil
	}
}

func decodeBacklinkSourceFilter(raw json.RawMessage) *BacklinkSourceFilter {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return nil
	}
	filter := &BacklinkSourceFilter{}
	_ = json.Unmarshal(fields["dailyNote"], &filter.DailyNote)
	_ = json.Unmarshal(fields["excludeSelf"], &filter.ExcludeSelf)
	for _, field := range []struct {
		name   string
		target *[]string
	}{{"excludedRefDefIDs", &filter.ExcludedRefDefIDs}, {"excludedNotebookIDs", &filter.ExcludedNotebookIDs}} {
		var values []json.RawMessage
		if json.Unmarshal(fields[field.name], &values) != nil {
			continue
		}
		for _, value := range values {
			var id string
			if len(value) > 0 && value[0] == '"' && json.Unmarshal(value, &id) == nil {
				*field.target = append(*field.target, id)
			}
		}
	}
	return filter
}
