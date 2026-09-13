package apicontract

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

type LoadedPluginRequest struct {
	Name string `json:"name"`
}

type LoadedPlugin struct {
	Name      string             `json:"name"`
	State     string             `json:"state"`
	StateCode int                `json:"stateCode"`
	Methods   []*PluginRPCMethod `json:"methods"`
}

type PluginRPCMethod struct {
	Name         string   `json:"name"`
	Descriptions []string `json:"descriptions"`
}

type pluginNameError struct {
	code    int
	message string
}

func (e *pluginNameError) Error() string { return e.message }

func init() {
	for _, endpoint := range []*Endpoint[LoadedPluginRequest, *LoadedPlugin]{&GetLoadedPlugin, &GetLoadedPluginRPC, &GetLoadedPluginRPCByName} {
		endpoint.decodeRequest = func(reader io.Reader) (request LoadedPluginRequest, err error) {
			fields, err := blockRequestFields(reader, endpoint.Definition().Path)
			if err != nil {
				return request, err
			}
			raw := fields["name"]
			if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
				return request, &pluginNameError{1, "Request body prop [name] does not exist"}
			}
			if json.Unmarshal(raw, &request.Name) != nil {
				return request, &pluginNameError{2, "Request body prop [name] is not a string"}
			}
			return request, nil
		}
		endpoint.decodeFailure = func(err error) Response[*LoadedPlugin] {
			var nameError *pluginNameError
			if errors.As(err, &nameError) {
				return Failure[*LoadedPlugin](nameError.code, nameError.message)
			}
			return Failure[*LoadedPlugin](-1, err.Error())
		}
	}
}
