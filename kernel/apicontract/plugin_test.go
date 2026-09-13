package apicontract

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPluginNameDecodeCompatibility(t *testing.T) {
	for _, endpoint := range []Endpoint[LoadedPluginRequest, *LoadedPlugin]{GetLoadedPlugin, GetLoadedPluginRPC, GetLoadedPluginRPCByName} {
		for _, entry := range []struct {
			body string
			code int
		}{{`{}`, 1}, {`null`, 1}, {`{"name":null}`, 1}, {`{"name":false}`, 2}, {`{"name":[]}`, 2}, {`{`, -1}} {
			_, err := endpoint.Decode(strings.NewReader(entry.body))
			if err == nil {
				t.Fatalf("invalid plugin name accepted: %s", entry.body)
			}
			payload, err := json.Marshal(endpoint.DecodeFailure(err))
			if err != nil {
				t.Fatal(err)
			}
			var response struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(payload, &response); err != nil || response.Code != entry.code {
				t.Fatalf("plugin name error changed: %s, %v", payload, err)
			}
		}
		for _, name := range []string{"", " plugin "} {
			request, err := endpoint.Decode(strings.NewReader(`{"name":"` + name + `"}`))
			if err != nil || request.Name != name {
				t.Fatalf("plugin name trimming changed: %+v, %v", request, err)
			}
		}
	}
}
