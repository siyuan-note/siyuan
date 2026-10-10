package apicontract

import (
	"encoding/json"
	"testing"
)

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
