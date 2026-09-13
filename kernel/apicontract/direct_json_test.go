package apicontract

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

type directJSONTestResult struct {
	JSONRPC string `json:"jsonrpc" api:"const=\"2.0\""`
	Result  string `json:"result"`
	ID      int    `json:"id"`
}

func TestDirectJSONHTTPResponses(t *testing.T) {
	previous := definitions
	t.Cleanup(func() { definitions = previous })
	endpoint := define[EmptyRequest, directJSONTestResult]("directJSONTest", "/test/direct-json", NoBody, ResponseOptions{Output: DirectJSONOutput, NoContent: true}, "POST")
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	result := directJSONTestResult{JSONRPC: "2.0", Result: "value", ID: 1}
	response := SuccessDirectJSON(result)
	payload, err := json.Marshal(response)
	if err != nil || string(payload) != `{"jsonrpc":"2.0","result":"value","id":1}` || endpoint.Status(response) != 200 {
		t.Fatalf("direct JSON was wrapped: %s, %v", payload, err)
	}
	if err := bundle.ValidateHTTPResponse("POST", "/test/direct-json", 200, "application/json", payload); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		status      int
		media, body string
		valid       bool
	}{
		{204, "", "", true},
		{204, "application/json", "null", false},
		{200, "application/json", `{"jsonrpc":"2.0","result":"value","id":1}`, true},
		{200, "application/json", `{"jsonrpc":"1.0","result":"value","id":1}`, false},
		{200, "application/json", `{"code":0,"msg":"","data":{"jsonrpc":"2.0","result":"value","id":1}}`, false},
		{200, "application/json", `{"code":-1,"msg":"denied","data":null}`, true},
		{200, "application/json", `{"code":-1,"msg":"readonly","data":{"closeTimeout":5000}}`, true},
		{200, "text/plain", `{"jsonrpc":"2.0","result":"value","id":1}`, false},
		{201, "application/json", `{"jsonrpc":"2.0","result":"value","id":1}`, false},
	} {
		err := bundle.ValidateHTTPResponse("POST", "/test/direct-json", entry.status, entry.media, []byte(entry.body))
		if (err == nil) != entry.valid {
			t.Fatalf("unexpected HTTP validation: %+v, %v", entry, err)
		}
	}
	if endpoint.Status(SuccessNoContent[directJSONTestResult]()) != 204 {
		t.Fatal("notification must return HTTP 204")
	}
	if _, err := json.Marshal(SuccessNoContent[directJSONTestResult]()); err == nil {
		t.Fatal("empty response was serialized")
	}
	declarations := string(bundle.TypeScript(nil))
	if !strings.Contains(declarations, `output: "directJSON"`) || !strings.Contains(declarations, "noContent: true") {
		t.Fatal("direct JSON protocol metadata missing")
	}
}

func TestDirectJSONOutputGuards(t *testing.T) {
	ordinary := Endpoint[EmptyRequest, directJSONTestResult]{definition: Definition{Data: reflect.TypeFor[directJSONTestResult]()}}
	direct := ordinary
	direct.definition.Output = DirectJSONOutput
	for _, call := range []func(){
		func() { ordinary.Status(SuccessDirectJSON(directJSONTestResult{})) },
		func() { ordinary.Status(SuccessNoContent[directJSONTestResult]()) },
		func() { direct.Status(SuccessNoContent[directJSONTestResult]()) },
		func() { direct.Status(Success(directJSONTestResult{})) },
	} {
		func() {
			defer func() {
				if recover() == nil {
					t.Error("undeclared protocol output was accepted")
				}
			}()
			call()
		}()
	}
}
