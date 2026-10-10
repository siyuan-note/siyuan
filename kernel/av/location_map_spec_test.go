package av

import (
	"encoding/json"
	"testing"
)

func TestLocationAndMapWGS84StorageSpec(t *testing.T) {
	for _, spec := range []int{PlainTextSpec, RichTextSpec, 10, 11, 12} {
		plain := &AttributeView{Spec: spec}
		UpgradeSpec(plain)
		if plain.Spec != spec {
			t.Fatalf("unrelated database changed from spec %d to %d", spec, plain.Spec)
		}
		for _, mapped := range []bool{false, true} {
			view := &AttributeView{Spec: spec, KeyValues: []*KeyValues{{Key: &Key{Type: KeyTypeLocation}}}}
			wantErr := ErrLocationSpecMismatch
			if mapped {
				view.Views = []*View{{LayoutType: LayoutTypeMap, Map: &LayoutMap{LayoutTable: NewLayoutTable()}}}
				wantErr = ErrMapSpecMismatch
			}
			data, err := json.Marshal(view)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = ParseAttributeViewData("location", data); err != wantErr {
				t.Fatalf("spec %d accepted WGS84 data: %v", spec, err)
			}
			UpgradeSpec(view)
			if view.Spec != 13 {
				t.Fatalf("new WGS84 data can be rewritten by a spec-12 kernel: %d", view.Spec)
			}
			data, err = json.Marshal(view)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = ParseAttributeViewData("location", data); err != nil {
				t.Fatalf("new WGS84 storage spec rejected: %v", err)
			}
		}
	}
}
