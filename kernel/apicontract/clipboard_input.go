package apicontract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

func init() {
	PrepareRichText.decodeRequest = func(reader io.Reader) (request PrepareRichTextRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/clipboard/prepareRichText")
		if err != nil {
			return request, err
		}
		assets, err := legacyField[[]json.RawMessage](fields, "assets", "Array", true)
		if err != nil {
			return request, err
		}
		if len(assets) == 0 {
			return request, fmt.Errorf("Field [assets] must not be empty")
		}
		request.Assets = make([]RichClipboardAsset, 0, len(assets))
		for i, raw := range assets {
			var asset map[string]json.RawMessage
			if json.Unmarshal(raw, &asset) != nil || asset == nil {
				return request, fmt.Errorf("Field [assets.%d] should be of type [Object]", i)
			}
			var index float64
			var path, box string
			if bytes.Equal(asset["index"], []byte("null")) || json.Unmarshal(asset["index"], &index) != nil || index < 0 || index != float64(int(index)) || json.Unmarshal(asset["path"], &path) != nil || strings.TrimSpace(path) == "" {
				return request, fmt.Errorf("Invalid rich clipboard asset at index [%d]", i)
			}
			if value, exists := asset["box"]; exists {
				if bytes.Equal(value, []byte("null")) || json.Unmarshal(value, &box) != nil {
					return request, fmt.Errorf("Field [assets.%d.box] should be of type [String]", i)
				}
			}
			request.Assets = append(request.Assets, RichClipboardAsset{Index: int(index), Path: strings.TrimSpace(path), Box: strings.TrimSpace(box)})
		}
		return
	}
	CleanupRichText.decodeRequest = func(reader io.Reader) (request CleanupRichTextRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/clipboard/cleanupRichText")
		if err != nil {
			return request, err
		}
		request.Batch, err = legacyField[string](fields, "batch", "String", true)
		if err != nil {
			return request, err
		}
		request.Batch = strings.TrimSpace(request.Batch)
		if request.Batch == "" {
			return request, fmt.Errorf("Field [batch] must not be empty")
		}
		groups, err := legacyField[[]json.RawMessage](fields, "groups", "Array", true)
		if err != nil {
			return request, err
		}
		request.Groups = make([]string, 0, len(groups))
		if len(groups) == 0 {
			return request, fmt.Errorf("Field [groups] must not be empty")
		}
		for i, raw := range groups {
			var group string
			if bytes.Equal(raw, []byte("null")) || json.Unmarshal(raw, &group) != nil {
				return request, fmt.Errorf("Field [groups.%d] should be of type [String]", i)
			}
			request.Groups = append(request.Groups, group)
		}
		return
	}
}
