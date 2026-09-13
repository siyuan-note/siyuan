package apicontract

import (
	"strings"
	"testing"
)

func TestExportRequiredFieldCompatibility(t *testing.T) {
	for _, entry := range []struct{ body, message string }{
		{`{}`, "Field [id] is required"}, {`{"id":null}`, "Field [id] is required"},
		{`{"id":false}`, "Field [id] should be of type [String]"}, {`{"id":" \t "}`, "Field [id] must not be empty"},
	} {
		if _, err := ExportCodeBlock.Decode(strings.NewReader(entry.body)); err == nil || err.Error() != entry.message {
			t.Fatalf("field error changed: %s: %v", entry.body, err)
		}
	}
	request, err := ExportDocx.Decode(strings.NewReader(`{"id":" id ","savePath":" path ","removeAssets":false,"merge":null,"mergeDocHeadingMode":" untouched "}`))
	if err != nil || request.ID != "id" || request.SavePath != "path" || request.Merge || request.MergeDocHeadingMode != " untouched " {
		t.Fatalf("docx normalization changed: %+v %v", request, err)
	}
	if _, err := ExportDocx.Decode(strings.NewReader(`{"id":"id","savePath":"path","removeAssets":null}`)); err == nil || err.Error() != "Field [removeAssets] is required" {
		t.Fatal(err)
	}
}

func TestExportOptionsAdmissionOrder(t *testing.T) {
	request, err := ExportNotebookMd.Decode(strings.NewReader(`{"notebook":" box ","blockRefMode":false}`))
	if err != nil || request.Notebook != "box" || request.Validate() == nil {
		t.Fatalf("options error was not deferred: %+v %v", request, err)
	}
	content, err := ExportMdContent.Decode(strings.NewReader(`{"id":" id ","refMode":2.9,"embedMode":-2.9,"yfm":null,"fillCSSVar":null,"imgTag":false,"addTitle":true}`))
	if err != nil || content.Validate() != nil || content.ID != "id" || int(*content.RefMode) != 2 || int(*content.EmbedMode) != -2 || content.YFM != nil || content.FillCSSVar || !*content.AddTitle {
		t.Fatalf("content options changed: %+v %v", content, err)
	}
	content, err = ExportMdContent.Decode(strings.NewReader(`{"id":"id","fillCSSVar":"bad"}`))
	if err != nil || content.Validate() == nil || content.Validate().Error() != "Field [fillCSSVar] should be of type [Boolean]" {
		t.Fatalf("content option validation changed: %+v %v", content, err)
	}
	md, err := ExportMd.Decode(strings.NewReader(`{"id":"id","addTitle":false,"inlineMemo":null,"blockRefMode":3.9,"blockRefTextLeft":" left ","includeRelatedDocs":true}`))
	if err != nil || md.Validate() != nil || *md.AddTitle || md.InlineMemo != nil || int(*md.BlockRefMode) != 3 || *md.BlockRefTextLeft != " left " || !*md.IncludeRelatedDocs {
		t.Fatalf("markdown options changed: %+v %v", md, err)
	}
}

func TestExportNotebookFiltering(t *testing.T) {
	for _, body := range []string{`{}`, `{"notebooks":null}`, `{"notebooks":true}`, `{"notebooks":{}}`} {
		request, err := ExportNotebooksSY.Decode(strings.NewReader(body))
		if err != nil || request.IDs() != nil {
			t.Fatalf("notebook filtering changed: %+v %v", request, err)
		}
	}
	request, err := ExportNotebooksMd.Decode(strings.NewReader(`{"notebooks":[null,3,false,""," box ","box","box"],"addTitle":false}`))
	if err != nil || request.Validate() != nil || strings.Join(request.IDs(), ",") != " box ,box,box" {
		t.Fatalf("notebook order changed: %+v %v", request, err)
	}
}

func TestExportIgnoredTitleOptions(t *testing.T) {
	for _, extra := range []string{``, `,"addTitle":null,"customTitle":null`, `,"addTitle":"bad","customTitle":false`, `,"addTitle":{},"customTitle":[]`} {
		request, err := ExportHTML.Decode(strings.NewReader(`{"id":"id","pdf":false` + extra + `}`))
		if err != nil || request.AddTitle != nil || request.CustomTitle != "" {
			t.Fatalf("ignored title option changed: %+v %v", request, err)
		}
	}
	request, err := ExportPreviewHTML.Decode(strings.NewReader(`{"id":"id","image":true,"addTitle":false,"customTitle":" custom "}`))
	if err != nil || !request.Image || request.AddTitle == nil || *request.AddTitle || request.CustomTitle != " custom " {
		t.Fatalf("title option changed: %+v %v", request, err)
	}
}

func TestExportResourcesOptionalPaths(t *testing.T) {
	for _, body := range []string{`{}`, `{"paths":null,"name":null}`} {
		request, err := ExportResources.Decode(strings.NewReader(body))
		if err != nil || request.Paths != nil {
			t.Fatalf("missing paths must reach business validation: %+v %v", request, err)
		}
	}
	request, err := ExportResources.Decode(strings.NewReader(`{"paths":[],"name":" name "}`))
	if err != nil || request.Paths == nil || len(*request.Paths) != 0 || *request.Name != " name " {
		t.Fatalf("empty paths changed: %+v %v", request, err)
	}
	for _, body := range []string{`{"paths":[null]}`, `{"paths":[false]}`} {
		if _, err := ExportResources.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid resource path accepted: %s", body)
		}
	}
	if _, err := ExportData.Decode(strings.NewReader("ignored body")); err != nil {
		t.Fatal(err)
	}
}
