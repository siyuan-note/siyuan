package apicontract

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
)

// Decode 按精确的 JSON 字段名绑定请求，缺失、null 和兼容转换由字段声明控制。
func (e Endpoint[Request, Data]) Decode(reader io.Reader) (request Request, err error) {
	if e.definition.Body == NoBody {
		return
	}
	if reader == nil {
		reader = bytes.NewReader(nil)
	}
	var fields map[string]json.RawMessage
	err = json.NewDecoder(reader).Decode(&fields)
	if err != nil {
		if e.definition.Body == LegacyOptionalBody {
			return request, nil
		}
		if errors.Is(err, io.EOF) {
			err = errors.New("the request body is empty or truncated (EOF)")
		}
		return request, fmt.Errorf("Parses request [%s] failed: %s", e.definition.Path, err)
	}
	value := reflect.ValueOf(&request).Elem()
	if value.Kind() != reflect.Struct {
		return request, fmt.Errorf("request contract must be a struct")
	}
	err = decodeRequestFields(value, fields)
	return request, err
}

func decodeRequestFields(value reflect.Value, fields map[string]json.RawMessage) error {
	for i := 0; i < value.NumField(); i++ {
		field := value.Type().Field(i)
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		if (!field.IsExported() && !field.Anonymous) || name == "-" {
			continue
		}
		if field.Anonymous && name == "" {
			if field.Type.Kind() != reflect.Struct {
				return fmt.Errorf("unsupported embedded request field: %s", field.Name)
			}
			if err := decodeRequestFields(value.Field(i), fields); err != nil {
				return err
			}
			continue
		}
		options := "," + field.Tag.Get("api") + ","
		has := func(option string) bool { return strings.Contains(options, ","+option+",") }
		raw, present := fields[name]
		if !present {
			if has("optional") {
				continue
			}
			return fmt.Errorf("Field [%s] is required", name)
		}
		isNull := bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
		if isNull && !has("nullable") && field.Type.Kind() != reflect.Pointer && !has("filterstrings") {
			return fmt.Errorf("Field [%s] must not be null", name)
		}
		if has("filterstrings") {
			var entries []json.RawMessage
			if json.Unmarshal(raw, &entries) == nil {
				var ids []string
				for _, entry := range entries {
					var id string
					if !bytes.Equal(bytes.TrimSpace(entry), []byte("null")) && json.Unmarshal(entry, &id) == nil {
						ids = append(ids, id)
					}
				}
				value.Field(i).Set(reflect.ValueOf(ids))
			}
			continue
		}
		var decodeErr error
		if isNull && has("nullable") {
			value.Field(i).SetZero()
		} else {
			decodeErr = decodeRequestValue(raw, value.Field(i))
		}
		if decodeErr != nil {
			if has("ignoretype") {
				continue
			}
			return fmt.Errorf("Field [%s] has an invalid type: %w", name, decodeErr)
		}
		if has("trim") {
			trimmed := strings.TrimSpace(value.Field(i).String())
			if trimmed == "" {
				return fmt.Errorf("Field [%s] must not be empty", name)
			}
			value.Field(i).SetString(trimmed)
		}
		for _, option := range strings.Split(field.Tag.Get("api"), ",") {
			if strings.HasPrefix(option, "enum=") {
				if field.Type.Kind() != reflect.String {
					return fmt.Errorf("unsupported enum field: %s", name)
				}
				found := false
				for _, choice := range strings.Split(strings.TrimPrefix(option, "enum="), "|") {
					if value.Field(i).String() == choice {
						found = true
						break
					}
				}
				if !found {
					return fmt.Errorf("Field [%s] has an invalid value", name)
				}
			}
			if strings.HasPrefix(option, "const=") {
				var expected, actual any
				if err := json.Unmarshal([]byte(strings.TrimPrefix(option, "const=")), &expected); err != nil {
					return err
				}
				data, err := json.Marshal(value.Field(i).Interface())
				if err != nil {
					return err
				}
				if err := json.Unmarshal(data, &actual); err != nil {
					return err
				}
				if !reflect.DeepEqual(expected, actual) {
					return fmt.Errorf("Field [%s] has an invalid constant", name)
				}
			}
		}
	}
	return nil
}

// decodeRequestValue 递归绑定复合参数，避免数组元素和嵌套字段绕过空值及必填检查。
func decodeRequestValue(raw json.RawMessage, value reflect.Value) error {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		switch value.Kind() {
		case reflect.Pointer, reflect.Map, reflect.Slice:
			value.SetZero()
			return nil
		default:
			return fmt.Errorf("value must not be null")
		}
	}
	switch value.Kind() {
	case reflect.Pointer:
		value.Set(reflect.New(value.Type().Elem()))
		return decodeRequestValue(raw, value.Elem())
	case reflect.Struct:
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			return err
		}
		return decodeRequestFields(value, fields)
	case reflect.Slice:
		var entries []json.RawMessage
		if err := json.Unmarshal(raw, &entries); err != nil {
			return err
		}
		value.Set(reflect.MakeSlice(value.Type(), len(entries), len(entries)))
		for i, entry := range entries {
			if err := decodeRequestValue(entry, value.Index(i)); err != nil {
				return fmt.Errorf("element [%d]: %w", i, err)
			}
		}
		return nil
	case reflect.Map:
		var entries map[string]json.RawMessage
		if err := json.Unmarshal(raw, &entries); err != nil {
			return err
		}
		value.Set(reflect.MakeMapWithSize(value.Type(), len(entries)))
		for key, entry := range entries {
			child := reflect.New(value.Type().Elem()).Elem()
			if err := decodeRequestValue(entry, child); err != nil {
				return fmt.Errorf("entry [%s]: %w", key, err)
			}
			value.SetMapIndex(reflect.ValueOf(key).Convert(value.Type().Key()), child)
		}
		return nil
	default:
		return json.Unmarshal(raw, value.Addr().Interface())
	}
}
