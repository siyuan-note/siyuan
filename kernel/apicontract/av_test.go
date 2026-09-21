package apicontract

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestAVRequestCompatibility(t *testing.T) {
	group, err := SetAttrViewGroup.Decode(strings.NewReader(`{"avID":" av ","blockID":" block ","group":{"FIELD":"key","method":2,"unknown":true},"ignoreRows":"ignored"}`))
	if err != nil || group.AvID != " av " || group.BlockID != " block " || group.Group.Field != "key" || group.Group.Method != 2 || group.IgnoreRows {
		t.Fatalf("group compatibility: %+v %v", group, err)
	}
	filters, err := SetAttrViewFilters.Decode(strings.NewReader(`{"avID":"av","blockID":"block","data":[{"COLUMN":"key","value":{"text":{"content":"a"}}},null]}`))
	if err != nil || len(filters.Data) != 2 || filters.Data[0].Column != "key" || filters.Data[1] != nil {
		t.Fatalf("filter compatibility: %+v %v", filters, err)
	}
	request, err := GetAttributeViewPrimaryKeyValues.Decode(strings.NewReader(`{"id":" av ","page":2.9,"pageSize":-1.9,"blockIDs":["a",null,3,"","b"]}`))
	if err != nil || int(*request.Page) != 2 || int(*request.PageSize) != -1 || !reflect.DeepEqual(request.BlockIDs, []string{"a", "", "b"}) {
		t.Fatalf("pagination compatibility: %+v %v", request, err)
	}
	search, err := SearchAttributeView.Decode(strings.NewReader(`{"keyword":"x","includeViewMatches":23}`))
	if err != nil || search.IncludeViewMatches {
		t.Fatalf("ignored boolean: %+v %v", search, err)
	}
	for _, body := range []string{`{"avID":"a","blockIDs":[null]}`, `{"avID":"a","blockIDs":[1]}`} {
		if _, err := GetAttributeViewItemIDsByBoundIDs.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid ID array accepted: %s", body)
		}
	}
}

func TestAVValuePatchPresence(t *testing.T) {
	for _, patch := range []string{`{}`, `{"text":{}}`, `{"text":{"content":""}}`, `{"text":null}`, `{"TEXT":{"CONTENT":"x"},"unknown":{"keep":true}}`} {
		request, err := SetAttributeViewBlockAttr.Decode(strings.NewReader(`{"avID":"av","keyID":"key","itemID":"item","value":` + patch + `}`))
		if err != nil {
			t.Fatal(err)
		}
		actual, err := json.Marshal(request.Value)
		if err != nil {
			t.Fatal(err)
		}
		var expectedValue, actualValue any
		if err = json.Unmarshal([]byte(patch), &expectedValue); err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(actual, &actualValue); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(expectedValue, actualValue) {
			t.Fatalf("patch changed: %s -> %s", patch, actual)
		}
	}
	request, err := BatchSetAttributeViewBlockAttrs.Decode(strings.NewReader(`{"avID":"av","values":[{"keyID":"key","itemID":"item","value":{"text":{}}},{"keyID":"key","value":null}]}`))
	if err != nil || len(request.Values) != 2 || request.Values[1].Value != nil {
		t.Fatalf("batch null compatibility: %+v %v", request, err)
	}
	encoded, err := json.Marshal(request.Values[0].Value)
	if err != nil || string(encoded) != `{"text":{}}` {
		t.Fatalf("batch patch changed: %s %v", encoded, err)
	}
	if _, err := SetAttributeViewBlockAttr.Decode(strings.NewReader(`{"avID":"av","keyID":"key","value":{"number":{"content":"invalid"}}}`)); err == nil {
		t.Fatal("invalid fixed value structure accepted")
	}
}

