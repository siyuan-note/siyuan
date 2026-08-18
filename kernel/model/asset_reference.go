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
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	lutehtml "github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type assetReferenceRewriteOptions struct {
	pathMap         map[string]string
	targetBoxID     string
	bindTargetBox   bool
	rewriteUnmapped bool
}

func canonicalAssetReferencePath(rawPath string) string {
	rawPath = strings.TrimSpace(stdhtml.UnescapeString(rawPath))
	if decoded, err := url.PathUnescape(rawPath); err == nil {
		rawPath = decoded
	}
	rawPath = strings.TrimPrefix(path.Clean(rawPath), "/")
	if rawPath == "." || !strings.HasPrefix(rawPath, "assets/") {
		return ""
	}
	return rawPath
}

func splitAssetReference(rawReference string) (rawPath, rawQuery, fragment string) {
	rawPath = strings.TrimSpace(rawReference)
	if index := strings.Index(rawPath, "#"); index >= 0 {
		fragment = rawPath[index:]
		rawPath = rawPath[:index]
	}
	if index := strings.Index(rawPath, "?"); index >= 0 {
		rawQuery = rawPath[index+1:]
		rawPath = rawPath[:index]
	}
	return
}

func lookupRewrittenAssetPath(sourcePath string, options assetReferenceRewriteOptions) (targetPath string, found bool) {
	if targetPath, found = options.pathMap[sourcePath]; found {
		return
	}

	// PDF 标注引用形如 assets/document.pdf/<annotationID>，资源映射只记录 PDF 文件本身。
	longestSourcePath := ""
	for candidateSourcePath, candidateTargetPath := range options.pathMap {
		if len(candidateSourcePath) <= len(longestSourcePath) ||
			!strings.HasPrefix(sourcePath, candidateSourcePath+"/") {
			continue
		}
		longestSourcePath = candidateSourcePath
		targetPath = candidateTargetPath + strings.TrimPrefix(sourcePath, candidateSourcePath)
		found = true
	}
	return
}

func rewriteAssetReference(rawReference string, options assetReferenceRewriteOptions) string {
	rawPath, rawQuery, fragment := splitAssetReference(rawReference)
	sourcePath := canonicalAssetReferencePath(rawPath)
	if sourcePath == "" {
		return rawReference
	}

	targetPath, found := lookupRewrittenAssetPath(sourcePath, options)
	if !found {
		if !options.rewriteUnmapped {
			return rawReference
		}
		targetPath = sourcePath
	}
	if targetPath == sourcePath {
		// 仅修改查询参数时保留原始路径编码。
		targetPath = rawPath
	}

	queryValues, err := url.ParseQuery(stdhtml.UnescapeString(rawQuery))
	if err != nil {
		return rawReference
	}
	if options.bindTargetBox {
		queryValues.Set("box", options.targetBoxID)
	} else {
		queryValues.Del("box")
	}

	ret := targetPath
	if encodedQuery := queryValues.Encode(); encodedQuery != "" {
		ret += "?" + encodedQuery
	}
	return ret + fragment
}

