package apicontract

import (
	"encoding/json"
	"errors"
	"io"
	"reflect"
)

// AnkiConnectRequest 接收常用制卡动作；version 省略时为 4，支持 1 到 6。
// key 使用思源 API Token，也可由 Authorization 或 token 查询参数提供。
// 接口默认关闭；显式允许本机免密时，仅可信本机客户端可独立于访问授权码制卡。
// 正文写入配置的普通笔记本，拒绝加密或关闭的笔记本；写动作遵守全局只读限制。
// 支持 version、apiReflect、multi、deckNames、deckNamesAndIds、createDeck、modelNames、modelFieldNames、
// canAddNotes、canAddNotesWithErrorDetail、addNote、addNotes、notesInfo、updateNoteFields、findNotes、storeMediaFile。
// 版本 5、6 返回 {result,error}；旧版本成功直接返回 result，失败仍返回 {result:null,error}。
// result 按动作返回数值、布尔数组、笔记信息或其他协议 JSON；不提供 AnkiWeb 同步或复习控制。
// multi、批量笔记及 notesInfo 每次最多 100 项；媒体最大 32 MiB，接受 Base64 或 HTTP URL，拒绝本机路径。
// notesInfo 对不存在的笔记返回空对象；findNotes 支持文本、字段、deck、note、tag、nid 及布尔组合。
// 模型采用内置 Basic、Basic (and reversed card)、Cloze，以及保留了模板的已导入 Anki 模型。
type AnkiConnectRequest struct {
	Action  string            `json:"action"`
	Version *int              `json:"version,omitempty" api:"optional"`
	Key     string            `json:"key,omitempty" api:"optional"`
	Params  AnkiConnectParams `json:"params" api:"optional,nullable"`
}

type AnkiConnectParams struct {
	Deck      string              `json:"deck,omitempty" api:"optional"`
	ModelName string              `json:"modelName,omitempty" api:"optional"`
	Note      *AnkiConnectNote    `json:"note,omitempty" api:"optional"`
	Notes     *AnkiConnectNotes   `json:"notes,omitempty" api:"optional"`
	Query     string              `json:"query,omitempty" api:"optional"`
	Filename  string              `json:"filename,omitempty" api:"optional"`
	Data      string              `json:"data,omitempty" api:"optional"`
	URL       string              `json:"url,omitempty" api:"optional"`
	Path      string              `json:"path,omitempty" api:"optional"`
	SkipHash  string              `json:"skipHash,omitempty" api:"optional"`
	Scopes    []string            `json:"scopes,omitempty" api:"optional"`
	Actions   *AnkiConnectActions `json:"actions,omitempty" api:"optional,nullable"`
}

type AnkiConnectNotes struct {
	Values []AnkiConnectNote `json:"-"`
	IDs    []int64           `json:"-"`
}

func (notes *AnkiConnectNotes) UnmarshalJSON(data []byte) error {
	if err := json.Unmarshal(data, &notes.IDs); err == nil {
		if len(notes.IDs) == 0 {
			notes.Values = make([]AnkiConnectNote, 0)
		}
		return nil
	}
	return json.Unmarshal(data, &notes.Values)
}

func (notes AnkiConnectNotes) MarshalJSON() ([]byte, error) {
	if notes.IDs != nil {
		return json.Marshal(notes.IDs)
	}
	return json.Marshal(notes.Values)
}

type AnkiConnectActions struct {
	Requests []AnkiConnectRequest `json:"-"`
	Names    []string             `json:"-"`
}

func (actions *AnkiConnectActions) UnmarshalJSON(data []byte) error {
	if err := json.Unmarshal(data, &actions.Names); err == nil {
		if len(actions.Names) == 0 {
			actions.Requests = make([]AnkiConnectRequest, 0)
		}
		return nil
	}
	return json.Unmarshal(data, &actions.Requests)
}

func (actions AnkiConnectActions) MarshalJSON() ([]byte, error) {
	if actions.Names != nil {
		return json.Marshal(actions.Names)
	}
	return json.Marshal(actions.Requests)
}

// notesInfo 的 notes 是数字数组，其他动作的 notes 是笔记数组；保留两种协议形状。
// schema 中通过 AnkiConnectNotes 显式声明该联合类型。
type AnkiConnectNote struct {
	ID        int64                  `json:"id,omitempty" api:"optional"`
	DeckName  string                 `json:"deckName,omitempty" api:"optional"`
	ModelName string                 `json:"modelName,omitempty" api:"optional"`
	Fields    map[string]string      `json:"fields" api:"optional"`
	Tags      []string               `json:"tags,omitempty" api:"optional"`
	Options   AnkiConnectNoteOptions `json:"options" api:"optional,nullable"`
	Audio     []AnkiConnectMedia     `json:"audio,omitempty" api:"optional"`
	Video     []AnkiConnectMedia     `json:"video,omitempty" api:"optional"`
	Picture   []AnkiConnectMedia     `json:"picture,omitempty" api:"optional"`
}

