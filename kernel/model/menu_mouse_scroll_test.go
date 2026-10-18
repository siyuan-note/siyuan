package model

import (
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
	"testing"
)

func TestInitMenuMouseScrollPreference(t *testing.T) {
	for _, test := range []struct {
		name                      string
		exists, readonly, enabled bool
		notebooks                 int
		want                      bool
	}{
		{name: "new empty workspace", want: true},
		{name: "existing empty workspace", exists: true},
		{name: "existing notebooks", notebooks: 1},
		{name: "readonly workspace", readonly: true},
		{name: "explicitly disabled", exists: true},
		{name: "explicitly enabled", exists: true, enabled: true, want: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			previous := util.ReadOnly
			util.ReadOnly = test.readonly
			t.Cleanup(func() { util.ReadOnly = previous })
			appearance := conf.NewAppearance()
			appearance.MenuMouseScroll = test.enabled
			initMenuMouseScrollPreference(appearance, test.exists, test.notebooks)
			if appearance.MenuMouseScroll != test.want {
				t.Fatalf("enabled = %v, want %v", appearance.MenuMouseScroll, test.want)
			}
		})
	}
}
