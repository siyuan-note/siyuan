package apicontract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"strings"
)

// avDecodeBoundFields 仅对原本经过 JSON 结构体绑定的字段保留大小写匹配和数字归一化。
func avDecodeBoundFields[Request any](reader io.Reader, path string, boundFields map[string]string, ignoredBools []string) (request Request, err error) {
	fields, err := blockRequestFields(reader, path)
	if err != nil {
		return request, err
	}
	original := map[string]json.RawMessage{}
	for name, placeholder := range boundFields {
		raw, present := fields[name]
		if !present {
			return request, fmt.Errorf("Field [%s] is required", name)
		}
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return request, fmt.Errorf("Field [%s] must not be null", name)
		}
		original[name] = raw
		fields[name] = json.RawMessage(placeholder)
	}
	for _, name := range ignoredBools {
		original[name] = fields[name]
		delete(fields, name)
	}
	value := reflect.ValueOf(&request).Elem()
	if err = decodeRequestFields(value, fields); err != nil {
		return request, err
	}
	for i := 0; i < value.NumField(); i++ {
		field := value.Type().Field(i)
		name := field.Tag.Get("json")
		raw, present := original[name]
		if !present {
			continue
		}
		if _, bound := boundFields[name]; !bound {
			_ = json.Unmarshal(raw, value.Field(i).Addr().Interface())
			continue
		}
		var normalized any
		if err = json.Unmarshal(raw, &normalized); err != nil {
			return request, err
		}
		var data []byte
		if data, err = json.Marshal(normalized); err != nil {
			return request, err
		}
		if err = json.Unmarshal(data, value.Field(i).Addr().Interface()); err != nil {
			return request, err
		}
	}
	return request, nil
}

func init() {
	GetAttributeViewRowSort.decodeRequest = func(reader io.Reader) (request GetAttributeViewRowSortRequest, err error) {
		err = json.NewDecoder(reader).Decode(&request)
		return request, err
	}
	GetAttributeViewKeysByID.decodeRequest = func(reader io.Reader) (request GetAttributeViewKeysByIDRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/av/getAttributeViewKeysByID")
		if err != nil {
			return request, err
		}
		raw, present := fields["keyIDs"]
		fields["keyIDs"] = json.RawMessage("[]")
		if err = decodeRequestFields(reflect.ValueOf(&request).Elem(), fields); err != nil {
			return request, err
		}
		if !present {
			request.KeyIDsError = fmt.Errorf("Field [keyIDs] is required")
		} else if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			request.KeyIDsError = fmt.Errorf("Field [keyIDs] must not be null")
		} else {
			request.KeyIDsError = decodeRequestValue(raw, reflect.ValueOf(&request.KeyIDs).Elem())
		}
		return request, nil
	}
	GetAttributeViewPasteRows.decodeRequest = func(reader io.Reader) (GetAttributeViewPasteRowsRequest, error) {
		return avDecodeParsedRequest[GetAttributeViewPasteRowsRequest](reader, "/api/av/getAttributeViewPasteRows")
	}
	GetAttributeViewFieldViews.decodeRequest = func(reader io.Reader) (GetAttributeViewFieldViewsRequest, error) {
		return avDecodeParsedRequest[GetAttributeViewFieldViewsRequest](reader, "/api/av/getAttributeViewFieldViews")
	}
	CreateAttributeViewItem.decodeRequest = func(reader io.Reader) (CreateAttributeViewItemRequest, error) {
		return avDecodeParsedRequest[CreateAttributeViewItemRequest](reader, "/api/av/createAttributeViewItem")
	}
	CreateAttributeViewItemWithMarkdown.decodeRequest = func(reader io.Reader) (CreateAttributeViewItemWithMarkdownRequest, error) {
		return avDecodeParsedRequest[CreateAttributeViewItemWithMarkdownRequest](reader, "/api/av/createAttributeViewItemWithMarkdown")
	}
	CreateAttributeViewItemDocs.decodeRequest = func(reader io.Reader) (CreateAttributeViewItemDocsRequest, error) {
		return avDecodeParsedRequest[CreateAttributeViewItemDocsRequest](reader, "/api/av/createAttributeViewItemDocs")
	}
	SetAttrViewGroup.decodeRequest = func(reader io.Reader) (SetAttrViewGroupRequest, error) {
		return avDecodeBoundFields[SetAttrViewGroupRequest](reader, "/api/av/setAttrViewGroup", map[string]string{"group": "{}"}, []string{"ignoreRows"})
	}
	SetAttrViewFilters.decodeRequest = func(reader io.Reader) (SetAttrViewFiltersRequest, error) {
		return avDecodeBoundFields[SetAttrViewFiltersRequest](reader, "/api/av/setAttrViewFilters", map[string]string{"data": "[]"}, nil)
	}
	SetAttrViewSorts.decodeRequest = func(reader io.Reader) (SetAttrViewSortsRequest, error) {
		return avDecodeBoundFields[SetAttrViewSortsRequest](reader, "/api/av/setAttrViewSorts", map[string]string{"data": "[]"}, nil)
	}
	AppendAttributeViewDetachedBlocksWithValues.decodeRequest = func(reader io.Reader) (AppendAttributeViewDetachedBlocksWithValuesRequest, error) {
		return avDecodeBoundFields[AppendAttributeViewDetachedBlocksWithValuesRequest](reader, "/api/av/appendAttributeViewDetachedBlocksWithValues", map[string]string{"blocksValues": "[]"}, nil)
	}
	SetAttributeViewBlockAttr.decodeRequest = func(reader io.Reader) (SetAttributeViewBlockAttrRequest, error) {
		return avDecodeBoundFields[SetAttributeViewBlockAttrRequest](reader, "/api/av/setAttributeViewBlockAttr", map[string]string{"value": "{}"}, nil)
	}
	BatchSetAttributeViewBlockAttrs.decodeRequest = func(reader io.Reader) (BatchSetAttributeViewBlockAttrsRequest, error) {
		return avDecodeBoundFields[BatchSetAttributeViewBlockAttrsRequest](reader, "/api/av/batchSetAttributeViewBlockAttrs", map[string]string{"values": "[]"}, nil)
	}
	SearchAttributeView.decodeRequest = func(reader io.Reader) (SearchAttributeViewRequest, error) {
		return avDecodeBoundFields[SearchAttributeViewRequest](reader, "/api/av/searchAttributeView", nil, []string{"includeViewMatches"})
	}
}

