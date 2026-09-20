package apicontract

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDuplicateDocTreeContract(t *testing.T) {
	const id = "20260919020000-source1"
	request, err := DuplicateDocTree.Decode(strings.NewReader(`{"id":"` + id + `"}`))
	if err != nil || request.ID != id {
		t.Fatalf("valid document ID rejected: %+v %v", request, err)
	}
	for _, body := range []string{`{}`, `{"id":null}`, `{"id":false}`, `{"id":["` + id + `"]}`} {
		if _, err := DuplicateDocTree.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid input accepted: %s", body)
		}
	}
	legacy, err := DuplicateDoc.Decode(strings.NewReader(`{"id":"` + id + `"}`))
	if err != nil || legacy.ID != id {
		t.Fatalf("single-document copy contract changed: %+v %v", legacy, err)
	}
}

func TestFileTreeLegacyJSONNumbers(t *testing.T) {
	request, err := GetDoc.Decode(strings.NewReader(`{"id":"20260913000000-abcdefg","index":9007199254740993}`))
	if err != nil {
		t.Fatal(err)
	}
	options, err := request.Options()
	if err != nil || options.Index != 9007199254740992 {
		t.Fatalf("legacy number precision changed: %+v %v", options, err)
	}
	_, err = GetDoc.Decode(strings.NewReader(`{"id":"20260913000000-abcdefg","unused":1e400}`))
	if err == nil || !strings.Contains(err.Error(), "float64") {
		t.Fatalf("overflow in an unknown field was accepted: %v", err)
	}
}

