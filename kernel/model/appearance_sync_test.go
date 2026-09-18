package model

import (
	"reflect"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
)

func TestAppearanceChangedPackages(t *testing.T) {
	result := &dejavu.MergeResult{Upserts: []*entity.File{{Path: "/themes/example/theme.css"}, {Path: "/themes/example/assets/font.woff"}, {Path: "/storage/bazaar/icons/other.json"}, {Path: "/storage/bazaar.json"}, {Path: "/storage/appearance-v1/themes/shared/version.sypkg"}}, Removes: []*entity.File{{Path: "/icons/other/icon.js"}, {Path: "/themes/deleted/theme.css"}, {Path: "/storage/bazaar/themes/old.json"}, {Path: "/storage/appearance-v1/icons/shared/version.sypkg"}}}
	themes, icons := appearanceChangedPackages(result)
	if !reflect.DeepEqual(themes, []string{"deleted", "example"}) || !reflect.DeepEqual(icons, []string{"other"}) {
		t.Fatalf("unexpected refresh: themes=%v icons=%v", themes, icons)
	}
}
