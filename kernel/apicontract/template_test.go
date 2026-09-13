package apicontract

import (
	"strings"
	"testing"
)

func TestTemplateRenderCompatibility(t *testing.T) {
	for _, entry := range []struct {
		fields, mode               string
		invalidMode, invalidSource bool
	}{
		{`"mode":"preview","preview":"ignored","content":""`, "preview", false, false},
		{`"mode":null,"preview":true`, "preview", false, false},
		{`"mode":"editorInsert","preview":true`, "editorInsert", false, false},
		{`"preview":false`, "content", false, false},
		{`"mode":"content"`, "", true, false},
		{`"mode":true`, "", true, false},
		{`"mode":"preview","content":null`, "preview", false, true},
		{`"mode":"editorInsert","content":""`, "editorInsert", false, true},
	} {
		request, err := RenderTemplate.Decode(strings.NewReader(`{"path":" file ","id":" id ",` + entry.fields + `}`))
		if err != nil || request.Path != " file " || request.ID != " id " {
			t.Fatalf("early validation or trimming changed: %+v %v", request, err)
		}
		mode, err := request.RenderMode()
		if (err != nil) != entry.invalidMode || mode != entry.mode {
			t.Fatalf("mode precedence changed for %s: %s %v", entry.fields, mode, err)
		}
		if !entry.invalidMode {
			_, err = request.PreviewSource(mode)
			if (err != nil) != entry.invalidSource {
				t.Fatalf("source validation changed: %s %v", entry.fields, err)
			}
		}
	}
}
