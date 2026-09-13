package apicontract

import "testing"

func TestBinarySharedStatusErrors(t *testing.T) {
	previous := definitions
	t.Cleanup(func() { definitions = previous })
	endpoint := define[EmptyRequest, BinaryContent]("sharedBinaryStatus", "/test/shared-binary-status", NoBody, ResponseOptions{Output: BinaryOutput, ErrorStatus: 200}, "POST")
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	if endpoint.Status(Failure[BinaryContent](-1, "missing")) != 200 {
		t.Fatal("binary error status changed")
	}
	// 文件可以包含任意字节，已知业务失败需要使用独立的错误载荷校验。
	if err := bundle.ValidateHTTPResponse("POST", "/test/shared-binary-status", 200, "application/json", []byte(`file data`)); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		body  string
		valid bool
	}{
		{`{"code":-1,"msg":"missing","data":null}`, true},
		{`{"code":-1,"msg":"locked","data":{"closeTimeout":5000}}`, true},
		{`{"code":0,"msg":"","data":null}`, false},
		{`{"code":-1,"msg":"missing","data":{"unknown":true}}`, false},
	} {
		err := bundle.ValidateErrorResponse("POST", "/test/shared-binary-status", []byte(entry.body))
		if (err == nil) != entry.valid {
			t.Fatalf("error payload mismatch: %+v, %v", entry, err)
		}
	}
}
