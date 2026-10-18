package conf

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestPreferenceDefaultsAndNormalization(t *testing.T) {
	for _, raw := range []string{`{}`, `{"pdfTheme":null,"mobileBars":null}`, `{"pdfTheme":{},"mobileBars":{}}`} {
		appearance := &Appearance{}
		if err := json.Unmarshal([]byte(raw), appearance); err != nil {
			t.Fatal(err)
		}
		NormalizeAppearance(appearance, false)
		if appearance.CompactMode || appearance.MenuMouseScroll || appearance.OutlineKeepCurrentExpand ||
			!reflect.DeepEqual(appearance.PDFTheme, NewPDFTheme()) || !reflect.DeepEqual(appearance.MobileBars, NewMobileBars()) {
			t.Fatalf("unexpected preference defaults: %+v", appearance)
		}
	}
	appearance := &Appearance{CompactMode: true, MenuMouseScroll: true, OutlineKeepCurrentExpand: true,
		PDFTheme:   &PDFTheme{Light: "invalid", Dark: "", AnnoColor: " "},
		MobileBars: &MobileBars{AutoHide: new(false), SidebarSwipe: new(false), SidebarButtons: new(false)}}
	NormalizeAppearance(appearance, true)
	if !appearance.CompactMode || !appearance.MenuMouseScroll || !appearance.OutlineKeepCurrentExpand ||
		!reflect.DeepEqual(appearance.PDFTheme, NewPDFTheme()) || *appearance.MobileBars.AutoHide ||
		*appearance.MobileBars.SidebarSwipe || !*appearance.MobileBars.SidebarButtons {
		t.Fatal("normalization lost explicit choices or allowed inaccessible sidebars")
	}
	appearance.PDFTheme = &PDFTheme{Light: "dark", Dark: "light", AnnoColor: "rgb(1, 2, 3)"}
	NormalizeAppearance(appearance, false)
	if appearance.PDFTheme.Light != "dark" || appearance.PDFTheme.Dark != "light" || appearance.PDFTheme.AnnoColor != "rgb(1, 2, 3)" {
		t.Fatal("explicit PDF preferences changed")
	}
	for _, sort := range []string{"", "invalid", "viewedAt", "created", "updated", "openAt", "closedAt"} {
		expected := sort
		if sort == "" || sort == "invalid" {
			expected = "viewedAt"
		}
		if got := NormalizeFileTree(&FileTree{RecentDocsSort: sort}).RecentDocsSort; got != expected {
			t.Fatalf("sort %q became %q", sort, got)
		}
	}
	if NewAI().Agent.StreamingMarkdown || NormalizeAI(&AI{}).Agent.StreamingMarkdown {
		t.Fatal("streaming Markdown must default to disabled")
	}
}
