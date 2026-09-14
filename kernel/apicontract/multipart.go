package apicontract

import (
	"fmt"
	"mime/multipart"
	"reflect"
	"strings"
)

// MultipartFields 按字段名保留全部文本值和文件，同名字段不会合并或截断。
type MultipartFields struct {
	Value map[string][]string
	File  map[string][]*multipart.FileHeader
}

func validateMultipartRequest(t reflect.Type) error {
	if t == reflect.TypeFor[MultipartFields]() || t == reflect.TypeFor[ExtensionCopyRequest]() {
		return nil
	}
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if !field.IsExported() || field.Anonymous || field.Tag.Get("json") == "" {
			return fmt.Errorf("multipart fields must be named and exported: %s", field.Name)
		}
		if field.Type != reflect.TypeFor[string]() && field.Type != reflect.TypeFor[*string]() && field.Type != reflect.TypeFor[*multipart.FileHeader]() && field.Type != reflect.TypeFor[[]*multipart.FileHeader]() {
			return fmt.Errorf("unsupported multipart field: %s", field.Name)
		}
		for _, option := range strings.Split(field.Tag.Get("api"), ",") {
			if option != "" && option != "optional" && option != "nonnullable" {
				return fmt.Errorf("unsupported multipart option: %s", option)
			}
		}
	}
	return nil
}

// DecodeMultipart 保留表单重复字段取首值的行为，文件内容由业务入口按需读取。
func (e Endpoint[Request, Data]) DecodeMultipart(form *multipart.Form) (request Request, err error) {
	if e.definition.Body != MultipartBody && e.definition.Body != FormBody {
		return request, fmt.Errorf("endpoint does not accept multipart data")
	}
	if form == nil {
		return request, fmt.Errorf("multipart form is missing")
	}
	value := reflect.ValueOf(&request).Elem()
	if value.Type() == reflect.TypeFor[ExtensionCopyRequest]() {
		decoded, decodeErr := decodeExtensionCopyForm(form)
		if decodeErr != nil {
			return request, decodeErr
		}
		value.Set(reflect.ValueOf(decoded))
		return
	}
	if value.Type() == reflect.TypeFor[MultipartFields]() {
		value.Set(reflect.ValueOf(MultipartFields{Value: form.Value, File: form.File}))
		return
	}
	if value.Kind() != reflect.Struct {
		return request, fmt.Errorf("multipart request must be a struct")
	}
	if err = validateMultipartRequest(value.Type()); err != nil {
		return
	}
	for i := 0; i < value.NumField(); i++ {
		field := value.Type().Field(i)
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		optional := strings.Contains(","+field.Tag.Get("api")+",", ",optional,")
		switch field.Type {
		case reflect.TypeFor[*multipart.FileHeader](), reflect.TypeFor[[]*multipart.FileHeader]():
			files := form.File[name]
			if len(files) == 0 {
				if !optional {
					return request, fmt.Errorf("%s not found", name)
				}
				continue
			}
			if field.Type.Kind() == reflect.Slice {
				value.Field(i).Set(reflect.ValueOf(files))
			} else {
				value.Field(i).Set(reflect.ValueOf(files[0]))
			}
		case reflect.TypeFor[string](), reflect.TypeFor[*string]():
			values := form.Value[name]
			if len(values) == 0 {
				if !optional {
					return request, fmt.Errorf("Field [%s] is required", name)
				}
				continue
			}
			if field.Type.Kind() == reflect.Pointer {
				text := reflect.New(field.Type.Elem())
				text.Elem().SetString(values[0])
				value.Field(i).Set(text)
			} else {
				value.Field(i).SetString(values[0])
			}
		default:
			return request, fmt.Errorf("unsupported multipart field: %s", name)
		}
	}
	return
}