func rewriteHTMLAssetReferences(tokens []byte, options assetReferenceRewriteOptions) []byte {
	nodes, err := lutehtml.ParseFragment(bytes.NewReader(tokens), &lutehtml.Node{Type: lutehtml.ElementNode})
	if err != nil || len(nodes) == 0 {
		return tokens
	}

	updated := false
	var walk func(*lutehtml.Node)
	walk = func(node *lutehtml.Node) {
		for i := range node.Attr {
			rewritten := rewriteAssetReference(node.Attr[i].Val, options)
			if rewritten != node.Attr[i].Val {
				node.Attr[i].Val = rewritten
				updated = true
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	for _, node := range nodes {
		walk(node)
	}
	if !updated {
		return tokens
	}

	buf := bytes.Buffer{}
	for _, node := range nodes {
		if err = lutehtml.Render(&buf, node); err != nil {
			return tokens
		}
	}
	return buf.Bytes()
}

func rewriteTreeAssetReferences(tree *parse.Tree, options assetReferenceRewriteOptions) {
	if tree == nil || tree.Root == nil {
		return
	}

	titleImgPath := treenode.GetDocTitleImgPath(tree.Root)
	if rewritten := rewriteAssetReference(titleImgPath, options); titleImgPath != "" && rewritten != titleImgPath {
		titleImg := stdhtml.UnescapeString(tree.Root.IALAttr("title-img"))
		tree.Root.SetIALAttr("title-img", strings.Replace(titleImg, titleImgPath, rewritten, 1))
	}

	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if node.IsBlock() {
			var assetAttrKeys []string
			for _, kv := range node.KramdownIAL {
				if strings.HasPrefix(kv[0], "custom-data-assets") || kv[0] == "data-assets" {
					assetAttrKeys = append(assetAttrKeys, kv[0])
				}
			}
			for _, key := range assetAttrKeys {
				value := node.IALAttr(key)
				if rewritten := rewriteAssetReference(value, options); rewritten != value {
					node.SetIALAttr(key, rewritten)
				}
			}
		}

		switch node.Type {
		case ast.NodeLinkDest:
			reference := node.TokensStr()
			if rewritten := rewriteAssetReference(reference, options); rewritten != reference {
				node.Tokens = []byte(rewritten)
			}
		case ast.NodeTextMark:
			if node.IsTextMarkType("a") {
				node.TextMarkAHref = rewriteAssetReference(node.TextMarkAHref, options)
			}
			if node.IsTextMarkType("file-annotation-ref") {
				node.TextMarkFileAnnotationRefID = rewriteAssetReference(node.TextMarkFileAnnotationRefID, options)
			}
		case ast.NodeHTMLBlock, ast.NodeInlineHTML, ast.NodeIFrame, ast.NodeWidget, ast.NodeAudio, ast.NodeVideo:
			node.Tokens = rewriteHTMLAssetReferences(node.Tokens, options)
		}
		return ast.WalkContinue
	})
}

func rewriteAttributeViewValueAssetReferences(value *av.Value, options assetReferenceRewriteOptions) (updated bool) {
	if value == nil {
		return
	}
	if value.URL != nil {
		rewritten := rewriteAssetReference(value.URL.Content, options)
		if rewritten != value.URL.Content {
			value.URL.Content = rewritten
			updated = true
		}
	}
	for _, asset := range value.MAsset {
		if asset == nil {
			continue
		}
		rewritten := rewriteAssetReference(asset.Content, options)
		if rewritten != asset.Content {
			asset.Content = rewritten
			updated = true
		}
	}
	if value.Relation != nil {
		for _, content := range value.Relation.Contents {
			updated = rewriteAttributeViewValueAssetReferences(content, options) || updated
		}
	}
	if value.Rollup != nil {
		for _, content := range value.Rollup.Contents {
			updated = rewriteAttributeViewValueAssetReferences(content, options) || updated
		}
	}
	return
}

func rewriteAttributeViewAssetReferences(attrView *av.AttributeView, options assetReferenceRewriteOptions) (updated bool) {
	if attrView == nil {
		return
	}
	for _, keyValues := range attrView.KeyValues {
		if keyValues == nil {
			continue
		}
		for _, value := range keyValues.Values {
			updated = rewriteAttributeViewValueAssetReferences(value, options) || updated
		}
	}
	return
}

func rewriteAttributeViewDataAssetReferences(data []byte, options assetReferenceRewriteOptions) ([]byte, error) {
	attrView := &av.AttributeView{}
	if err := gulu.JSON.UnmarshalJSON(data, attrView); err != nil {
		return nil, err
	}
	if !rewriteAttributeViewAssetReferences(attrView, options) {
		return data, nil
	}
	if util.UseSingleLineSave {
		return gulu.JSON.MarshalJSON(attrView)
	}
	return gulu.JSON.MarshalIndentJSON(attrView, "", "\t")
}
