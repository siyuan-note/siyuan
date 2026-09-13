package apicontract

import "testing"

func TestAdditionalJSONErrorStatus(t *testing.T) {
	previous := definitions
	t.Cleanup(func() { definitions = previous })
	endpoint := define[EmptyRequest, Null]("throttled", "/test/throttled", NoBody, ResponseOptions{AdditionalErrorStatuses: []int{429}}, "POST")
	response := endpoint.WithHTTPStatus(Failure[Null](-1, "rate limited"), 429)
	if endpoint.Status(response) != 429 {
		t.Fatal("error status changed")
	}
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		status int
		body   string
		valid  bool
	}{
		{429, `{"code":-1,"msg":"limited","data":null}`, true},
		{200, `{"code":-1,"msg":"denied","data":null}`, true},
		{200, `{"code":0,"msg":"","data":null}`, true},
		{429, `{"code":0,"msg":"","data":null}`, false},
		{403, `{"code":-1,"msg":"denied","data":null}`, false},
	} {
		err := bundle.ValidateHTTPResponse("POST", "/test/throttled", entry.status, "application/json", []byte(entry.body))
		if (err == nil) != entry.valid {
			t.Fatalf("status validation mismatch: %+v, %v", entry, err)
		}
	}
	for _, run := range []func(){
		func() { endpoint.WithHTTPStatus(Success(Null{}), 429) },
		func() { endpoint.WithHTTPStatus(Failure[Null](-1, "denied"), 403) },
		func() { RemoveNotebook.Status(endpoint.WithHTTPStatus(Failure[Null](-1, "denied"), 429)) },
	} {
		func() {
			defer func() {
				if recover() == nil {
					t.Error("undeclared status did not panic")
				}
			}()
			run()
		}()
	}
}
