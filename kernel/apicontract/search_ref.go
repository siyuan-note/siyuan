package apicontract

import (
	"bytes"
	"encoding/json"
	"io"
	"reflect"
)

type SearchRefBlockRequest struct {
	ID               *string   `json:"id" api:"optional"`
	RootID           string    `json:"rootID" api:"optional"`
	K                string    `json:"k" api:"optional"`
	BeforeLen        float64   `json:"beforeLen" api:"optional"`
	IsSquareBrackets bool      `json:"isSquareBrackets" api:"optional,nullable"`
	IsDatabase       bool      `json:"isDatabase" api:"optional,nullable"`
	Notebook         string    `json:"notebook" api:"optional,nullable,ignoretype"`
	ReqID            JSONValue `json:"reqId" api:"optional,nullable"`
	fields           map[string]json.RawMessage
}

type SearchRefParameters struct {
	IsSquareBrackets bool    `json:"isSquareBrackets" api:"optional,nullable"`
	IsDatabase       bool    `json:"isDatabase" api:"optional,nullable"`
	RootID           string  `json:"rootID"`
	ID               string  `json:"id"`
	K                string  `json:"k"`
	BeforeLen        float64 `json:"beforeLen"`
}

func (r SearchRefBlockRequest) Keyword() (string, error) {
	return legacyField[string](r.fields, "k", "String", true)
}

// 引用搜索先检查请求标识、发布权限和笔记本租约，再校验实际使用的搜索参数。
func (r SearchRefBlockRequest) Parameters() (params SearchRefParameters, err error) {
	err = decodeRequestFields(reflect.ValueOf(&params).Elem(), r.fields)
	return
}

type SearchRefCorrelation struct {
	ReqID JSONValue `json:"reqId"`
}

type SearchRefResult struct {
	SearchRefCorrelation
	Blocks []*SearchBlock `json:"blocks"`
	NewDoc bool           `json:"newDoc"`
	K      string         `json:"k"`
}

type SearchRefData struct {
	result      *SearchRefResult
	correlation SearchRefCorrelation
}

func SearchRefEcho(reqID JSONValue) SearchRefData {
	return SearchRefData{correlation: SearchRefCorrelation{ReqID: reqID}}
}

func SearchRefBlocks(result SearchRefResult) SearchRefData { return SearchRefData{result: &result} }

func (d SearchRefData) MarshalJSON() ([]byte, error) {
	if d.result != nil {
		return json.Marshal(d.result)
	}
	return json.Marshal(d.correlation)
}

func init() {
	SearchRefBlock.decodeRequest = func(reader io.Reader) (request SearchRefBlockRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/search/searchRefBlock")
		if err != nil {
			return request, err
		}
		request.fields = fields
		if raw, exists := fields["reqId"]; exists {
			if err = json.Unmarshal(raw, &request.ReqID); err != nil {
				return request, err
			}
		}
		if raw := fields["id"]; len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return request, nil
		}
		request.ID = new(string)
		_ = json.Unmarshal(fields["notebook"], &request.Notebook)
		return request, nil
	}
}
