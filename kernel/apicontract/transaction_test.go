package apicontract

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTransactionRequestCompatibility(t *testing.T) {
	for _, fixture := range []struct{ body, message string }{
		{`{}`, "Field [transactions] is required"},
		{`{"transactions":[]}`, "Field [transactions] must not be empty"},
		{`{"transactions":null}`, "Field [transactions] is required"},
		{`{"transactions":[{}]}`, "Field [reqId] is required"},
		{`{"transactions":[{}],"reqId":1,"app":false}`, "Field [app] should be of type [String]"},
	} {
		_, err := PerformTransactions.Decode(strings.NewReader(fixture.body))
		if err == nil || err.Error() != fixture.message {
			t.Fatalf("%s: %v", fixture.body, err)
		}
	}
	for _, body := range []string{
		`{"transactions":[{"doOperations":[{"action":"updateAttrViewCell","data":{"text":null}}]}],"reqId":1.9,"app":" app "}`,
		`{"transactions":[{"doOperations":[{"action":"setAttrViewPageSize","data":"invalid"}]}],"reqId":1}`,
		`{"transactions":[{"doOperations":[{"action":"plugin-custom","data":{"extension":[true,1,null]}}]}],"reqId":1}`,
	} {
		request, err := PerformTransactions.Decode(strings.NewReader(body))
		if err != nil || request.DecodeError != nil {
			t.Fatalf("deferred operation binding: %s %v %v", body, err, request.DecodeError)
		}
	}
	request, err := PerformTransactions.Decode(strings.NewReader(`{"transactions":[{"timestamp":1.2}],"reqId":1}`))
	if err != nil || request.DecodeError == nil {
		t.Fatalf("struct error must remain deferred until boot admission: %v %v", err, request.DecodeError)
	}
	request, err = PerformTransactions.Decode(strings.NewReader(`{"transactions":[{"timestamp":1e3}],"reqId":1}`))
	if err != nil || request.DecodeError != nil || request.Transactions[0].Timestamp != 1000 {
		t.Fatalf("numeric normalization: %+v %v", request, err)
	}
	history, err := PerformUndo.Decode(strings.NewReader(`{"rootID":" root ","app":" app ","session":" session "}`))
	if err != nil || history.RootID != " root " || history.App != " app " || history.Session != " session " {
		t.Fatalf("history whitespace: %+v %v", history, err)
	}
}

func TestTransactionFiniteActionSchemas(t *testing.T) {
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, fixture := range []struct{ action, data string }{
		{"update", `"<div>content</div>"`},
		{"append", `"<div>content</div>"`},
		{"move", `"<div>content</div>"`},
		{"swapBlockRef", `{"includeChildren":true,"originalToEmbed":false}`},
		{"unfoldHeading", `"remove"`},
		{"sortAttrViewView", `"unRefresh"`},
		{"updateAttrViewCell", `{"text":null}`},
		{"setAttrViewFilters", `[{"column":"key","value":{"text":{"content":"x"}}}]`},
		{"sortAttrViewRow", `null`},
		{"plugin-custom", `{"extension":[true,1,null]}`},
	} {
		var operation TransactionOperation
		if err = json.Unmarshal([]byte(`{"action":"`+fixture.action+`","data":`+fixture.data+`}`), &operation); err != nil {
			t.Fatal(err)
		}
		payload, err := json.Marshal(Success([]*Transaction{{DoOperations: []*TransactionOperation{&operation}}}))
		if err != nil {
			t.Fatal(err)
		}
		if err = bundle.ValidateResponse("POST", "/api/transactions", payload); err != nil {
			t.Fatalf("%s: %v", fixture.action, err)
		}
	}
	var invalid TransactionOperation
	_ = json.Unmarshal([]byte(`{"action":"setAttrViewPageSize","data":"invalid"}`), &invalid)
	payload, _ := json.Marshal(Success([]*Transaction{{DoOperations: []*TransactionOperation{&invalid}}}))
	if err = bundle.ValidateResponse("POST", "/api/transactions", payload); err == nil {
		t.Fatal("unknown-action branch must not swallow a known action's invalid data")
	}
	for _, result := range []TransactionHistoryResult{EmptyTransactionHistory(), FailedTransactionHistory("undo failed: test"), AppliedTransactionHistory(TransactionHistoryApplied{IsUndo: true})} {
		payload, _ := json.Marshal(Success(result))
		if err = bundle.ValidateResponse("POST", "/api/transactions/undo", payload); err != nil {
			t.Fatal(err)
		}
	}
}
