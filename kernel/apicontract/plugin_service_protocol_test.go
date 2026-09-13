package apicontract

import (
	"net/http"
	"testing"
)

func TestPluginServiceProtocolVariants(t *testing.T) {
	previous := definitions
	t.Cleanup(func() { definitions = previous })
	endpoint := define[EmptyRequest, PluginServiceContent]("pluginServiceTest", "/test/plugin/:name/*path", RawBody, PluginServiceOptions(), "ANY")
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[PluginServiceMode]bool{}
	for _, variant := range endpoint.Definition().PluginService.Variants {
		if seen[variant.Mode] {
			t.Fatal("duplicate service mode")
		}
		seen[variant.Mode] = true
		if variant.StatusPolicy == "" || len(variant.MediaTypes) == 0 || variant.Payload == "" {
			t.Fatalf("incomplete mode declaration: %+v", variant)
		}
	}
	if len(seen) != 19 {
		t.Fatal("service modes missing")
	}
	for _, tt := range []struct {
		mode   PluginServiceMode
		status int
		body   string
		valid  bool
	}{
		{PluginServiceJSON, 200, `{"extension":[true,null,1]}`, true},
		{PluginServiceJSON, 700, `null`, true},
		{PluginServiceJSON, 200, `invalid`, false},
		{PluginServiceJSONP, 200, `callback({"a":1});`, true},
		{PluginServiceJSONP, 200, `callback(invalid);`, false},
		{PluginServiceXML, 200, `<value>x</value>`, true},
		{PluginServiceXML, 200, `<value>`, false},
		{PluginServiceYAML, 200, `key: [1, true]`, true},
		{PluginServiceYAML, 200, `key: [`, false},
		{PluginServiceTOML, 200, `key = "value"`, true},
		{PluginServiceTOML, 200, `key = [`, false},
		{PluginServiceProtoBuf, 200, "\n\x01x", true},
		{PluginServiceProtoBuf, 200, "\xff", false},
		{PluginServiceASCIIJSON, 200, `"\u0041"`, true},
		{PluginServiceIndentedJSON, 200, "{\n\"a\":1\n}", true},
		{PluginServicePureJSON, 200, "[1]\n", true},
		{PluginServiceSecureJSON, 200, "while(1);[1]", true},
		{PluginServiceSecureJSON, 200, "while(1);invalid", false},
		{PluginServiceRaw, 999, "\x00\xff", true},
		{PluginServiceProxy, 404, "upstream error", true},
		{PluginServiceEmpty, 200, "", true},
		{PluginServiceEmpty, 200, "unexpected", false},
		{PluginServiceRaw, 204, "unexpected", false},
		{PluginServiceAdmission, 404, "not found", true},
		{PluginServiceAdmission, 502, "invalid admission", false},
		{PluginServiceRedirect, 302, "redirect", true},
		{PluginServiceRedirect, 200, "redirect", false},
		{PluginServiceWebSocket, 101, "", true},
		{PluginServiceWebSocket, 400, "upgrade failed", true},
		{PluginServiceWebSocket, 200, "", false},
		{PluginServiceSSE, 200, "event: custom\ndata: plain text\n\n", true},
		{PluginServiceMode("unknown"), 200, "", false},
	} {
		err := bundle.ValidatePluginServiceResponse("GET", "/test/plugin/:name/*path", tt.mode, tt.status, "application/custom", []byte(tt.body))
		if (err == nil) != tt.valid {
			t.Errorf("%+v: %v", tt, err)
		}
	}
	stream := StreamPluginService(PluginServiceRaw, 0, func(http.ResponseWriter, *http.Request) {})
	if endpoint.Status(stream) != 200 || stream.Stream() == nil {
		t.Fatal("default plugin status changed")
	}
	if _, err := stream.MarshalJSON(); err == nil {
		t.Fatal("service stream serialized as envelope")
	}
	definition := endpoint.Definition()
	definition.PluginService = &PluginServiceDefinition{}
	if err := validatePluginServiceDefinition(definition); err == nil {
		t.Fatal("incomplete service protocol accepted")
	}
	if err := bundle.ValidatePluginServiceResponse("HEAD", "/test/plugin/:name/*path", PluginServiceRaw, 200, "", []byte("body")); err == nil {
		t.Fatal("HEAD body accepted")
	}
	for _, frame := range []int{1, 2, 8, 9, 10} {
		if err := bundle.ValidatePluginServiceFrame("GET", "/test/plugin/:name/*path", frame, []byte("data")); err != nil {
			t.Fatal(err)
		}
	}
	if err := bundle.ValidatePluginServiceFrame("GET", "/test/plugin/:name/*path", 3, nil); err == nil {
		t.Fatal("unknown frame accepted")
	}
	for _, event := range []string{`{"data":null}`, `{"event":"custom","id":"1","retry":100,"data":{"extension":[1,true]}}`} {
		if err := bundle.ValidatePluginServiceEvent("GET", "/test/plugin/:name/*path", []byte(event)); err != nil {
			t.Fatal(err)
		}
	}
	for _, event := range []string{`{}`, `{"event":1,"data":null}`, `{"retry":"1","data":false}`} {
		if err := bundle.ValidatePluginServiceEvent("GET", "/test/plugin/:name/*path", []byte(event)); err == nil {
			t.Fatalf("invalid event accepted: %s", event)
		}
	}
}
