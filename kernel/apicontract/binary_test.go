package apicontract

import (
	"encoding/json"
	"testing"
)

func TestBinaryResponseContract(t *testing.T) {
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		status      int
		media, body string
		valid       bool
	}{
		{200, "application/octet-stream", "\x00\xff", true},
		{200, "application/json", `{"arbitrary":[true,null]}`, true},
		{202, "application/json; charset=utf-8", `{"code":404,"msg":"missing","data":null}`, true},
		{202, "application/json", `{"code":0,"msg":"","data":null}`, false},
		{202, "text/plain", `{"code":404,"msg":"missing","data":null}`, false},
		{404, "application/json", `{"code":404,"msg":"missing","data":null}`, false},
		{202, "application/json", `{"code":404,"msg":"missing","data":false}`, false},
	} {
		err := bundle.ValidateHTTPResponse("POST", "/api/file/getFile", entry.status, entry.media, []byte(entry.body))
		if (err == nil) != entry.valid {
			t.Fatalf("unexpected validation: %+v: %v", entry, err)
		}
	}
	response := SuccessBinary("application/octet-stream", []byte{0, 255})
	if GetFile.Status(response) != 200 || response.Binary().Bytes[1] != 255 {
		t.Fatal("binary response changed")
	}
	if _, err := json.Marshal(response); err == nil {
		t.Fatal("raw bytes must not be serialized into a JSON envelope")
	}
	if GetFile.Status(Failure[BinaryContent](404, "missing")) != 202 {
		t.Fatal("file failure status changed")
	}
}
