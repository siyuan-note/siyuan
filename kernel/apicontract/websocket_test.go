package apicontract

import "testing"

func TestWebSocketContractValidation(t *testing.T) {
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		incoming bool
		body     string
		valid    bool
	}{
		{true, `{"jsonrpc":"2.0","method":"call","id":1}`, true},
		{true, `[]`, false},
		{true, `{"jsonrpc":"2.0","result":null,"id":1}`, false},
		{false, `{"jsonrpc":"2.0","result":null,"id":1}`, true},
		{false, `{"jsonrpc":"2.0","method":"event","params":null}`, true},
		{false, `{"jsonrpc":"2.0","method":"event","id":1}`, false},
		{false, `{"code":-1,"msg":"denied","data":null}`, false},
		{false, `[]`, false},
	} {
		err := bundle.ValidateWebSocketMessage("GET", "/ws/plugin/rpc", entry.incoming, []byte(entry.body))
		if (err == nil) != entry.valid {
			t.Fatalf("message validation mismatch: %+v, %v", entry, err)
		}
	}
	for _, entry := range []struct {
		status      int
		media, body string
		valid       bool
	}{
		{101, "", "", true},
		{101, "application/json", `{}`, false},
		{400, "text/plain; charset=utf-8", "bad request", true},
		{404, "application/json", `{"jsonrpc":"2.0","error":{"code":-32001,"message":"Plugin not loaded"},"id":null}`, true},
		{200, "application/json", `{"code":-1,"msg":"denied","data":null}`, true},
		{200, "application/json", `{"jsonrpc":"2.0","error":{"code":-32001,"message":"Plugin not loaded"},"id":null}`, false},
	} {
		err := bundle.ValidateHTTPResponse("GET", "/ws/plugin/rpc", entry.status, entry.media, []byte(entry.body))
		if (err == nil) != entry.valid {
			t.Fatalf("handshake validation mismatch: %+v, %v", entry, err)
		}
	}
}
