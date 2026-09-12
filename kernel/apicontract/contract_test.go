package apicontract

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestRequestCompatibility(t *testing.T) {
	for _, body := range []string{"", "null", "{}", "[]", "invalid", `{"flashcard":`, `{"flashcard":null}`} {
		request, err := ListNotebooks.Decode(strings.NewReader(body))
		if err != nil || request.Flashcard {
			t.Fatalf("legacy notebook request %q: %+v, %v", body, request, err)
		}
	}
	request, err := ListNotebooks.Decode(strings.NewReader(`{"flashcard":true}`))
	if err != nil || !request.Flashcard {
		t.Fatalf("flashcard request: %+v, %v", request, err)
	}
	if _, err := ListNotebooks.Decode(strings.NewReader(`{"flashcard":1}`)); err == nil {
		t.Fatal("invalid boolean must return an error")
	}
	for _, body := range []string{`{}`, `{"page":null,"type":null}`} {
		request, err := SearchHistory.Decode(strings.NewReader(body))
		if err != nil || request.Page != nil || request.Type != nil {
			t.Fatalf("history defaults %q: %+v, %v", body, request, err)
		}
	}
	for _, number := range []string{"0", "1.9", "-1.9", "1e2"} {
		request, err := SearchHistory.Decode(strings.NewReader(`{"page":` + number + `,"type":` + number + `}`))
		var legacy map[string]any
		_ = json.Unmarshal([]byte(`{"page":`+number+`}`), &legacy)
		if err != nil || request.Page == nil || int(*request.Page) != int(legacy["page"].(float64)) || *request.Type != *request.Page {
			t.Fatalf("numeric conversion %q changed: %+v, %v", number, request, err)
		}
	}
	for _, body := range []string{`{"page":"2"}`, `{"page":true}`, `{"query":2}`} {
		if _, err := SearchHistory.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid history request accepted: %s", body)
		}
	}
	attrs, err := SetBlockAttrs.Decode(strings.NewReader(`{"id":"id","attrs":{"custom-value":null,"name":"value"}}`))
	if err != nil || attrs.Attrs["custom-value"] != nil || *attrs.Attrs["name"] != "value" {
		t.Fatalf("nullable attribute values changed: %+v, %v", attrs, err)
	}
	for _, body := range []string{"", "null", "{}", `{"ID":"id"}`, `{"id":null}`, `{"id":1}`} {
		if _, err := GetBlockAttrs.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid ID request accepted: %q", body)
		}
	}
	for _, body := range []string{`{"id":"id"}`, `{"id":"id","attrs":null}`, `{"id":"id","attrs":{"x":1}}`} {
		if _, err := SetBlockAttrs.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid attributes accepted: %s", body)
		}
	}
	info, err := GetBlockInfo.Decode(strings.NewReader(`{"id":"  id  ","notebook":12,"ids":["a",null,12,"b"],"ignored":true}`))
	if err != nil || info.ID != "id" || info.Notebook != "" || !reflect.DeepEqual(info.IDs, []string{"a", "b"}) {
		t.Fatalf("block request compatibility changed: %+v, %v", info, err)
	}
	if _, err := GetBlockInfo.Decode(strings.NewReader(`{"id":" "}`)); err == nil {
		t.Fatal("whitespace-only ID accepted")
	}
	tag, err := SearchTag.Decode(strings.NewReader(`{"k":"","ignored":true}`))
	if err != nil || tag.K != "" {
		t.Fatalf("empty keyword changed: %+v, %v", tag, err)
	}
}

func TestResponseContracts(t *testing.T) {
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		path, payload string
		valid         bool
	}{
		{"/api/system/version", `{"code":0,"msg":"","data":"3.8.4"}`, true},
		{"/api/system/version", `{"code":0,"msg":"","data":1}`, false},
		{"/api/attr/setBlockAttrs", `{"code":0,"msg":"","data":null}`, true},
		{"/api/attr/getBlockAttrs", `{"code":0,"msg":"","data":{"custom-x":"value"}}`, true},
		{"/api/attr/getBlockAttrs", `{"code":0,"msg":"","data":{"custom-x":1}}`, false},
		{"/api/search/searchTag", `{"code":0,"msg":"","data":{"tags":[],"k":""}}`, true},
		{"/api/search/searchTag", `{"code":0,"msg":"","data":{"tags":null,"k":""}}`, false},
		{"/api/search/searchTag", `{"code":0,"msg":"","data":{"tagz":[],"k":""}}`, false},
		{"/api/search/searchTag", `{"code":-1,"msg":"readonly","data":{"closeTimeout":5000},"cmd":"","reqId":0}`, true},
		{"/api/notebook/lsNotebooks", `{"code":0,"msg":"","data":null}`, true},
		{"/api/history/searchHistory", `{"code":0,"msg":"","data":{"histories":null,"pageCount":0,"totalCount":0}}`, true},
		{"/api/history/searchHistory", `{"code":0,"msg":"","data":{"histories":[123],"pageCount":1,"totalCount":1}}`, false},
		{"/api/block/getBlockInfo", `{"code":3,"msg":"indexing","data":"indexing"}`, true},
		{"/api/block/getBlockInfo", `{"code":0,"msg":"","data":{"rootID":"id","rootTitle":"","rootIcon":"","rootTitleEmpty":true,"publishAccessRequired":true}}`, true},
		{"/api/block/getBlockInfo", `{"code":0,"msg":"","data":{"rootID":"id","rootTitle":"","rootIcon":"","rootTitleEmpty":true,"publishAccessRequired":false}}`, false},
		{"/api/block/getBlockInfo", `{"code":0,"msg":"","data":{"rootID":"id","rootTitle":"","rootIcon":"","rootTitleEmpty":true,"publishAccessRequired":true,"box":"secret"}}`, false},
	} {
		err := bundle.ValidateResponse("POST", test.path, []byte(test.payload))
		if (err == nil) != test.valid {
			t.Errorf("%s %s: valid=%v, error=%v", test.path, test.payload, test.valid, err)
		}
	}
}

