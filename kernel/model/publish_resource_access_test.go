// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPublishResourceURLPath(t *testing.T) {
	tests := []struct {
		value    string
		prefix   string
		expected string
	}{
		{"/widgets/example/", "/widgets/", "example"},
		{"http://127.0.0.1:6806/emojis/icon.png?v=1", "/emojis/", "icon.png"},
		{"https://example.com/widgets/external/", "/widgets/", ""},
		{"/assets/icon.png", "/emojis/", ""},
		{"/widgets/../templates/private.md", "/widgets/", ""},
	}
	for _, test := range tests {
		if actual := publishResourceURLPath(test.value, test.prefix); actual != test.expected {
			t.Fatalf("publishResourceURLPath(%q, %q) = %q, expected %q", test.value, test.prefix, actual, test.expected)
		}
	}
}

func TestWidgetPackagesInTree(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	root.AppendChild(&ast.Node{
		Type:   ast.NodeWidget,
		Tokens: []byte(`<iframe src="/widgets/example/"></iframe>`),
	})
	root.AppendChild(&ast.Node{
		Type:   ast.NodeHTMLBlock,
		Tokens: []byte(`<img data-resource="/widgets/from-html/image.png">`),
	})
	root.AppendChild(&ast.Node{
		Type:   ast.NodeIFrame,
		Tokens: []byte(`<iframe src="https://example.com/widgets/external/"></iframe>`),
	})

	widgets := widgetPackagesInTree(&parse.Tree{Root: root})
	for _, name := range []string{"example", "from-html"} {
		if _, ok := widgets[name]; !ok {
			t.Fatalf("widget package [%s] was not extracted", name)
		}
	}
	if _, ok := widgets["external"]; ok {
		t.Fatal("external widget URL should not authorize a local widget package")
	}
}

func TestCheckSnippetAccessableInPublish(t *testing.T) {
	originalSnippetsPath := util.SnippetsPath
	util.SnippetsPath = t.TempDir()
	t.Cleanup(func() {
		util.SnippetsPath = originalSnippetsPath
	})

	if err := SetSnippet([]*conf.Snippet{
		{Name: "allowed", Type: "css"},
		{Name: "disabled", Type: "js", DisabledInPublish: true},
	}); err != nil {
		t.Fatal(err)
	}

	if found, accessable := CheckSnippetAccessableInPublish("allowed", "css"); !found || !accessable {
		t.Fatal("publish-enabled snippet should be accessable")
	}
	if found, accessable := CheckSnippetAccessableInPublish("disabled", "js"); !found || accessable {
		t.Fatal("publish-disabled snippet should not be accessable")
	}
	if found, _ := CheckSnippetAccessableInPublish("missing", "js"); found {
		t.Fatal("missing snippet should not be found")
	}
}

func TestCheckPluginAccessableInPublish(t *testing.T) {
	originalDataDir := util.DataDir
	originalConf := Conf
	util.DataDir = t.TempDir()
	Conf = NewAppConf()
	Conf.Bazaar = &conf.Bazaar{Trust: true}
	t.Cleanup(func() {
		util.DataDir = originalDataDir
		Conf = originalConf
	})

	writePlugin := func(name string, disabledInPublish bool) {
		dir := filepath.Join(util.DataDir, "plugins", name)
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		disabled := "false"
		if disabledInPublish {
			disabled = "true"
		}
		data := []byte(`{"name":"` + name + `","version":"1.0.0","minAppVersion":"0.0.1","disabledInPublish":` + disabled + `}`)
		if err := os.WriteFile(filepath.Join(dir, "plugin.json"), data, 0644); err != nil {
			t.Fatal(err)
		}
	}
	writePlugin("allowed", false)
	writePlugin("publish-disabled", true)
	writePlugin("user-disabled", false)
	writePlugin("disabled", false)
	if err := os.MkdirAll(filepath.Join(util.DataDir, "storage", "petal"), 0755); err != nil {
		t.Fatal(err)
	}
	savePetals([]*Petal{
		{Name: "allowed", Enabled: true},
		{Name: "publish-disabled", Enabled: true},
		{Name: "user-disabled", Enabled: true, UserDisabledInPublish: true},
		{Name: "disabled", Enabled: false},
	})

	if !CheckPluginAccessableInPublish("allowed") {
		t.Fatal("enabled plugin should be accessable in publish")
	}
	if CheckPluginAccessableInPublish("publish-disabled") {
		t.Fatal("publish-disabled plugin should not be accessable")
	}
	if CheckPluginAccessableInPublish("user-disabled") {
		t.Fatal("user-disabled plugin should not be accessable")
	}
	if CheckPluginAccessableInPublish("disabled") {
		t.Fatal("disabled plugin should not be accessable")
	}
}

func TestCheckWidgetAccessableInPublish(t *testing.T) {
	originalDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = originalDataDir
	})

	writeWidget := func(name string, disabledInPublish bool) {
		dir := filepath.Join(util.DataDir, "widgets", name)
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		disabled := "false"
		if disabledInPublish {
			disabled = "true"
		}
		data := []byte(`{"name":"` + name + `","disabledInPublish":` + disabled + `}`)
		if err := os.WriteFile(filepath.Join(dir, "widget.json"), data, 0644); err != nil {
			t.Fatal(err)
		}
	}
	writeWidget("allowed", false)
	writeWidget("disabled", true)

	if !CheckWidgetAccessableInPublish("allowed") {
		t.Fatal("publish-enabled widget should be accessable")
	}
	if CheckWidgetAccessableInPublish("disabled") {
		t.Fatal("publish-disabled widget should not be accessable")
	}
	if CheckWidgetAccessableInPublish("missing") {
		t.Fatal("missing widget should not be accessable")
	}
}
