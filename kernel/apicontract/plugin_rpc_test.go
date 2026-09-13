package apicontract

import (
	"encoding/json"
	"testing"
)

func TestPluginRPCResponseSchema(t *testing.T) {
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		body  string
		valid bool
	}{
		{`{"jsonrpc":"2.0","result":{"arbitrary":[1,true,null]},"id":"id"}`, true},
		{`{"jsonrpc":"2.0","error":{"code":-32600,"message":"invalid","data":false},"id":null}`, true},
		{`[{"jsonrpc":"2.0","result":null,"id":1},{"jsonrpc":"2.0","error":{"code":-32601,"message":"missing"},"id":2}]`, true},
		{`[]`, false}, {`null`, false},
		{`{"jsonrpc":"2.0","result":1,"id":false}`, false},
		{`{"jsonrpc":"1.0","result":1,"id":1}`, false},
		{`{"jsonrpc":"2.0","result":1,"error":{"code":-1,"message":"invalid"},"id":1}`, false},
		{`{"code":0,"msg":"","data":{"jsonrpc":"2.0","result":1,"id":1}}`, false},
		{`{"code":-1,"msg":"readonly","data":{"closeTimeout":5000}}`, true},
	} {
		err := bundle.ValidateHTTPResponse("POST", "/api/plugin/rpc", 200, "application/json", []byte(entry.body))
		if (err == nil) != entry.valid {
			t.Fatalf("RPC schema result changed for %s: %v", entry.body, err)
		}
	}
	if _, err := json.Marshal(RPCBatchResponse(nil)); err == nil {
		t.Fatal("empty RPC response array accepted")
	}
	if _, err := json.Marshal(PluginRPCReply{}); err == nil {
		t.Fatal("empty RPC reply accepted")
	}
}

func TestEncodedJSONValuePreservesNumbers(t *testing.T) {
	data := []byte(`{"n":9223372036854775807}`)
	value, err := EncodedJSONValue(data)
	if err != nil {
		t.Fatal(err)
	}
	data[2] = 'x'
	actual, err := json.Marshal(value)
	if err != nil || string(actual) != `{"n":9223372036854775807}` {
		t.Fatalf("encoded JSON precision or ownership changed: %s, %v", actual, err)
	}
	if _, err := EncodedJSONValue([]byte("invalid")); err == nil {
		t.Fatal("invalid encoded JSON accepted")
	}
}