func TestFileTreeConditionalInputs(t *testing.T) {
	for _, body := range []string{`{}`, `{"path":null,"notebook":12}`, `{"notebook":null,"path":false}`, `{"notebook":false}`} {
		value, err := GetIDsByHPath.Decode(strings.NewReader(body))
		if err != nil || value.Path != nil || value.Notebook != nil {
			t.Fatalf("missing path/notebook no-op changed: %+v %v", value, err)
		}
	}
	value, err := RenameDocByID.Decode(strings.NewReader(`{"title":false}`))
	if err != nil || value.ID != nil {
		t.Fatalf("missing rename ID no-op changed: %+v %v", value, err)
	}
	for _, body := range []string{`{"id":"20260913000000-abcdefg","startID":false}`, `{"id":"20260913000000-abcdefg","endID":12}`, `{"id":"20260913000000-abcdefg","startID":false,"endID":null}`} {
		request, err := GetDoc.Decode(strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		options, err := request.Options()
		if err != nil || options.StartID != nil || options.EndID != nil {
			t.Fatalf("partial load range changed: %+v %v", options, err)
		}
	}
	request, err := GetDoc.Decode(strings.NewReader(`{"id":" 20260913000000-abcdefg ","notebook":false,"includeDocInfo":"ignored","index":2.9,"querySubTypes":{"heading":{"h1":true,"h2":"ignored"},"legacy":true}}`))
	if err != nil || request.ID != "20260913000000-abcdefg" || request.Notebook != "" {
		t.Fatalf("document admission parameters changed: %+v %v", request, err)
	}
	options, err := request.Options()
	if err != nil || options.IncludeDocInfo || int(options.Index) != 2 || !options.QuerySubTypes.Selected()["h1"] || options.QuerySubTypes.Selected()["h2"] {
		t.Fatalf("document query options changed: %+v %v", options, err)
	}
}

func TestFileTreeAdmissionBeforeDetails(t *testing.T) {
	request, err := ListDocTree.Decode(strings.NewReader(`{"notebook":"20260913000000-abcdefg","path":false}`))
	if err != nil || request.PathError() == nil {
		t.Fatalf("directory details were validated before notebook admission: %+v %v", request, err)
	}
	doc, err := GetDoc.Decode(strings.NewReader(`{"id":"20260913000000-abcdefg","index":false}`))
	if err != nil {
		t.Fatalf("document options validated before lease: %v", err)
	}
	if _, err := doc.Options(); err == nil {
		t.Fatal("invalid admitted document options accepted")
	}
	list, err := ListDocsByPath.Decode(strings.NewReader(`{"notebook":"box","path":"/","sort":false}`))
	if err != nil {
		t.Fatalf("list options validated before encrypted publish check: %v", err)
	}
	if _, err := list.Options(); err == nil {
		t.Fatal("invalid admitted sort accepted")
	}
	publish, err := SetPublishAccess.Decode(strings.NewReader(`{"id":"target","visible":false}`))
	if err != nil {
		t.Fatalf("publish details validated before target admission: %v", err)
	}
	if _, err := publish.Options(); err == nil {
		t.Fatal("missing publish options accepted")
	}
	heading, err := Heading2Doc.Decode(strings.NewReader(`{"srcHeadingID":"source","targetNoteBook":"target","toTop":"wrong"}`))
	if err != nil {
		t.Fatalf("conversion options validated before encrypted isolation: %v", err)
	}
	if _, err := heading.Options(); err == nil {
		t.Fatal("invalid admitted conversion option accepted")
	}
}

func TestFileTreeHintAndDailyNoteConditions(t *testing.T) {
	list, err := ListDocsByPath.Decode(strings.NewReader(`{"notebook":"box","path":"/","ignoreMaxListHint":true,"app":false}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := list.Options(); err != nil {
		t.Fatalf("hint options validated before truncation: %v", err)
	}
	ignore, app, err := list.HintOptions()
	if err != nil || !ignore || app != "" {
		t.Fatalf("ignored hint app was decoded: %v %s %v", ignore, app, err)
	}
	daily, err := CreateDailyNote.Decode(strings.NewReader(`{"notebook":"box","app":false}`))
	if err != nil {
		t.Fatalf("event app was validated before daily note creation: %v", err)
	}
	if _, err := daily.AppID(); err == nil {
		t.Fatal("invalid created-note app accepted")
	}
}

func TestFileTreeSortModeNullableAndInteger(t *testing.T) {
	for _, entry := range []struct {
		body  string
		valid bool
		value *int
	}{
		{`{"id":"id"}`, false, nil}, {`{"id":"id","sortMode":null}`, true, nil},
		{`{"id":"id","sortMode":1.0}`, false, nil}, {`{"id":"id","sortMode":true}`, false, nil},
	} {
		request, err := SetDocSortMode.Decode(strings.NewReader(entry.body))
		if err != nil {
			t.Fatal(err)
		}
		value, err := request.Mode()
		if (err == nil) != entry.valid || (entry.valid && value != nil) {
			t.Fatalf("sort mode behavior changed: %v %v", value, err)
		}
	}
	request, err := SetDocSortMode.Decode(strings.NewReader(`{"ID":"id","SORTMODE":3}`))
	if err != nil || request.ID != "id" {
		t.Fatal(err)
	}
	value, err := request.Mode()
	if err != nil || value == nil || *value != 3 {
		t.Fatalf("case-insensitive sort mode changed: %v %v", value, err)
	}
}

func TestFileTreeResponseSchemas(t *testing.T) {
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		path, body string
		status     int
	}{
		{"getFullHPathByID", `{"code":0,"msg":"","data":null}`, 200},
		{"getIDsByHPath", `{"code":0,"msg":"","data":null}`, 200},
		{"listDocTree", `{"code":0,"msg":"","data":{"tree":null}}`, 200},
		{"reorderDocs", `{"code":-1,"msg":"error","data":{"changed":false}}`, 200},
		{"reorderDocs", `{"code":0,"msg":"","data":{"changed":false,"conflict":false,"notebook":"","parentPath":""}}`, 200},
		{"authFilePublishAccess", `{"code":-1,"msg":"throttled","data":null}`, 429},
	} {
		if !json.Valid([]byte(entry.body)) {
			t.Fatal("invalid test fixture")
		}
		if err := bundle.ValidateHTTPResponse("POST", "/api/filetree/"+entry.path, entry.status, "application/json", []byte(entry.body)); err != nil {
			t.Fatalf("%s: %v", entry.path, err)
		}
	}
}
