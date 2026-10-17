package conf

import (
	"encoding/json"
	"testing"

	"github.com/88250/gulu"
)

func TestEditorBlockGutterModeMigration(t *testing.T) {
	if NewEditor().BlockGutterMode {
		t.Fatal("full block indicators must default to disabled")
	}
	for _, decoder := range []struct {
		name   string
		decode func([]byte, any) error
	}{{"json", json.Unmarshal}, {"gulu", gulu.JSON.UnmarshalJSON}} {
		for _, raw := range []string{`true`, `false`, `1`, `0`, `null`, `99`} {
			t.Run(decoder.name+"/"+raw, func(t *testing.T) {
				editor := NewEditor()
				if err := decoder.decode([]byte(`{"blockGutterMode":`+raw+`,"fontSize":24}`), editor); err != nil {
					t.Fatal(err)
				}
				editor = NormalizeEditor(editor)
				want := raw == "true" || raw == "1"
				if bool(editor.BlockGutterMode) != want || editor.FontSize != 24 {
					t.Fatalf("migration changed preferences: %+v", editor)
				}
				data, err := json.Marshal(editor)
				if err != nil {
					t.Fatal(err)
				}
				var saved struct {
					BlockGutterMode bool `json:"blockGutterMode"`
				}
				if err = json.Unmarshal(data, &saved); err != nil || saved.BlockGutterMode != want {
					t.Fatalf("saved preference is not boolean: %s, %v", data, err)
				}
			})
		}
	}
}
