package apicontract

import (
	"strings"
	"testing"
)

func TestNotebookRequestCompatibility(t *testing.T) {
	request, err := RenameNotebook.Decode(strings.NewReader(`{"notebook":" 20260101000000-abcdefg ","name":" "}`))
	if err != nil || request.Notebook != "20260101000000-abcdefg" || request.Name != " " {
		t.Fatalf("notebook trimming must preserve the name: %+v, %v", request, err)
	}
	closed, err := CloseNotebook.Decode(strings.NewReader(`{"notebook":" 20260101000000-abcdefg "}`))
	if err != nil || closed.Notebook != " 20260101000000-abcdefg " {
		t.Fatalf("close must preserve whitespace for ID validation: %+v, %v", closed, err)
	}
	icon, err := SetNotebookIcon.Decode(strings.NewReader(`{"notebook":"20260101000000-abcdefg","icon":""}`))
	if err != nil || icon.Icon != "" {
		t.Fatalf("empty icon must remain accepted: %+v, %v", icon, err)
	}
	for _, body := range []string{`{}`, `{"notebooks":null}`, `{"notebooks":[null]}`, `{"notebooks":[1]}`} {
		if _, err := ChangeSortNotebook.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid notebook list accepted: %s", body)
		}
	}
	if _, err := ChangeSortNotebook.Decode(strings.NewReader(`{"notebooks":[]}`)); err != nil {
		t.Fatalf("empty notebook list must remain accepted: %v", err)
	}
}