func avDecodeParsedRequest[Request any](reader io.Reader, path string) (request Request, err error) {
	fields, err := blockRequestFields(reader, path)
	if err != nil {
		return request, err
	}
	value := reflect.ValueOf(&request).Elem()
	for i := 0; i < value.NumField(); i++ {
		field := value.Type().Field(i)
		name := field.Tag.Get("json")
		options := "," + field.Tag.Get("api") + ","
		required := !strings.Contains(options, ",optional,")
		switch field.Type.Kind() {
		case reflect.Pointer:
			// 可选指针保留省略、null 和零值的区别，具体值继续使用契约类型校验。
			if raw, present := fields[name]; present {
				err = decodeRequestValue(raw, value.Field(i))
				if err != nil {
					err = fmt.Errorf("Field [%s]: %w", name, err)
				}
			} else if required {
				err = fmt.Errorf("Field [%s] is required", name)
			}
		case reflect.String:
			var decoded string
			decoded, err = legacyField[string](fields, name, "String", required)
			if err == nil && strings.Contains(options, ",trim,") {
				decoded = strings.TrimSpace(decoded)
				if decoded == "" {
					err = fmt.Errorf("Field [%s] must not be empty", name)
				}
			}
			value.Field(i).SetString(decoded)
		case reflect.Bool:
			var decoded bool
			decoded, err = legacyField[bool](fields, name, "Boolean", required)
			value.Field(i).SetBool(decoded)
		case reflect.Float64:
			var decoded float64
			decoded, err = legacyField[float64](fields, name, "Number", required)
			value.Field(i).SetFloat(decoded)
		case reflect.Slice:
			var entries []json.RawMessage
			entries, err = legacyField[[]json.RawMessage](fields, name, "Array", required)
			var decoded []string
			for _, entry := range entries {
				var item string
				if !bytes.Equal(entry, []byte("null")) && json.Unmarshal(entry, &item) == nil {
					decoded = append(decoded, item)
				}
			}
			value.Field(i).Set(reflect.ValueOf(decoded))
		default:
			return request, fmt.Errorf("unsupported parsed attribute view field %s", name)
		}
		if err != nil {
			return request, err
		}
	}
	return request, nil
}