type AnkiConnectNoteOptions struct {
	AllowDuplicate        bool                             `json:"allowDuplicate" api:"optional"`
	DuplicateScope        string                           `json:"duplicateScope" api:"optional"`
	DuplicateScopeOptions AnkiConnectDuplicateScopeOptions `json:"duplicateScopeOptions" api:"optional,nullable"`
}

type AnkiConnectDuplicateScopeOptions struct {
	DeckName       string `json:"deckName" api:"optional"`
	CheckChildren  bool   `json:"checkChildren" api:"optional"`
	CheckAllModels bool   `json:"checkAllModels" api:"optional"`
}

type AnkiConnectMedia struct {
	Filename string   `json:"filename"`
	Data     string   `json:"data,omitempty" api:"optional"`
	URL      string   `json:"url,omitempty" api:"optional"`
	Path     string   `json:"path,omitempty" api:"optional"`
	SkipHash string   `json:"skipHash,omitempty" api:"optional"`
	Fields   []string `json:"fields"`
}

type AnkiConnectFieldInfo struct {
	Value string `json:"value"`
	Order int    `json:"order"`
}

type AnkiConnectNoteInfo struct {
	NoteID    int64                           `json:"noteId"`
	ModelName string                          `json:"modelName"`
	Tags      []string                        `json:"tags"`
	Fields    map[string]AnkiConnectFieldInfo `json:"fields"`
	Cards     []int64                         `json:"cards"`
}

type AnkiConnectAddDetail struct {
	CanAdd bool    `json:"canAdd"`
	Error  *string `json:"error"`
}

type AnkiConnectReflection struct {
	Scopes  []string  `json:"scopes"`
	Actions *[]string `json:"actions,omitempty"`
}

type AnkiConnectNoteInfoResult struct {
	Note *AnkiConnectNoteInfo
}

func (result AnkiConnectNoteInfoResult) MarshalJSON() ([]byte, error) {
	if result.Note == nil {
		return []byte("{}"), nil
	}
	return json.Marshal(result.Note)
}

// AnkiConnectResponse 保留旧版本直接结果、新版本信封以及 multi 的递归回复，契约限定各动作的结果形状。
type AnkiConnectResponse struct {
	encoded json.RawMessage
}

func NewAnkiConnectResponse(encoded []byte) (AnkiConnectResponse, error) {
	if !json.Valid(encoded) {
		return AnkiConnectResponse{}, errors.New("invalid AnkiConnect response")
	}
	return AnkiConnectResponse{encoded: append(json.RawMessage(nil), encoded...)}, nil
}

func (response AnkiConnectResponse) MarshalJSON() ([]byte, error) {
	return response.encoded.MarshalJSON()
}

func (b *schemaBuilder) ankiConnectResponseSchema() (*Schema, error) {
	response := &Schema{Ref: "#/$defs/AnkiConnectResponse"}
	if b.definitions["AnkiConnectResponse"] != nil {
		return response, nil
	}
	result := &Schema{AnyOf: []*Schema{{Type: "null"}, {Type: "integer"}, {Type: "string"}, {Type: "array", Items: response}}}
	for _, member := range []reflect.Type{reflect.TypeFor[[]string](), reflect.TypeFor[[]bool](),
		reflect.TypeFor[[]*int64](), reflect.TypeFor[[]AnkiConnectNoteInfoResult](),
		reflect.TypeFor[[]AnkiConnectAddDetail](), reflect.TypeFor[map[string]int64](), reflect.TypeFor[AnkiConnectReflection]()} {
		variant, err := b.schema(member, false)
		if err != nil {
			return nil, err
		}
		result.AnyOf = append(result.AnyOf, variant)
	}
	b.definitions["AnkiConnectResult"] = result
	b.definitions["AnkiConnectResponse"] = &Schema{AnyOf: []*Schema{
		{Ref: "#/$defs/AnkiConnectResult"},
		object(map[string]*Schema{"result": {Ref: "#/$defs/AnkiConnectResult"}, "error": {Type: "null"}}, "result", "error"),
		object(map[string]*Schema{"result": {Type: "null"}, "error": {Type: "string"}}, "result", "error"),
	}}
	return response, nil
}

func init() {
	AnkiConnect.decodeRequest = func(reader io.Reader) (request AnkiConnectRequest, err error) {
		err = json.NewDecoder(reader).Decode(&request)
		return
	}
	AnkiConnect.decodeFailure = func(err error) Response[AnkiConnectResponse] {
		encoded, _ := json.Marshal(struct {
			Result *string `json:"result"`
			Error  string  `json:"error"`
		}{Error: "invalid AnkiConnect request: " + err.Error()})
		value, _ := NewAnkiConnectResponse(encoded)
		return SuccessDirectJSON(value)
	}
}
