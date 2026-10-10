package apicontract

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAVMapUnplacedContract(t *testing.T) {
	for _, body := range []string{
		`{"id":"av","viewID":"view"}`,
		`{"id":"av","viewID":"view","blockID":null,"query":null,"search":null,"page":null,"pageSize":null}`,
		`{"id":"av","viewID":"view","blockID":"block","query":"all","search":"title","page":2.9,"pageSize":50}`,
	} {
		if _, err := GetAttributeViewMapUnplaced.Decode(strings.NewReader(body)); err != nil {
			t.Fatalf("valid unplaced request rejected: %s: %v", body, err)
		}
	}
	for _, body := range []string{
		`{"id":"av"}`, `{"viewID":"view"}`, `{"id":"av","viewID":null}`,
		`{"id":"av","viewID":"view","page":"2"}`, `{"id":"av","viewID":"view","search":false}`,
	} {
		if _, err := GetAttributeViewMapUnplaced.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid unplaced request accepted: %s", body)
		}
	}
	for _, definition := range Definitions() {
		if definition.Path == "/api/av/getAttributeViewMapUnplaced" {
			if definition.Authorization != AuthenticatedAccess|AdminAccess|WritableAccess {
				t.Fatal("map unplaced query no longer matches calendar undated permissions")
			}
			return
		}
	}
	t.Fatal("map unplaced endpoint is not registered")
}

func TestAVMapTransactionContract(t *testing.T) {
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		data  string
		valid bool
	}{
		{`{"locationKeyID":"20261009000000-abcdefg"}`, true},
		{`{"locationKeyID":""}`, true},
		{`{}`, false},
		{`{"locationKeyID":false}`, false},
		{`{"serviceID":"","locationKeyID":""}`, false},
		{`{"locationKeyID":"","showRecordList":true}`, false},
		{`{"locationKeyID":"","showRecordList":false}`, false},
		{`{"serviceID":"","locationKeyID":"","showRecordList":true,"apiKey":"secret"}`, false},
	} {
		var operation TransactionOperation
		if err := json.Unmarshal([]byte(`{"action":"setAttrViewMap","data":`+test.data+`}`), &operation); err != nil {
			t.Fatal(err)
		}
		payload, err := json.Marshal(Success([]*Transaction{{DoOperations: []*TransactionOperation{&operation}}}))
		if err != nil {
			t.Fatal(err)
		}
		if err = bundle.ValidateResponse("POST", "/api/transactions", payload); (err == nil) != test.valid {
			t.Fatalf("map transaction data %s, error %v", test.data, err)
		}
	}
}
