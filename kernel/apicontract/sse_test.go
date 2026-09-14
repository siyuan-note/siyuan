package apicontract

import (
	"net/http"
	"reflect"
	"testing"
)

type sseTestToken struct {
	Token string `json:"token"`
}

func TestSSEDeclaredEvents(t *testing.T) {
	builder := &schemaBuilder{definitions: map[string]*Schema{}, owners: map[string]reflect.Type{}}
	options := SSEOptions(SSEEvent[sseTestToken]("content"), SSEEvent[sseTestToken](""))
	schema, err := builder.sseSchema(options.SSE)
	if err != nil {
		t.Fatal(err)
	}
	bundle := &Bundle{Definitions: builder.definitions, Endpoints: []EndpointSchema{{Method: "POST", Path: "/events", SSE: schema}}}
	for _, name := range []string{"content", ""} {
		if err = bundle.ValidateSSEEvent("POST", "/events", name, []byte(`{"token":"text"}`)); err != nil {
			t.Fatal(err)
		}
	}
	for _, body := range []string{`{}`, `{"token":1}`, `null`, `[]`} {
		if err = bundle.ValidateSSEEvent("POST", "/events", "content", []byte(body)); err == nil {
			t.Fatalf("invalid event accepted: %s", body)
		}
	}
	if err = bundle.ValidateSSEEvent("POST", "/events", "other", []byte(`{"token":"text"}`)); err == nil {
		t.Fatal("undeclared event accepted")
	}
	if _, err = builder.sseSchema(&SSEDefinition{Events: []SSEEventDefinition{SSEEvent[sseTestToken]("x"), SSEEvent[sseTestToken]("x")}}); err == nil {
		t.Fatal("duplicate event accepted")
	}
	if _, err = builder.sseSchema(&SSEDefinition{}); err == nil {
		t.Fatal("empty event set accepted")
	}
}

func TestSSEStreamResponse(t *testing.T) {
	endpoint := Endpoint[EmptyRequest, Null]{definition: Definition{Output: SSEOutput, SSE: SSEOptions(SSEEvent[sseTestToken]("content")).SSE, AdditionalErrorStatuses: []int{409}}}
	stream := StreamSSE[Null](func(http.ResponseWriter, *http.Request) {})
	if endpoint.Status(stream) != 200 || stream.Stream() == nil {
		t.Fatal("missing stream lifecycle")
	}
	if _, err := stream.MarshalJSON(); err == nil {
		t.Fatal("stream serialized as an envelope")
	}
	if endpoint.Status(endpoint.WithHTTPStatus(Failure[Null](-1, "busy"), 409)) != 409 {
		t.Fatal("SSE admission status changed")
	}
	defer func() {
		if recover() == nil {
			t.Fatal("undeclared stream accepted")
		}
	}()
	Endpoint[EmptyRequest, Null]{}.Status(stream)
}

func TestSSEHTTPResponseKinds(t *testing.T) {
	previous := definitions
	t.Cleanup(func() { definitions = previous })
	options := SSEOptions(SSEEvent[sseTestToken]("content"))
	options.AdditionalErrorStatuses = []int{409}
	define[EmptyRequest, Null]("events", "/test/events", NoBody, options, "POST")
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		status int
		media  string
		body   string
		valid  bool
	}{
		{200, "text/event-stream; charset=utf-8", "event: content\ndata: {\"token\":\"text\"}\n\n", true},
		{200, "text/event-stream-invalid", "", false},
		{201, "text/event-stream", "", false},
		{200, "application/json", `{"code":-1,"msg":"invalid","data":null}`, true},
		{409, "application/json", `{"code":-1,"msg":"busy","data":null}`, true},
		{400, "application/json", `{"code":-1,"msg":"invalid","data":null}`, false},
		{200, "application/json", `{"code":0,"msg":"","data":null}`, false},
	} {
		if err := bundle.ValidateHTTPResponse("POST", "/test/events", test.status, test.media, []byte(test.body)); (err == nil) != test.valid {
			t.Fatalf("%d %s: %v", test.status, test.media, err)
		}
	}
}