func TestAVResponseSchemas(t *testing.T) {
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ path, body string }{
		{"/api/av/getAttributeViewAddingBlockDefaultValues", `{"code":0,"msg":"","data":{"values":{"key":{"text":{"content":"x"}}}}}`},
		{"/api/av/getAttributeViewAddingBlockDefaultValues", `{"code":0,"msg":"","data":{"values":null}}`},
		{"/api/av/renderAttributeView", `{"code":-1,"msg":"missing","data":{"error":"viewNotFound"}}`},
		{"/api/av/createAttributeViewItem", `{"code":1,"msg":"","data":{"unavailableNotebook":true}}`},
		{"/api/av/createAttributeViewItemDocs", `{"code":1,"msg":"","data":{"unavailableNotebook":true}}`},
		{"/api/av/getAttributeViewRowSort", `{"code":0,"msg":"","data":{"conflict":false,"doOperations":[],"undoOperations":[]}}`},
	} {
		if err = bundle.ValidateResponse("POST", test.path, []byte(test.body)); err != nil {
			t.Fatalf("%s: %v", test.path, err)
		}
	}
	if err = bundle.ValidateResponse("POST", "/api/av/getAttributeViewAddingBlockDefaultValues", []byte(`{"code":0,"msg":"","data":{"values":[]}}`)); err == nil {
		t.Fatal("incorrect default values array accepted")
	}
}

func TestAVParsedRequestErrors(t *testing.T) {
	for _, test := range []struct{ body, message string }{
		{`{"avID":null}`, "Field [avID] is required"},
		{`{"avID":1}`, "Field [avID] should be of type [String]"},
		{`{"avID":"a","blockID":"b","saveMode":"subDoc","itemIDs":{}}`, "Field [itemIDs] should be of type [Array]"},
	} {
		_, err := CreateAttributeViewItemDocs.Decode(strings.NewReader(test.body))
		if err == nil || err.Error() != test.message {
			t.Fatalf("parsed field response: %s %v", test.body, err)
		}
	}
	row, err := GetAttributeViewRowSort.Decode(strings.NewReader(`{"AVID":" av ","ITEMIDS":[null,"x"]}`))
	if err != nil || row.AvID != " av " || !reflect.DeepEqual(row.ItemIDs, []string{"", "x"}) {
		t.Fatalf("row struct binding: %+v %v", row, err)
	}
	if _, err = GetAttributeViewRowSort.Decode(strings.NewReader("{")); err == nil || err.Error() != "unexpected EOF" {
		t.Fatalf("row parse error changed: %v", err)
	}
	keys, err := GetAttributeViewKeysByID.Decode(strings.NewReader(`{"avID":"av","keyIDs":[null]}`))
	if err != nil || keys.KeyIDsError == nil {
		t.Fatalf("key ID validation was not deferred: %+v %v", keys, err)
	}
}

func TestAVContractCalendarCreateRequest(t *testing.T) {
	for _, test := range []struct {
		name, field string
		want        int64
		present     bool
	}{
		{"omitted", "", 0, false},
		{"null", `,"calendarDate":null`, 0, false},
		{"epoch", `,"calendarDate":0`, 0, true},
		{"beforeEpoch", `,"calendarDate":-86400000`, -86400000, true},
		{"selectedDay", `,"calendarDate":1790006400000`, 1790006400000, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			request, err := CreateAttributeViewItem.Decode(strings.NewReader(`{"avID":" av ","blockID":"block","viewID":"calendar","templateID":"template"` + test.field + `}`))
			if err != nil {
				t.Fatal(err)
			}
			if (request.CalendarDate != nil) != test.present || test.present && *request.CalendarDate != test.want {
				t.Fatalf("unexpected calendar date: %+v", request.CalendarDate)
			}
			if request.AvID != " av " || request.BlockID != "block" || request.ViewID != "calendar" || request.TemplateID != "template" {
				t.Fatalf("creation fields changed: %+v", request)
			}
		})
	}
	for _, value := range []string{`"1790006400000"`, `true`, `{}`, `[]`, `1.5`, `9223372036854775808`} {
		if _, err := CreateAttributeViewItem.Decode(strings.NewReader(`{"avID":"av","blockID":"block","calendarDate":` + value + `}`)); err == nil {
			t.Fatalf("invalid calendar date accepted: %s", value)
		}
	}
}
