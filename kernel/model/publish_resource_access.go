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
	"bytes"
	stdhtml "html"
	"net/url"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"github.com/88250/lute/ast"
	lutehtml "github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type publishResourceRefs struct {
	updated string
	widgets map[string]struct{}
	emojis  map[string]struct{}
}

var publishResourceRefsCache sync.Map

func CheckSnippetAccessableInPublish(name, typ string) (found, accessable bool) {
	snippets, err := LoadSnippets()
	if err != nil {
		return
	}
	for _, snippet := range snippets {
		if snippet.Name == name && snippet.Type == typ {
			return true, !snippet.DisabledInPublish
		}
	}
	return
}

func CheckPluginAccessableInPublish(name string) bool {
	if name == "" || !IsPetalsEnabled() {
		return false
	}

	petal := getPetalByName(name, getPetals())
	if petal == nil || !petal.Enabled {
		return false
	}

	found, _, _, _, disabledInPublish, disallowInstall, _ := bazaar.ParseInstalledPlugin(name, "")
	return found && isPetalAccessableInPublish(petal, disabledInPublish, disallowInstall)
}

func isPetalAccessableInPublish(petal *Petal, disabledInPublish, disallowInstall bool) bool {
	return petal != nil && petal.Enabled && !petal.UserDisabledInPublish && !disabledInPublish && !disallowInstall
}

func CheckWidgetAccessableInPublish(name string) bool {
	if name == "" {
		return false
	}
	widget, err := bazaar.ParsePackageJSON(filepath.Join(util.DataDir, "widgets", name, "widget.json"))
	return err == nil && bazaar.IsValidInstalledPackage(widget, name) && !widget.DisabledInPublish
}

func CheckWidgetAccessableByPublishAccess(c *gin.Context, name string, publishAccess PublishAccess) bool {
	if !CheckWidgetAccessableInPublish(name) {
		return false
	}
	return checkResourceAccessableByPublishAccess(c, name, publishAccess, true)
}

func CheckEmojiAccessableByPublishAccess(c *gin.Context, relativePath string, publishAccess PublishAccess) bool {
	relativePath = normalizePublishResourcePath(relativePath)
	if relativePath == "" {
		return false
	}
	return checkResourceAccessableByPublishAccess(c, relativePath, publishAccess, false)
}

func checkResourceAccessableByPublishAccess(c *gin.Context, resource string, publishAccess PublishAccess, widget bool) bool {
	for _, bt := range treenode.GetBlockTreesByType("d") {
		if !checkBlockTreeAccessableByPublishAccess(c, publishAccess, bt) {
			continue
		}

		refs := getPublishResourceRefs(bt)
		if widget {
			if _, ok := refs.widgets[resource]; ok {
				return true
			}
		} else if _, ok := refs.emojis[resource]; ok {
			return true
		}
	}
	return false
}

func getPublishResourceRefs(bt *treenode.BlockTree) *publishResourceRefs {
	cacheKey := bt.BoxID + "/" + bt.RootID
	if cached, ok := publishResourceRefsCache.Load(cacheKey); ok {
		refs := cached.(*publishResourceRefs)
		if refs.updated == bt.Updated {
			return refs
		}
	}

	refs := &publishResourceRefs{
		updated: bt.Updated,
		widgets: map[string]struct{}{},
		emojis:  map[string]struct{}{},
	}
	tree, err := loadTreeByBlockIDInBox(bt.RootID, bt.BoxID)
	if err != nil || tree == nil {
		return refs
	}

	refs.widgets = widgetPackagesInTree(tree)
	for _, emoji := range emojisInTree(tree) {
		if relativePath := publishResourceURLPath(emoji, "/emojis/"); relativePath != "" {
			refs.emojis[relativePath] = struct{}{}
		}
	}
	publishResourceRefsCache.Store(cacheKey, refs)
	return refs
}

func widgetPackagesInTree(tree *parse.Tree) map[string]struct{} {
	ret := map[string]struct{}{}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || (n.Type != ast.NodeWidget && n.Type != ast.NodeIFrame &&
			n.Type != ast.NodeHTMLBlock && n.Type != ast.NodeInlineHTML) {
			return ast.WalkContinue
		}

		nodes, err := lutehtml.ParseFragment(bytes.NewReader(n.Tokens), &lutehtml.Node{Type: lutehtml.ElementNode})
		if err != nil {
			return ast.WalkContinue
		}
		for _, node := range nodes {
			walkPublishResourceHTML(node, func(value string) {
				relativePath := publishResourceURLPath(value, "/widgets/")
				if relativePath == "" {
					return
				}
				name, _, _ := strings.Cut(relativePath, "/")
				if name != "" {
					ret[name] = struct{}{}
				}
			})
		}
		return ast.WalkContinue
	})
	return ret
}

func walkPublishResourceHTML(node *lutehtml.Node, visit func(string)) {
	for _, attr := range node.Attr {
		visit(attr.Val)
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		walkPublishResourceHTML(child, visit)
	}
}

func publishResourceURLPath(value, prefix string) string {
	value = strings.TrimSpace(stdhtml.UnescapeString(value))
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}
	if parsed.Host != "" && !util.IsLocalHostname(parsed.Hostname()) {
		return ""
	}
	cleanPath := path.Clean(parsed.Path)
	if !strings.HasPrefix(cleanPath, prefix) {
		return ""
	}
	return normalizePublishResourcePath(strings.TrimPrefix(cleanPath, prefix))
}

func normalizePublishResourcePath(relativePath string) string {
	relativePath = filepath.ToSlash(filepath.Clean(filepath.FromSlash(strings.TrimPrefix(relativePath, "/"))))
	if relativePath == "." || relativePath == ".." || strings.HasPrefix(relativePath, "../") {
		return ""
	}
	return relativePath
}
