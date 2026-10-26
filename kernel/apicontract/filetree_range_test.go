package apicontract

import (
	"strings"
	"testing"
)

func TestDocTreeRangeContractInput(t *testing.T) {
	for _, test := range []struct {
		body string
		ok   bool
	}{
		{`{"notebook":"box","parentID":"","offset":0}`, true},
		{`{"notebook":"box","parentID":"","offset":0,"limit":512}`, true},
		{`{"notebook":"box","parentID":"","offset":0,"limit":null}`, false},
		{`{"notebook":"box","parentID":"","offset":0,"limit":1.5}`, false},
		{`{"notebook":"box","parentID":"","offset":0,"limit":"512"}`, false},
		{`{"notebook":"box","parentID":"","offset":null}`, false},
		{`{"notebook":"box","parentID":"","offset":0.5}`, false},
		{`{"notebook":"box","parentID":"","offset":9223372036854775808}`, false},
		{`{"notebook":"box","offset":0}`, false},
	} {
		_, err := ListDocTreeRange.Decode(strings.NewReader(test.body))
		if (err == nil) != test.ok {
			t.Fatalf("%s: %v", test.body, err)
		}
	}
}
