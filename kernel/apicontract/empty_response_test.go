package apicontract

import (
	"encoding/json"
	"testing"
)

func TestEmptyHTTPResponse(t *testing.T) {
	previous := definitions
	t.Cleanup(func() { definitions = previous })
	endpoint := define[EmptyRequest, string]("optionalBody", "/test/empty", NoBody, ResponseOptions{EmptyResponseStatuses: []int{200, 403}}, "GET")
	image := define[EmptyRequest, BinaryContent]("optionalImage", "/test/image", NoBody, ResponseOptions{Output: BinaryOutput, ErrorStatus: 200,
		ContentVariants: []HTTPContentVariant{{200, "image/png"}}, EmptyResponseStatuses: []int{500}}, "GET")
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, status := range []int{200, 403} {
		response := EmptyHTTPResponse[string](status)
		if !response.Empty() || endpoint.Status(response) != status {
			t.Fatal("empty response changed")
		}
		if _, err := json.Marshal(response); err == nil {
			t.Fatal("empty response encoded as JSON")
		}
		if err := bundle.ValidateHTTPResponse("GET", "/test/empty", status, "", nil); err != nil {
			t.Fatal(err)
		}
		if err := bundle.ValidateHTTPResponse("GET", "/test/empty", status, "", []byte("body")); err == nil {
			t.Fatal("undeclared text accepted")
		}
	}
	for _, response := range []Response[string]{Success("value"), Failure[string](-1, "failed")} {
		payload, _ := json.Marshal(response)
		if err := bundle.ValidateHTTPResponse("GET", "/test/empty", 200, "application/json", payload); err != nil {
			t.Fatal(err)
		}
	}
	if image.Status(EmptyHTTPResponse[BinaryContent](500)) != 500 {
		t.Fatal("image failure status changed")
	}
	if err := bundle.ValidateHTTPResponse("GET", "/test/image", 500, "", nil); err != nil {
		t.Fatal(err)
	}
	if err := bundle.ValidateHTTPResponse("GET", "/test/image", 500, "image/png", []byte("invalid")); err == nil {
		t.Fatal("image failure accepted a body")
	}
	t.Run("undeclared status", func(t *testing.T) {
		defer func() {
			if recover() == nil {
				t.Fatal("undeclared status accepted")
			}
		}()
		endpoint.Status(EmptyHTTPResponse[string](500))
	})
}

func TestHTTPRedirectResponse(t *testing.T) {
	previous := definitions
	t.Cleanup(func() { definitions = previous })
	endpoint := define[EmptyRequest, BinaryContent]("redirect", "/test/redirect", NoBody,
		HTTPContentOptions(HTTPContentVariant{302, "text/html"}), "GET")
	response := RedirectHTTPContent(302, "/target?value=one&other=two")
	if endpoint.Status(response) != 302 || response.Redirect().Location != "/target?value=one&other=two" {
		t.Fatal("redirect changed")
	}
	if _, err := json.Marshal(response); err == nil {
		t.Fatal("redirect encoded as JSON")
	}
	t.Run("undeclared status", func(t *testing.T) {
		defer func() {
			if recover() == nil {
				t.Fatal("undeclared redirect accepted")
			}
		}()
		endpoint.Status(RedirectHTTPContent(301, "/target"))
	})
}

func TestEmptyHTTPResponseDeclaration(t *testing.T) {
	previous := definitions
	t.Cleanup(func() { definitions = previous })
	for _, status := range []int{0, 101, 199, 600} {
		definitions = previous
		define[EmptyRequest, Null]("empty", "/test/empty", NoBody, ResponseOptions{EmptyResponseStatuses: []int{status}}, "GET")
		if _, err := BuildBundle(); err == nil {
			t.Fatalf("invalid empty status accepted: %d", status)
		}
	}
}
