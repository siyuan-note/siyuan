package apicontract

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

type CheckBlockRefRequest struct {
	Scope      string   `json:"scope" api:"optional"`
	IDs        []string `json:"ids" api:"optional"`
	ExactIDs   []string `json:"exactIDs" api:"optional"`
	DeletedIDs []string `json:"deletedIDs" api:"optional"`
	Paths      []string `json:"paths" api:"optional"`
	Notebook   string   `json:"notebook" api:"optional,nullable"`
	ID         string   `json:"id" api:"optional,nullable,ignoretype"`
}

type HeadingLevelRequest struct {
	Level float64  `json:"level"`
	IDs   []string `json:"ids" api:"optional"`
	ID    string   `json:"id" api:"optional"`
}

type DocHeadingLevelRequest struct {
	ID              string `json:"id" api:"optional,nullable"`
	Notebook        string `json:"notebook" api:"optional,nullable"`
	Source          int    `json:"source" api:"optional,nullable"`
	Target          int    `json:"target" api:"optional,nullable"`
	WithSubheadings bool   `json:"withSubheadings" api:"optional,nullable"`
}

type DocHeadingLevelData struct {
	Counts               []int             `json:"counts" api:"nonnullable"`
	WithSubheadingCounts []int             `json:"withSubheadingCounts" api:"nonnullable"`
	Title                string            `json:"title"`
	Transaction          *BlockTransaction `json:"transaction"`
}

// 特殊解码仅保留这些入口的条件参数和结构体绑定语义，响应仍受各自的契约约束。
func init() {
	CheckBlockRef.decodeRequest = decodeCheckBlockRef
	GetHeadingLevelTransaction.decodeRequest = decodeHeadingLevel
	GetDocHeadingLevelTransaction.decodeRequest = func(reader io.Reader) (request DocHeadingLevelRequest, err error) {
		if json.NewDecoder(reader).Decode(&request) != nil {
			err = errors.New("invalid heading conversion parameters")
		}
		return
	}
}

func blockRequestFields(reader io.Reader, path string) (fields map[string]json.RawMessage, err error) {
	err = json.NewDecoder(reader).Decode(&fields)
	if err != nil {
		if errors.Is(err, io.EOF) {
			err = errors.New("the request body is empty or truncated (EOF)")
		}
		err = fmt.Errorf("Parses request [%s] failed: %s", path, err)
	}
	return
}

func decodeCheckBlockRef(reader io.Reader) (request CheckBlockRefRequest, err error) {
	fields, err := blockRequestFields(reader, "/api/block/checkBlockRef")
	if err != nil {
		return request, err
	}
	if raw, present := fields["scope"]; present {
		if bytes.Equal(raw, []byte("null")) || json.Unmarshal(raw, &request.Scope) != nil {
			return request, errors.New("Field [scope] should be of type [String]")
		}
	}
	if strings.TrimSpace(request.Scope) == "" {
		request.Scope = "blocks"
	}
	readArray := func(key string, required, nonempty bool) ([]string, error) {
		raw, present := fields[key]
		if !present && !required {
			return nil, nil
		}
		if !present || bytes.Equal(raw, []byte("null")) {
			return nil, fmt.Errorf("Field [%s] is required", key)
		}
		var entries []json.RawMessage
		if json.Unmarshal(raw, &entries) != nil {
			return nil, fmt.Errorf("Field [%s] should be of type [Array]", key)
		}
		if nonempty && len(entries) == 0 {
			return nil, fmt.Errorf("Field [%s] must not be empty", key)
		}
		var values []string
		seen := map[string]bool{}
		for _, entry := range entries {
			var value string
			if json.Unmarshal(entry, &value) != nil || strings.TrimSpace(value) == "" {
				return nil, fmt.Errorf("Field [%s] should contain non-empty strings", key)
			}
			if !seen[value] {
				values = append(values, value)
				seen[value] = true
			}
		}
		return values, nil
	}
	switch request.Scope {
	case "blocks":
		if request.IDs, err = readArray("ids", true, true); err != nil {
			return
		}
		if request.ExactIDs, err = readArray("exactIDs", false, false); err != nil {
			return
		}
		if request.DeletedIDs, err = readArray("deletedIDs", false, false); err != nil {
			return
		}
	case "documents":
		request.Paths, err = readArray("paths", true, true)
		return
	case "notebook":
		// 附带块 ID 只参与租约准入，沿用仅收集字符串的规则。
		var entries []json.RawMessage
		if json.Unmarshal(fields["ids"], &entries) == nil {
			for _, entry := range entries {
				var id string
				if !bytes.Equal(entry, []byte("null")) && json.Unmarshal(entry, &id) == nil {
					request.IDs = append(request.IDs, id)
				}
			}
		}
	default:
		return request, errors.New("invalid block ref check scope")
	}
	if raw := fields["notebook"]; len(raw) != 0 && !bytes.Equal(raw, []byte("null")) {
		if json.Unmarshal(raw, &request.Notebook) != nil {
			return request, errors.New("Field [notebook] should be of type [String]")
		}
	} else if request.Scope == "notebook" {
		return request, errors.New("Field [notebook] is required")
	}
	if request.Scope == "notebook" {
		request.Notebook = strings.TrimSpace(request.Notebook)
		if request.Notebook == "" {
			return request, errors.New("Field [notebook] must not be empty")
		}
	}
	_ = json.Unmarshal(fields["id"], &request.ID)
	return
}

func decodeHeadingLevel(reader io.Reader) (request HeadingLevelRequest, err error) {
	fields, err := blockRequestFields(reader, "/api/block/getHeadingLevelTransaction")
	if err != nil {
		return request, err
	}
	if len(fields["level"]) == 0 || bytes.Equal(fields["level"], []byte("null")) || json.Unmarshal(fields["level"], &request.Level) != nil {
		return request, errors.New("Field [level] should be of type [Number]")
	}
	var entries []json.RawMessage
	if raw := fields["ids"]; len(raw) > 0 && !bytes.Equal(raw, []byte("null")) && json.Unmarshal(raw, &entries) == nil {
		request.IDs = []string{}
		seen := map[string]bool{}
		for _, entry := range entries {
			var id string
			if bytes.Equal(entry, []byte("null")) || json.Unmarshal(entry, &id) != nil {
				return request, errors.New("Field [ids] should contain strings")
			}
			if !seen[id] {
				request.IDs = append(request.IDs, id)
				seen[id] = true
			}
		}
	} else if len(fields["id"]) == 0 || bytes.Equal(fields["id"], []byte("null")) || json.Unmarshal(fields["id"], &request.ID) != nil {
		return request, errors.New("Field [id] should be of type [String]")
	}
	return
}
