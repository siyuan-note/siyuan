package apicontract

import (
	"encoding/json"
	"testing"
)

func TestHTTPContentVariants(t *testing.T) {
	previous := definitions
	t.Cleanup(func() { definitions = previous })
	endpoint := define[EmptyRequest, BinaryContent]("page", "/test/page", NoBody, HTTPContentOptions(
		HTTPContentVariant{200, "text/html"}, HTTPContentVariant{400, "text/html"}, HTTPContentVariant{403, "text/plain"}), "GET")
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		status  int
		media   string
		payload string
		valid   bool
	}{
		{200, "text/html; charset=utf-8", "<p>ok</p>", true},
		{400, "text/html", "<p>invalid</p>", true},
		{403, "text/plain; charset=utf-8", "forbidden", true},
		{400, "text/plain", "invalid", false},
		{201, "text/html", "<p>ok</p>", false},
		{200, "image/png", "content", false},
		{200, "application/json", `{"code":-1,"msg":"denied","data":null}`, true},
		{200, "application/json", `{"code":0,"msg":"","data":null}`, false},
	} {
		err := bundle.ValidateHTTPResponse("GET", "/test/page", test.status, test.media, []byte(test.payload))
		if (err == nil) != test.valid {
			t.Fatalf("%d %s: %v", test.status, test.media, err)
		}
	}
	response := SuccessHTTPContent(400, "text/html; charset=utf-8", []byte("<p>invalid</p>"))
	if endpoint.Status(response) != 400 || string(response.Binary().Bytes) != "<p>invalid</p>" {
		t.Fatal("raw response changed")
	}
	if _, err := json.Marshal(response); err == nil {
		t.Fatal("raw response encoded as JSON")
	}
	t.Run("undeclared status", func(t *testing.T) {
		defer func() {
			if recover() == nil {
				t.Fatal("undeclared status accepted")
			}
		}()
		endpoint.Status(SuccessHTTPContent(500, "text/html", nil))
	})
}

func TestHTTPContentDeclarations(t *testing.T) {
	previous := definitions
	t.Cleanup(func() { definitions = previous })
	for _, variants := range [][]HTTPContentVariant{
		{{200, "text/html"}, {200, "text/html"}},
		{{204, "text/html"}},
		{{101, "text/html"}},
		{{200, "text/html; charset=utf-8"}},
		{{200, "invalid"}},
	} {
		definitions = previous
		define[EmptyRequest, BinaryContent]("invalidPage", "/test/page", NoBody, HTTPContentOptions(variants...), "GET")
		if _, err := BuildBundle(); err == nil {
			t.Fatalf("invalid variants accepted: %+v", variants)
		}
	}
}
