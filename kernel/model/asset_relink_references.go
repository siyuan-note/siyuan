// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"fmt"
	"html"
	"net/url"
	"path"
	"regexp"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	xhtml "golang.org/x/net/html"
)

type assetRelinker struct {
	oldPath     string
	newPath     string
	result      apicontract.AssetReferencesData
	routes      map[string]*assetRelinker
	collectOnly bool
	recordless  bool
	disabled    bool
	changes     int
}

// relinkPath 按 URL 路径解码一次，查询参数和片段不参与资源文件名匹配。
func relinkPath(value string) (string, error) {
	u, err := url.Parse(value)
	if err != nil || u.IsAbs() || u.Host != "" || u.Opaque != "" {
		return "", fmt.Errorf("invalid asset path: %q", value)
	}
	p := strings.TrimPrefix(u.Path, "/")
	if !strings.HasPrefix(p, "assets/") || path.Clean(p) != p || strings.ContainsAny(p, "\\\x00\r\n") || strings.HasSuffix(p, "/") {
		return "", fmt.Errorf("invalid asset path: %q", value)
	}
	for _, segment := range strings.Split(p, "/") {
		if strings.Contains(segment, ":") {
			return "", fmt.Errorf("invalid asset path: %q", value)
		}
	}
	return p, nil
}

func (r *assetRelinker) reference(raw, kind string, location apicontract.AssetReference) string {
	link, annotationID := raw, ""
	if kind == "annotation" {
		link, annotationID = util.SplitFileAnnotationRef(raw)
		if link == "" {
			return raw
		}
	}
	p, err := relinkPath(link)
	if err != nil {
		return raw
	}
	rule := r
	if r.routes != nil {
		rule = r.routes[p]
	}
	if rule == nil || p != rule.oldPath || (rule.disabled && !r.collectOnly) {
		return raw
	}
	location.OldPath = rule.oldPath
	location.Type, location.Reference, location.Relinkable = kind, raw, true
	u, _ := url.Parse(link)
	query, queryErr := url.ParseQuery(html.UnescapeString(u.RawQuery))
	if queryErr != nil {
		location.Relinkable, location.Reason = false, "invalid_query"
	}
	for _, box := range query["box"] {
		if !ast.IsNodeIDPattern(box) || IsEncryptedBox(box) {
			location.Relinkable, location.Reason = false, "encrypted_or_invalid_notebook"
		}
	}
	if annotationID != "" && rule.newPath != "" && !strings.EqualFold(path.Ext(rule.newPath), ".pdf") {
		location.Relinkable, location.Reason = false, "annotation_requires_pdf"
	}
	ret := raw
	if rule.newPath != "" && location.Relinkable {
		end := strings.IndexAny(raw, "?#")
		if end < 0 {
			end = len(raw)
		}
		ret = (&url.URL{Path: rule.newPath}).EscapedPath()
		if strings.HasPrefix(raw, "/") {
			ret = "/" + ret
		}
		if annotationID != "" {
			ret += "/" + annotationID
		}
		ret += raw[end:]
		location.Replacement = ret
	}
	if !r.recordless {
		r.result.References = append(r.result.References, location)
	}
	if r.collectOnly || rule.oldPath == rule.newPath {
		return raw
	}
	if ret != raw {
		r.changes++
	}
	return ret
}

var relinkAssetListPattern = regexp.MustCompile(`[^\s,]+`)
var relinkCSSURLPattern = regexp.MustCompile(`(?i)url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)`)
var relinkHTMLAttrPattern = regexp.MustCompile("([^\\s=<>/]+)(\\s*=\\s*)(\"[^\"]*\"|'[^']*'|[^\\s>]+)")

func (r *assetRelinker) list(raw, kind string, location apicontract.AssetReference) string {
	// 完整路径优先，兼容文件名中的空格和逗号；多值列表仅替换各独立 URL。
	if p, err := relinkPath(raw); err == nil && (p == r.oldPath || r.routes[p] != nil) {
		return r.reference(raw, kind, location)
	}
	return relinkAssetListPattern.ReplaceAllStringFunc(raw, func(value string) string {
		return r.reference(value, kind, location)
	})
}

func (r *assetRelinker) css(raw, kind string, location apicontract.AssetReference) string {
	return relinkCSSURLPattern.ReplaceAllStringFunc(raw, func(value string) string {
		indices := relinkCSSURLPattern.FindStringSubmatchIndex(value)
		for i := 2; i < len(indices); i += 2 {
			if indices[i] >= 0 {
				start, end := indices[i], indices[i+1]
				return value[:start] + r.reference(value[start:end], kind, location) + value[end:]
			}
		}
		return value
	})
}