type recursiveFixture struct {
	ID       string              `json:"id"`
	Children []*recursiveFixture `json:"children"`
	Flag     *bool               `json:"flag,omitempty"`
	Ignored  string              `json:"-"`
}

type codecFixture string

func (codecFixture) MarshalJSON() ([]byte, error) { return []byte(`{}`), nil }

type embeddedRequestFixture struct {
	Mode string `json:"mode" api:"enum=a|b"`
}

type constrainedRequestFixture struct {
	embeddedRequestFixture
	Enabled bool   `json:"enabled" api:"const=true"`
	Ignored string `json:"-"`
}

func TestEmbeddedRequestConstraints(t *testing.T) {
	endpoint := Endpoint[constrainedRequestFixture, Null]{definition: Definition{Path: "/test", Body: JSONBody}}
	request, err := endpoint.Decode(strings.NewReader(`{"mode":"a","enabled":true,"Ignored":"secret"}`))
	if err != nil || request.Mode != "a" || !request.Enabled || request.Ignored != "" {
		t.Fatalf("embedded request failed: %+v, %v", request, err)
	}
	for _, body := range []string{`{"mode":"c","enabled":true}`, `{"mode":"a","enabled":false}`, `{"enabled":true}`} {
		if _, err := endpoint.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("request constraints bypassed: %s", body)
		}
	}
	builder := &schemaBuilder{definitions: map[string]*Schema{}, owners: map[string]reflect.Type{}}
	schema, err := builder.schema(reflect.TypeFor[constrainedRequestFixture](), true)
	if err != nil {
		t.Fatal(err)
	}
	bundle := &Bundle{Definitions: builder.definitions}
	if err := bundle.validate(schema, map[string]any{"mode": "a", "enabled": true}, "$"); err != nil {
		t.Fatal(err)
	}
	if err := bundle.validate(&Schema{AnyOf: []*Schema{{Type: "string"}, {Type: "null"}}, Enum: []any{"a"}}, "b", "$"); err == nil {
		t.Fatal("union bypassed enum constraint")
	}
}

func TestGeneratorRejectsUnsupportedTypes(t *testing.T) {
	builder := &schemaBuilder{definitions: map[string]*Schema{}, owners: map[string]reflect.Type{}}
	if _, err := builder.schema(reflect.TypeFor[recursiveFixture](), false); err != nil {
		t.Fatal(err)
	}
	if _, err := builder.schema(reflect.TypeFor[recursiveFixture](), true); err != nil {
		t.Fatal(err)
	}
	output := builder.definitions["recursiveFixture"]
	input := builder.definitions["recursiveFixtureInput"]
	if _, exists := output.Properties["Ignored"]; exists {
		t.Fatal("ignored JSON field was generated")
	}
	if output.Properties["flag"].Type != "boolean" || input.Properties["flag"].AnyOf == nil {
		t.Fatal("input and output nullability were conflated")
	}
	for _, typ := range []reflect.Type{reflect.TypeFor[any](), reflect.TypeFor[codecFixture](), reflect.TypeFor[[]byte](), reflect.TypeFor[map[int]string]()} {
		if _, err := builder.schema(typ, false); err == nil {
			t.Fatalf("unsupported type silently accepted: %s", typ)
		}
	}
}

func TestRouteCoverage(t *testing.T) {
	routes, bindings, err := ReadRoutes("../api")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("legacy_routes.json")
	if err != nil {
		t.Fatal(err)
	}
	var legacy []Route
	if err := json.Unmarshal(data, &legacy); err != nil {
		t.Fatal(err)
	}
	if err := CheckRoutes(routes, bindings, legacy); err != nil {
		t.Fatal(err)
	}
	if err := CheckRoutes(append(routes, Route{"POST", "/api/new/untyped", "newHandler"}), bindings, legacy); err == nil {
		t.Fatal("new untyped route was accepted")
	}
	bindings["getBlockAttrs"] = "setBlockAttrs"
	if err := CheckRoutes(routes, bindings, legacy); err == nil {
		t.Fatal("handler bound to the wrong contract was accepted")
	}
}

func TestGeneratedArtifacts(t *testing.T) {
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	declaration, err := os.ReadFile("../../app/src/types/api/index.d.ts")
	if err != nil {
		t.Fatal(err)
	}
	legacyJSON, err := os.ReadFile("legacy_routes.json")
	if err != nil {
		t.Fatal(err)
	}
	var legacy []Route
	if err := json.Unmarshal(legacyJSON, &legacy); err != nil {
		t.Fatal(err)
	}
	if strings.ReplaceAll(string(declaration), "\r\n", "\n") != string(bundle.TypeScript(legacy)) {
		t.Fatal("TypeScript contracts are out of date")
	}
	schema, err := os.ReadFile("schema.json")
	if err != nil {
		t.Fatal(err)
	}
	want, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(strings.ReplaceAll(string(schema), "\r\n", "\n")) != string(want) {
		t.Fatal("JSON schemas are out of date")
	}
}
