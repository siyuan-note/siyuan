package apicontract

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

type SetInlineStylesRequest struct {
	Version float64             `json:"version"`
	Styles  []*InlineStyle      `json:"styles"`
	Builtin *InlineStyleBuiltin `json:"builtin" api:"optional"`
	Order   *InlineStyleOrder   `json:"order" api:"optional"`
	AV      *InlineStyleAV      `json:"av" api:"optional"`
	App     string              `json:"app" api:"optional,nullable"`
}

type WorkspaceAVPaletteRequest struct {
	Colors        []*AttributeViewCustomColor      `json:"colors"`
	Order         []string                         `json:"order"`
	BuiltinColors []*WorkspaceAVBuiltinColorUpdate `json:"builtinColors" api:"optional,nullable"`
	App           string                           `json:"app" api:"optional,nullable"`
}

// legacyJSONValue 保留先解析通用 JSON 再绑定结构体时的数字归一化和大小写匹配。
func legacyJSONValue[T any](raw []byte) (value T, err error) {
	var normalized any
	if err = json.Unmarshal(raw, &normalized); err != nil {
		return
	}
	data, err := json.Marshal(normalized)
	if err == nil {
		err = json.Unmarshal(data, &value)
	}
	return
}

func legacyField[T any](fields map[string]json.RawMessage, key, kind string, required bool) (value T, err error) {
	raw := fields[key]
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		if required {
			err = fmt.Errorf("Field [%s] is required", key)
		}
		return
	}
	if json.Unmarshal(raw, &value) != nil {
		err = fmt.Errorf("Field [%s] should be of type [%s]", key, kind)
	}
	return
}

func init() {
	SetInlineStyles.decodeRequest = func(reader io.Reader) (request SetInlineStylesRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/storage/setInlineStyles")
		if err != nil {
			return request, err
		}
		version, err := legacyField[float64](fields, "version", "Number", true)
		if err != nil {
			return request, err
		}
		if _, err = legacyField[[]json.RawMessage](fields, "styles", "Array", true); err != nil {
			return request, err
		}
		app, err := legacyField[string](fields, "app", "String", false)
		if err != nil {
			return request, err
		}
		if version != 1 && version != 2 {
			return request, errors.New("unsupported inline styles version")
		}
		if version == 1 {
			request.Styles, err = legacyJSONValue[[]*InlineStyle](fields["styles"])
		} else {
			data, marshalErr := json.Marshal(fields)
			if marshalErr != nil {
				return request, marshalErr
			}
			request, err = legacyJSONValue[SetInlineStylesRequest](data)
		}
		request.Version, request.App = version, app
		return
	}
	SetWorkspaceAVPalette.decodeRequest = func(reader io.Reader) (request WorkspaceAVPaletteRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/storage/setWorkspaceAVPalette")
		if err != nil {
			return request, err
		}
		for _, key := range []string{"colors", "order", "builtinColors"} {
			if _, err = legacyField[[]json.RawMessage](fields, key, "Array", key != "builtinColors"); err != nil {
				return request, err
			}
		}
		app, err := legacyField[string](fields, "app", "String", false)
		if err != nil {
			return request, err
		}
		data, err := json.Marshal(fields)
		if err != nil {
			return request, err
		}
		request, err = legacyJSONValue[WorkspaceAVPaletteRequest](data)
		request.App = app
		return
	}
}
