package apicontract

import (
	"bytes"
	"encoding/json"
	"io"
)

type OutlineRequest struct {
	ID       *string `json:"id" api:"optional"`
	Preview  bool    `json:"preview" api:"optional,nullable"`
	Notebook string  `json:"notebook" api:"optional,nullable,ignoretype"`
}

type HeadingNumbersRequest struct {
	ID       *string `json:"id" api:"optional"`
	Notebook string  `json:"notebook" api:"optional,nullable,ignoretype"`
}

type SearchPath struct {
	ID         string         `json:"id"`
	Box        string         `json:"box"`
	Name       string         `json:"name"`
	NameIsHTML bool           `json:"nameIsHTML,omitempty"`
	Number     string         `json:"number,omitempty"`
	HPath      string         `json:"hPath"`
	Type       string         `json:"type"`
	NodeType   string         `json:"nodeType"`
	SubType    string         `json:"subType"`
	Blocks     []*SearchBlock `json:"blocks,omitempty"`
	Children   []*SearchPath  `json:"children,omitempty"`
	Depth      int            `json:"depth"`
	Count      int            `json:"count"`
	Folded     bool           `json:"folded"`
	Updated    string         `json:"updated"`
	Created    string         `json:"created"`
}

func init() {
	plain := GetDocOutline
	GetDocOutline.decodeRequest = func(reader io.Reader) (request OutlineRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/outline/getDocOutline")
		if err != nil {
			return request, err
		}
		if raw := fields["id"]; len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
			return request, nil
		}
		data, err := json.Marshal(fields)
		if err != nil {
			return request, err
		}
		return plain.Decode(bytes.NewReader(data))
	}
	GetDocHeadingNumbers.decodeRequest = func(reader io.Reader) (request HeadingNumbersRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/outline/getDocHeadingNumbers")
		if err != nil {
			return request, err
		}
		var id string
		if raw := fields["id"]; len(raw) == 0 || bytes.Equal(raw, []byte("null")) || json.Unmarshal(raw, &id) != nil {
			return request, nil
		}
		request.ID = &id
		_ = json.Unmarshal(fields["notebook"], &request.Notebook)
		return
	}
}
