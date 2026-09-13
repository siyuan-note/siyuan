package apicontract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// GraphConfiguration 延迟绑定具体图配置，使局部图继续忽略全局图字段，并保留默认值合并顺序。
type GraphConfiguration struct{ raw json.RawMessage }

func (c *GraphConfiguration) UnmarshalJSON(data []byte) error {
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return fmt.Errorf("Field [conf] is required")
	}
	fields, err := legacyJSONValue[map[string]json.RawMessage](data)
	if err != nil {
		return fmt.Errorf("Field [conf] should be of type [Object]")
	}
	c.raw, err = json.Marshal(fields)
	return err
}

func (c GraphConfiguration) MarshalJSON() ([]byte, error) {
	if len(c.raw) == 0 {
		return []byte("{}"), nil
	}
	return c.raw, nil
}

type GraphConfigurationFields struct {
	MinRefs   *int             `json:"minRefs" api:"optional"`
	DailyNote *bool            `json:"dailyNote" api:"optional"`
	Type      *GraphTypeFilter `json:"type" api:"optional"`
	D3        *GraphD3         `json:"d3" api:"optional"`
}

type SetGraphConfRequest struct {
	Type string             `json:"type" api:"trim"`
	Conf GraphConfiguration `json:"conf"`
}

func init() {
	SetGraphConf.decodeRequest = func(reader io.Reader) (request SetGraphConfRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/graph/setGraphConf")
		if err != nil {
			return request, err
		}
		if request.Type, err = legacyField[string](fields, "type", "String", true); err != nil {
			return request, err
		}
		request.Type = strings.TrimSpace(request.Type)
		if request.Type == "" {
			return request, fmt.Errorf("Field [type] must not be empty")
		}
		if len(fields["conf"]) == 0 {
			return request, fmt.Errorf("Field [conf] is required")
		}
		err = json.Unmarshal(fields["conf"], &request.Conf)
		return
	}
}

type GraphConfigurationData struct {
	global *GlobalGraphConf
	local  *LocalGraphConf
}

func GlobalGraphConfiguration(value GlobalGraphConf) GraphConfigurationData {
	return GraphConfigurationData{global: &value}
}
func LocalGraphConfiguration(value LocalGraphConf) GraphConfigurationData {
	return GraphConfigurationData{local: &value}
}
func (c GraphConfigurationData) MarshalJSON() ([]byte, error) {
	if c.global != nil {
		return json.Marshal(c.global)
	}
	return json.Marshal(c.local)
}