// html 只改写标签的资源属性，保留标签之外的正文、脚本、注释和原始排版。
func (r *assetRelinker) html(raw []byte, location apicontract.AssetReference) []byte {
	z := xhtml.NewTokenizer(bytes.NewReader(raw))
	var out bytes.Buffer
	for {
		typ := z.Next()
		token := string(z.Raw())
		if typ == xhtml.StartTagToken || typ == xhtml.SelfClosingTagToken {
			token = relinkHTMLAttrPattern.ReplaceAllStringFunc(token, func(attr string) string {
				parts := relinkHTMLAttrPattern.FindStringSubmatch(attr)
				key, value := strings.ToLower(parts[1]), parts[3]
				if key != "src" && key != "href" && key != "poster" && key != "data-src" && key != "data" && key != "style" && key != "data-assets" && !strings.HasPrefix(key, "custom-data-assets") {
					return attr
				}
				quote := byte(0)
				if len(value) >= 2 && (value[0] == '\'' || value[0] == '"') {
					quote, value = value[0], value[1:len(value)-1]
				}
				decoded := html.UnescapeString(value)
				rewritten := decoded
				if key == "style" {
					rewritten = r.css(decoded, "html", location)
				} else if strings.Contains(key, "data-assets") {
					rewritten = r.list(decoded, "attribute", location)
				} else {
					rewritten = r.reference(decoded, "html", location)
				}
				if rewritten == decoded {
					return attr
				}
				if quote == 0 {
					quote = '"'
				}
				return parts[1] + parts[2] + string(quote) + html.EscapeString(rewritten) + string(quote)
			})
		}
		out.WriteString(token)
		if typ == xhtml.ErrorToken {
			break
		}
	}
	return out.Bytes()
}

func (r *assetRelinker) tree(tree *parse.Tree, location apicontract.AssetReference) {
	treenode.WalkWithTabTitles(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		loc := location
		if loc.BlockID == "" {
			loc.BlockID = assetLinkDestBlockID(n)
		}
		for _, kv := range n.KramdownIAL {
			if len(kv) != 2 {
				continue
			}
			key, raw := kv[0], kv[1]
			decoded, rewritten := html.UnescapeString(raw), ""
			if key == "title-img" {
				rewritten = r.css(decoded, "title-image", loc)
			} else if key == "data-assets" || strings.HasPrefix(key, "custom-data-assets") {
				rewritten = r.list(decoded, "attribute", loc)
			} else {
				continue
			}
			if rewritten != decoded {
				n.SetIALAttr(key, rewritten)
			}
		}
		switch n.Type {
		case ast.NodeLinkDest:
			n.Tokens = []byte(r.reference(n.TokensStr(), "link", loc))
		case ast.NodeTextMark:
			if n.IsTextMarkType("a") {
				n.TextMarkAHref = r.reference(n.TextMarkAHref, "link", loc)
			}
			if n.IsTextMarkType("file-annotation-ref") {
				n.TextMarkFileAnnotationRefID = r.reference(n.TextMarkFileAnnotationRefID, "annotation", loc)
			}
		case ast.NodeFileAnnotationRefID:
			n.Tokens = []byte(r.reference(n.TokensStr(), "annotation", loc))
		case ast.NodeHTMLBlock, ast.NodeInlineHTML, ast.NodeIFrame, ast.NodeAudio, ast.NodeVideo, ast.NodeWidget:
			n.Tokens = r.html(n.Tokens, loc)
		}
		return ast.WalkContinue
	})
}

func (r *assetRelinker) attributeView(view *av.AttributeView, location apicontract.AssetReference) (err error) {
	view.VisitPersistedValues(func(value *av.Value) {
		if err != nil {
			return
		}
		loc := location
		loc.ValueID, loc.BlockID = value.ID, value.BlockID
		if value.URL != nil {
			value.URL.Content = r.reference(value.URL.Content, "av-url", loc)
		}
		for _, asset := range value.MAsset {
			if asset != nil {
				asset.Content = r.reference(asset.Content, "av-asset", loc)
			}
		}
		if value.Text == nil || value.Text.Rich == nil {
			return
		}
		var tree *parse.Tree
		if tree, err = av.ParseValueTextRich(value.Text.Rich); err != nil || tree == nil {
			return
		}
		before := r.changes
		r.tree(tree, loc)
		if r.changes != before {
			if value.Text.Rich.Content, err = av.RenderValueTextRich(tree); err == nil {
				err = value.Text.NormalizeRichContent()
			}
		}
	})
	return
}
