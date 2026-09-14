package apicontract

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
)

// CloudLogin2faData 保留云端双因素认证结果的固定字段和协议扩展字段。
type CloudLogin2faData struct {
	Code  float64              `json:"code"`
	Msg   string               `json:"msg"`
	Extra map[string]JSONValue `json:"-"`
}

func (d CloudLogin2faData) MarshalJSON() ([]byte, error) {
	fields := make(map[string]json.RawMessage, len(d.Extra)+2)
	for key, value := range d.Extra {
		encoded, err := value.MarshalJSON()
		if err != nil {
			return nil, err
		}
		fields[key] = encoded
	}
	var err error
	if fields["code"], err = json.Marshal(d.Code); err != nil {
		return nil, err
	}
	if fields["msg"], err = json.Marshal(d.Msg); err != nil {
		return nil, err
	}
	return json.Marshal(fields)
}

func (d *CloudLogin2faData) UnmarshalJSON(raw []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	code, msg := fields["code"], fields["msg"]
	if len(code) == 0 || bytes.Equal(code, []byte("null")) || json.Unmarshal(code, &d.Code) != nil {
		return errors.New("invalid cloud login code")
	}
	if len(msg) == 0 || bytes.Equal(msg, []byte("null")) || json.Unmarshal(msg, &d.Msg) != nil {
		return errors.New("invalid cloud login message")
	}
	if d.Code == 0 {
		var token string
		if json.Unmarshal(fields["token"], &token) != nil || token == "" {
			return errors.New("invalid cloud login token")
		}
	}
	d.Extra = make(map[string]JSONValue, len(fields)-2)
	for key, raw := range fields {
		if key == "code" || key == "msg" {
			continue
		}
		value, err := EncodedJSONValue(raw)
		if err != nil {
			return err
		}
		d.Extra[key] = value
	}
	return nil
}

type Login2faEnvelope struct {
	Code int                `json:"code"`
	Msg  string             `json:"msg"`
	Data *CloudLogin2faData `json:"data"`
}

func (b *schemaBuilder) cloudLogin2faDataSchema(input bool) (*Schema, error) {
	value, err := b.schema(reflect.TypeFor[JSONValue](), input)
	if err != nil {
		return nil, err
	}
	return &Schema{Type: "object", Properties: map[string]*Schema{"code": {Type: "number"}, "msg": {Type: "string"}}, Required: []string{"code", "msg"}, AdditionalProperties: value}, nil
}
