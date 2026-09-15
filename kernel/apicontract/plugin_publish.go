package apicontract

import (
	"bytes"
	"encoding/json"
	"errors"
)

// PublishDataValue 限定公开字段为标量，避免嵌套对象扩展绕过字段授权。
type PublishDataValue struct{ raw json.RawMessage }

func (v PublishDataValue) MarshalJSON() ([]byte, error) {
	if len(v.raw) == 0 {
		return []byte("null"), nil
	}
	return v.raw, nil
}
func (v *PublishDataValue) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if !json.Valid(data) || data[0] == '{' || data[0] == '[' {
		return errors.New("published data fields must be JSON scalars")
	}
	v.raw = append(v.raw[:0], data...)
	return nil
}

type PluginPublishRequest struct {
	PackageName string `json:"packageName"`
}

type PluginPublishInfo struct {
	Resources []string `json:"resources" api:"nonnullable"`
	Fields    []string `json:"fields" api:"nonnullable"`
	Granted   bool     `json:"granted"`
}

type SetPluginPublishDataGrantRequest struct {
	PackageName string   `json:"packageName"`
	Fields      []string `json:"fields"`
	Enabled     bool     `json:"enabled"`
}

type SavePluginPublishDataRequest struct {
	PackageName string                      `json:"packageName"`
	Data        map[string]PublishDataValue `json:"data"`
}
