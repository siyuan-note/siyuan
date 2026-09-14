package apicontract

import (
	"bytes"
	"encoding/json"
	"io"
)

func (request NetworkForwardRequest) Options() (options NetworkForwardOptions, err error) {
	fields := request.fields
	if options.Method, err = networkOptionalField[string](fields, "method", "String"); err != nil {
		return
	}
	if options.Timeout, err = networkOptionalField[float64](fields, "timeout", "Number"); err != nil {
		return
	}
	_ = json.Unmarshal(fields["responseEncoding"], &options.ResponseEncoding)
	var redirect bool
	if raw := fields["redirect"]; len(raw) > 0 && !bytes.Equal(raw, []byte("null")) && json.Unmarshal(raw, &redirect) == nil {
		options.Redirect = &redirect
	}
	var headers []json.RawMessage
	if json.Unmarshal(fields["headers"], &headers) == nil {
		for _, raw := range headers {
			var header map[string]JSONValue
			if json.Unmarshal(raw, &header) == nil && header != nil {
				options.Headers = append(options.Headers, header)
			}
		}
	}
	if options.ContentType, err = networkOptionalField[string](fields, "contentType", "String"); err != nil {
		return
	}
	if options.PayloadEncoding, err = networkOptionalField[string](fields, "payloadEncoding", "String"); err != nil {
		return
	}
	if raw := fields["payload"]; len(raw) > 0 {
		err = json.Unmarshal(raw, &options.Payload)
	}
	return
}

func networkOptionalField[T any](fields fileTreeFields, key, kind string) (*T, error) {
	if raw := fields[key]; len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return nil, nil
	}
	value, err := legacyField[T](fields, key, kind, false)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func init() {
	NetworkForwardProxy.decodeRequest = func(reader io.Reader) (request NetworkForwardRequest, err error) {
		request.fields, err = fileTreeRequestFields(reader, NetworkForwardProxy.definition.Path)
		if err == nil {
			request.URL, err = aiLegacyString(request.fields, "url", true, true)
		}
		return
	}
}
