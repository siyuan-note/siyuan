// SiYuan - Build Your Eternal Digital Garden
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

package sql

import (
	"bytes"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/mattn/go-sqlite3"
	_ "github.com/mattn/go-sqlite3"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var db *sql.DB

func init() {
	regex := func(re, s string) (bool, error) {
		re = strings.ReplaceAll(re, "\\\\", "\\")
		return regexp.MatchString(re, s)
	}

	sql.Register("sqlite3_extended", &sqlite3.SQLiteDriver{
		ConnectHook: func(conn *sqlite3.SQLiteConn) error {
			return conn.RegisterFunc("regexp", regex, true)
		},
	})
}

func InitDatabase(forceRebuild bool) (err error) {
	util.IncBootProgress(2, "Initializing database...")

	initDBConnection()

	if !forceRebuild {
		// 检查数据库结构版本，如果版本不一致的话说明改过表结构，需要重建
		if util.DatabaseVer == getDatabaseVer() {
			return
		}
	}

	// 不存在库或者版本不一致都会走到这里

	db.Close()
	if gulu.File.IsExist(util.DBPath) {
		if err = removeDatabaseFile(); nil != err {
			logging.LogErrorf("remove database file [%s] failed: %s", util.DBPath, err)
			util.PushClearProgress()
			return
		}
	}
	if gulu.File.IsExist(util.BlockTreePath) {
		os.RemoveAll(util.BlockTreePath)
	}

	initDBConnection()
	initDBTables()

	logging.LogInfof("reinitialized database [%s]", util.DBPath)
	return
}

func initDBTables() {
	db.Exec("DROP TABLE stat")
	_, err := db.Exec("CREATE TABLE stat (key, value)")
	if nil != err {
		logging.LogFatalf("create table [stat] failed: %s", err)
	}
	setDatabaseVer()

	db.Exec("DROP TABLE blocks")
	_, err = db.Exec("CREATE TABLE blocks (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated)")
	if nil != err {
		logging.LogFatalf("create table [blocks] failed: %s", err)
	}

	db.Exec("DROP TABLE blocks_fts")
	_, err = db.Exec("CREATE VIRTUAL TABLE blocks_fts USING fts5(id UNINDEXED, parent_id UNINDEXED, root_id UNINDEXED, hash UNINDEXED, box UNINDEXED, path UNINDEXED, hpath, name, alias, memo, tag, content, fcontent, markdown UNINDEXED, length UNINDEXED, type UNINDEXED, subtype UNINDEXED, ial, sort UNINDEXED, created UNINDEXED, updated UNINDEXED, tokenize=\"siyuan\")")
	if nil != err {
		logging.LogFatalf("create table [blocks_fts] failed: %s", err)
	}

	db.Exec("DROP TABLE blocks_fts_case_insensitive")
	_, err = db.Exec("CREATE VIRTUAL TABLE blocks_fts_case_insensitive USING fts5(id UNINDEXED, parent_id UNINDEXED, root_id UNINDEXED, hash UNINDEXED, box UNINDEXED, path UNINDEXED, hpath, name, alias, memo, tag, content, fcontent, markdown UNINDEXED, length UNINDEXED, type UNINDEXED, subtype UNINDEXED, ial, sort UNINDEXED, created UNINDEXED, updated UNINDEXED, tokenize=\"siyuan case_insensitive\")")
	if nil != err {
		logging.LogFatalf("create table [blocks_fts_case_insensitive] failed: %s", err)
	}

	db.Exec("DROP TABLE spans")
	_, err = db.Exec("CREATE TABLE spans (id, block_id, root_id, box, path, content, markdown, type, ial)")
	if nil != err {
		logging.LogFatalf("create table [spans] failed: %s", err)
	}

	db.Exec("DROP TABLE assets")
	_, err = db.Exec("CREATE TABLE assets (id, block_id, root_id, box, docpath, path, name, title, hash)")
	if nil != err {
		logging.LogFatalf("create table [assets] failed: %s", err)
	}

	db.Exec("DROP TABLE attributes")
	_, err = db.Exec("CREATE TABLE attributes (id, name, value, type, block_id, root_id, box, path)")
	if nil != err {
		logging.LogFatalf("create table [attributes] failed: %s", err)
	}

	db.Exec("DROP TABLE refs")
	_, err = db.Exec("CREATE TABLE refs (id, def_block_id, def_block_parent_id, def_block_root_id, def_block_path, block_id, root_id, box, path, content, markdown, type)")
	if nil != err {
		logging.LogFatalf("create table [refs] failed: %s", err)
	}

	db.Exec("DROP TABLE file_annotation_refs")
	_, err = db.Exec("CREATE TABLE file_annotation_refs (id, file_path, annotation_id, block_id, root_id, box, path, content, type)")
	if nil != err {
		logging.LogFatalf("create table [refs] failed: %s", err)
	}
}

func IndexMode() {
	if nil != db {
		db.Close()
	}
	dsn := util.DBPath + "?_journal_mode=OFF" +
		"&_synchronous=OFF" +
		"&_secure_delete=OFF" +
		"&_cache_size=-20480" +
		"&_page_size=8192" +
		"&_busy_timeout=7000" +
		"&_ignore_check_constraints=ON" +
		"&_temp_store=MEMORY" +
		"&_case_sensitive_like=OFF" +
		"&_locking_mode=EXCLUSIVE"
	var err error
	db, err = sql.Open("sqlite3_extended", dsn)
	if nil != err {
		logging.LogFatalf("create database failed: %s", err)
	}
	db.SetMaxIdleConns(1)
	db.SetMaxOpenConns(1)
	db.SetConnMaxLifetime(365 * 24 * time.Hour)
}

func NormalMode() {
	initDBConnection()
}

func initDBConnection() {
	if nil != db {
		db.Close()
	}
	dsn := util.DBPath + "?_journal_mode=WAL" +
		"&_synchronous=OFF" +
		"&_secure_delete=OFF" +
		"&_cache_size=-20480" +
		"&_page_size=8192" +
		"&_busy_timeout=7000" +
		"&_ignore_check_constraints=ON" +
		"&_temp_store=MEMORY" +
		"&_case_sensitive_like=OFF"
	var err error
	db, err = sql.Open("sqlite3_extended", dsn)
	if nil != err {
		logging.LogFatalf("create database failed: %s", err)
	}
	db.SetMaxIdleConns(20)
	db.SetMaxOpenConns(20)
	db.SetConnMaxLifetime(365 * 24 * time.Hour)
}

func SetCaseSensitive(b bool) {
	if b {
		db.Exec("PRAGMA case_sensitive_like = ON;")
	} else {
		db.Exec("PRAGMA case_sensitive_like = OFF;")
	}
}

func refsFromTree(tree *parse.Tree) (refs []*Ref, fileAnnotationRefs []*FileAnnotationRef) {
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering {
			return ast.WalkContinue
		}

		if ast.NodeBlockRefID == n.Type {
			ref := buildRef(tree, n)
			refs = append(refs, ref)
		} else if ast.NodeFileAnnotationRefID == n.Type {
			pathID := n.TokensStr()
			idx := strings.LastIndex(pathID, "/")
			if -1 == idx {
				return ast.WalkContinue
			}

			filePath := pathID[:idx]
			annotationID := pathID[idx+1:]

			anchor := n.Parent.ChildByType(ast.NodeFileAnnotationRefText)
			text := filePath
			if nil != anchor {
				text = anchor.Text()
			}
			parentBlock := treenode.ParentBlock(n)
			ref := &FileAnnotationRef{
				ID:           ast.NewNodeID(),
				FilePath:     filePath,
				AnnotationID: annotationID,
				BlockID:      parentBlock.ID,
				RootID:       tree.ID,
				Box:          tree.Box,
				Path:         tree.Path,
				Content:      text,
				Type:         treenode.TypeAbbr(n.Type.String()),
			}
			fileAnnotationRefs = append(fileAnnotationRefs, ref)
		}
		return ast.WalkContinue
	})
	return
}

func buildRef(tree *parse.Tree, refIDNode *ast.Node) *Ref {
	markdown := treenode.FormatNode(refIDNode.Parent, luteEngine)
	defBlockID := refIDNode.TokensStr()
	var defBlockParentID, defBlockRootID, defBlockPath string
	defBlock := treenode.GetBlockTree(defBlockID)
	if nil != defBlock {
		defBlockParentID = defBlock.ParentID
		defBlockRootID = defBlock.RootID
		defBlockPath = defBlock.Path
	}
	text := treenode.GetDynamicBlockRefText(refIDNode.Parent)
	parentBlock := treenode.ParentBlock(refIDNode)
	return &Ref{
		ID:               ast.NewNodeID(),
		DefBlockID:       defBlockID,
		DefBlockParentID: defBlockParentID,
		DefBlockRootID:   defBlockRootID,
		DefBlockPath:     defBlockPath,
		BlockID:          parentBlock.ID,
		RootID:           tree.ID,
		Box:              tree.Box,
		Path:             tree.Path,
		Content:          text,
		Markdown:         markdown,
		Type:             treenode.TypeAbbr(refIDNode.Type.String()),
	}
}

func ResolveRefContent(block *Block, anchors *map[string]string) (ret string) {
	if "d" == block.Type {
		(*anchors)[block.ID] = block.Content
		return block.Content
	}

	tree := parse.Parse("", []byte(block.Markdown), luteEngine.ParseOptions)
	depth := 0
	var stack []string
	c := treenode.FirstLeafBlock(tree.Root)
	ret = resolveRefContent0(c, anchors, &depth, &stack)
	return
}

func resolveRefContent0(node *ast.Node, anchors *map[string]string, depth *int, stack *[]string) (ret string) {
	*depth++
	if 7 < *depth {
		return ""
	}
	if ast.NodeBlockRefID == node.Type {
		id := node.TokensStr()
		var ok bool
		if ret, ok = (*anchors)[id]; ok {
			return ret
		}

		if gulu.Str.Contains(id, *stack) {
			return ""
		}

		defBlock := GetBlock(id)
		if nil == defBlock {
			return "block not found"
		}

		if "" != defBlock.Name {
			(*anchors)[id] = defBlock.Name
			return defBlock.Name
		}

		if "d" == defBlock.Type {
			(*anchors)[id] = defBlock.Content
			return defBlock.Content
		}

		tree := parse.Parse("", gulu.Str.ToBytes(defBlock.Markdown), luteEngine.ParseOptions)
		c := treenode.FirstLeafBlock(tree.Root)
		*stack = append(*stack, id)
		ret = resolveRefContent0(c, anchors, depth, stack)
		(*anchors)[id] = ret
		return
	}

	buf := &bytes.Buffer{}
	buf.Grow(4096)
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		switch n.Type {
		case ast.NodeDocument:
			buf.WriteString(n.IALAttr("title"))
			return ast.WalkStop
		case ast.NodeTagOpenMarker, ast.NodeTagCloseMarker:
			buf.WriteByte('#')
		case ast.NodeText, ast.NodeLinkText, ast.NodeLinkTitle, ast.NodeFileAnnotationRefText, ast.NodeFootnotesRef,
			ast.NodeCodeSpanContent, ast.NodeInlineMathContent, ast.NodeCodeBlockCode, ast.NodeMathBlockContent:
			buf.Write(n.Tokens)
		case ast.NodeBlockRef:
			if anchor := n.ChildByType(ast.NodeBlockRefText); nil != anchor {
				buf.WriteString(anchor.Text())
				return ast.WalkSkipChildren
			} else if anchor = n.ChildByType(ast.NodeBlockRefDynamicText); nil != anchor {
				buf.WriteString(anchor.Text())
				return ast.WalkSkipChildren
			}

			defID := n.ChildByType(ast.NodeBlockRefID)
			anchor := resolveRefContent0(defID, anchors, depth, stack)
			(*anchors)[defID.TokensStr()] = anchor
			buf.WriteString(anchor)
		}
		return ast.WalkContinue
	})
	return buf.String()
}

func fromTree(node *ast.Node, tree *parse.Tree) (blocks []*Block, spans []*Span, assets []*Asset, attributes []*Attribute) {
	rootID := tree.Root.ID
	boxID := tree.Box
	p := tree.Path
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		// 构造行级元素
		spanBlocks, spanSpans, spanAssets, spanAttrs, walkStatus := buildSpanFromNode(n, tree, rootID, boxID, p)
		if 0 < len(spanBlocks) {
			blocks = append(blocks, spanBlocks...)
		}
		if 0 < len(spanSpans) {
			spans = append(spans, spanSpans...)
		}
		if 0 < len(spanAssets) {
			assets = append(assets, spanAssets...)
		}
		if 0 < len(spanAttrs) {
			attributes = append(attributes, spanAttrs...)
		}

		// 构造属性
		attrs := buildAttributeFromNode(n, rootID, boxID, p)
		if 0 < len(attrs) {
			attributes = append(attributes, attrs...)
		}
		if -1 != walkStatus {
			return walkStatus
		}

		// 构造块级元素
		if "" == n.ID || !n.IsBlock() {
			return ast.WalkContinue
		}

		b, attrs := buildBlockFromNode(n, tree)
		blocks = append(blocks, b)
		if 0 < len(attrs) {
			attributes = append(attributes, attrs...)
		}
		return ast.WalkContinue
	})
	return
}

func buildAttributeFromNode(n *ast.Node, rootID, boxID, p string) (attributes []*Attribute) {
	switch n.Type {
	case ast.NodeKramdownSpanIAL:
		parentBlock := treenode.ParentBlock(n)
		attrs := parse.IALValMap(n)
		for name, val := range attrs {
			if !isAttr(name) {
				continue
			}

			attr := &Attribute{
				ID:      ast.NewNodeID(),
				Name:    name,
				Value:   val,
				Type:    "s",
				BlockID: parentBlock.ID,
				RootID:  rootID,
				Box:     boxID,
				Path:    p,
			}
			attributes = append(attributes, attr)
		}
	case ast.NodeKramdownBlockIAL:
		attrs := parse.IALValMap(n)
		for name, val := range attrs {
			if !isAttr(name) {
				continue
			}

			attr := &Attribute{
				ID:      ast.NewNodeID(),
				Name:    name,
				Value:   val,
				Type:    "b",
				BlockID: n.ID,
				RootID:  rootID,
				Box:     boxID,
				Path:    p,
			}
			attributes = append(attributes, attr)
		}
	}
	return
}

func isAttr(name string) bool {
	return strings.HasPrefix(name, "custom-") || "name" == name || "alias" == name || "memo" == name || "bookmark" == name || "fold" == name || "heading-fold" == name || "style" == name
}

func buildSpanFromNode(n *ast.Node, tree *parse.Tree, rootID, boxID, p string) (blocks []*Block, spans []*Span, assets []*Asset, attributes []*Attribute, walkStatus ast.WalkStatus) {
	boxLocalPath := filepath.Join(util.DataDir, boxID)
	docDirLocalPath := filepath.Join(boxLocalPath, p)
	switch n.Type {
	case ast.NodeLinkText:
		text := n.Text()
		markdown := treenode.FormatNode(n.Parent, luteEngine)
		parentBlock := treenode.ParentBlock(n)
		span := &Span{
			ID:       ast.NewNodeID(),
			BlockID:  parentBlock.ID,
			RootID:   rootID,
			Box:      boxID,
			Path:     p,
			Content:  text,
			Markdown: markdown,
			Type:     treenode.TypeAbbr(n.Type.String()),
			IAL:      treenode.IALStr(n),
		}
		spans = append(spans, span)
		walkStatus = ast.WalkContinue
		return
	case ast.NodeTag, ast.NodeInlineMath, ast.NodeCodeSpan, ast.NodeEmphasis, ast.NodeStrong, ast.NodeStrikethrough, ast.NodeMark, ast.NodeSup, ast.NodeSub, ast.NodeKbd, ast.NodeUnderline:
		var text string
		switch n.Type {
		case ast.NodeTag, ast.NodeEmphasis, ast.NodeStrong, ast.NodeStrikethrough, ast.NodeMark, ast.NodeSup, ast.NodeSub, ast.NodeKbd, ast.NodeUnderline:
			text = n.Text()
		case ast.NodeInlineMath:
			text = n.ChildByType(ast.NodeInlineMathContent).TokensStr()
		case ast.NodeCodeSpan:
			text = n.ChildByType(ast.NodeCodeSpanContent).TokensStr()
		}

		markdown := treenode.FormatNode(n, luteEngine)
		parentBlock := treenode.ParentBlock(n)
		span := &Span{
			ID:       ast.NewNodeID(),
			BlockID:  parentBlock.ID,
			RootID:   rootID,
			Box:      boxID,
			Path:     p,
			Content:  text,
			Markdown: markdown,
			Type:     treenode.TypeAbbr(n.Type.String()),
			IAL:      treenode.IALStr(n),
		}
		spans = append(spans, span)
		walkStatus = ast.WalkSkipChildren
		return
	case ast.NodeLinkDest:
		text := n.TokensStr()
		markdown := treenode.FormatNode(n.Parent, luteEngine)
		parentBlock := treenode.ParentBlock(n)
		span := &Span{
			ID:       ast.NewNodeID(),
			BlockID:  parentBlock.ID,
			RootID:   rootID,
			Box:      boxID,
			Path:     p,
			Content:  text,
			Markdown: markdown,
			Type:     treenode.TypeAbbr(n.Type.String()),
			IAL:      treenode.IALStr(n),
		}
		spans = append(spans, span)

		// assetsLinkDestsInTree

		if !IsAssetLinkDest(n.Tokens) {
			walkStatus = ast.WalkContinue
			return
		}

		dest := gulu.Str.FromBytes(n.Tokens)
		parentBlock = treenode.ParentBlock(n)
		var title string
		if titleNode := n.Parent.ChildByType(ast.NodeLinkTitle); nil != titleNode {
			title = gulu.Str.FromBytes(titleNode.Tokens)
		}

		var hash string
		var hashErr error
		if lp := assetLocalPath(dest, boxLocalPath, docDirLocalPath); "" != lp {
			if !gulu.File.IsDir(lp) {
				hash, hashErr = util.GetEtag(lp)
				if nil != hashErr {
					logging.LogErrorf("calc asset [%s] hash failed: %s", lp, hashErr)
				}
			}
		}
		name, _ := util.LastID(dest)
		asset := &Asset{
			ID:      ast.NewNodeID(),
			BlockID: parentBlock.ID,
			RootID:  rootID,
			Box:     boxID,
			DocPath: p,
			Path:    dest,
			Name:    name,
			Title:   title,
			Hash:    hash,
		}
		assets = append(assets, asset)
		walkStatus = ast.WalkSkipChildren
		return
	case ast.NodeDocument:
		if asset := docTitleImgAsset(n); nil != asset {
			assets = append(assets, asset)
		}
		if tags := docTagSpans(n); 0 < len(tags) {
			spans = append(spans, tags...)
		}
	case ast.NodeInlineHTML, ast.NodeHTMLBlock, ast.NodeIFrame, ast.NodeWidget, ast.NodeAudio, ast.NodeVideo:
		nodes, err := html.ParseFragment(bytes.NewReader(n.Tokens), &html.Node{Type: html.ElementNode})
		if nil != err {
			logging.LogErrorf("parse HTML failed: %s", err)
			walkStatus = ast.WalkContinue
			return
		}
		if 1 > len(nodes) &&
			ast.NodeHTMLBlock != n.Type { // HTML 块若内容为空时无法在数据库中查询到 https://github.com/siyuan-note/siyuan/issues/4691
			walkStatus = ast.WalkContinue
			return
		}

		if ast.NodeHTMLBlock == n.Type || ast.NodeIFrame == n.Type || ast.NodeWidget == n.Type || ast.NodeAudio == n.Type || ast.NodeVideo == n.Type {
			b, attrs := buildBlockFromNode(n, tree)
			blocks = append(blocks, b)
			attributes = append(attributes, attrs...)
		}

		if 1 > len(nodes) {
			walkStatus = ast.WalkContinue
			return
		}

		var src []byte
		for _, attr := range nodes[0].Attr {
			if "src" == attr.Key || "data-assets" == attr.Key || "custom-data-assets" == attr.Key {
				src = gulu.Str.ToBytes(attr.Val)
				break
			}
		}
		if 1 > len(src) {
			walkStatus = ast.WalkContinue
			return
		}

		if !IsAssetLinkDest(src) {
			walkStatus = ast.WalkContinue
			return
		}

		dest := string(src)
		var hash string
		var hashErr error
		if lp := assetLocalPath(dest, boxLocalPath, docDirLocalPath); "" != lp {
			hash, hashErr = util.GetEtag(lp)
			if nil != hashErr {
				logging.LogErrorf("calc asset [%s] hash failed: %s", lp, hashErr)
			}
		}

		parentBlock := treenode.ParentBlock(n)
		if ast.NodeInlineHTML != n.Type {
			parentBlock = n
		}
		name, _ := util.LastID(dest)
		asset := &Asset{
			ID:      ast.NewNodeID(),
			BlockID: parentBlock.ID,
			RootID:  rootID,
			Box:     boxID,
			DocPath: p,
			Path:    dest,
			Name:    name,
			Title:   "",
			Hash:    hash,
		}
		assets = append(assets, asset)
		walkStatus = ast.WalkSkipChildren
		return
	}
	walkStatus = -1
	return
}

func BuildBlockFromNode(n *ast.Node, tree *parse.Tree) (block *Block) {
	block, _ = buildBlockFromNode(n, tree)
	return
}

func buildBlockFromNode(n *ast.Node, tree *parse.Tree) (block *Block, attributes []*Attribute) {
	boxID := tree.Box
	p := tree.Path
	rootID := tree.Root.ID
	name := html.UnescapeString(n.IALAttr("name"))
	alias := html.UnescapeString(n.IALAttr("alias"))
	memo := html.UnescapeString(n.IALAttr("memo"))
	tag := tagFromNode(n)

	var content, fcontent, markdown, parentID string
	ialContent := treenode.IALStr(n)
	hash := treenode.NodeHash(n, tree, luteEngine)
	var length int
	if ast.NodeDocument == n.Type {
		content = n.IALAttr("title")
		fcontent = content
		length = utf8.RuneCountInString(fcontent)
	} else if n.IsContainerBlock() {
		markdown, content = treenode.NodeStaticMdContent(n, luteEngine)
		fc := treenode.FirstLeafBlock(n)
		fcontent = treenode.NodeStaticContent(fc)
		parentID = n.Parent.ID
		// 将标题块作为父节点
		if h := heading(n); nil != h {
			parentID = h.ID
		}
		length = utf8.RuneCountInString(fcontent)
	} else {
		markdown, content = treenode.NodeStaticMdContent(n, luteEngine)
		parentID = n.Parent.ID
		// 将标题块作为父节点
		if h := heading(n); nil != h {
			parentID = h.ID
		}
		length = utf8.RuneCountInString(content)
	}

	block = &Block{
		ID:       n.ID,
		ParentID: parentID,
		RootID:   rootID,
		Hash:     hash,
		Box:      boxID,
		Path:     p,
		HPath:    tree.HPath,
		Name:     name,
		Alias:    alias,
		Memo:     memo,
		Tag:      tag,
		Content:  content,
		FContent: fcontent,
		Markdown: markdown,
		Length:   length,
		Type:     treenode.TypeAbbr(n.Type.String()),
		SubType:  treenode.SubTypeAbbr(n),
		IAL:      ialContent,
		Sort:     nSort(n),
		Created:  util.TimeFromID(n.ID),
		Updated:  n.IALAttr("updated"),
	}

	attrs := parse.IAL2Map(n.KramdownIAL)
	for attrName, attrVal := range attrs {
		if !isAttr(attrName) {
			continue
		}

		attr := &Attribute{
			ID:      ast.NewNodeID(),
			Name:    attrName,
			Value:   attrVal,
			Type:    "b",
			BlockID: n.ID,
			RootID:  rootID,
			Box:     boxID,
			Path:    p,
		}
		attributes = append(attributes, attr)
	}
	return
}

func tagFromNode(node *ast.Node) (ret string) {
	tagBuilder := bytes.Buffer{}

	if ast.NodeDocument == node.Type {
		tagIAL := html.UnescapeString(node.IALAttr("tags"))
		tags := strings.Split(tagIAL, ",")
		for _, t := range tags {
			t = strings.TrimSpace(t)
			if "" == t {
				continue
			}
			tagBuilder.WriteString("#")
			tagBuilder.WriteString(t)
			tagBuilder.WriteString("# ")
		}
		return strings.TrimSpace(tagBuilder.String())
	}

	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeTag == n.Type {
			tagBuilder.WriteString("#")
			tagBuilder.WriteString(n.Text())
			tagBuilder.WriteString("# ")
		}
		return ast.WalkContinue
	})
	return strings.TrimSpace(tagBuilder.String())
}

func heading(node *ast.Node) *ast.Node {
	currentLevel := 16
	if ast.NodeHeading == node.Type {
		currentLevel = node.HeadingLevel
	} else if ast.NodeSuperBlock == node.Type {
		superBlockHeading := treenode.SuperBlockHeading(node)
		if nil != superBlockHeading {
			node = superBlockHeading
			currentLevel = node.HeadingLevel
		}
	}

	for prev := node.Previous; nil != prev; prev = prev.Previous {
		if ast.NodeHeading == prev.Type {
			if prev.HeadingLevel < currentLevel {
				return prev
			}
		}
	}
	return nil
}

func DeleteBlockByIDs(tx *sql.Tx, ids []string) (err error) {
	return deleteBlocksByIDs(tx, ids)
}

func DeleteByBoxTx(tx *sql.Tx, box string) (err error) {
	if err = deleteBlocksByBoxTx(tx, box); nil != err {
		return
	}
	if err = deleteSpansByBoxTx(tx, box); nil != err {
		return
	}
	if err = deleteAssetsByBoxTx(tx, box); nil != err {
		return
	}
	if err = deleteAttributesByBoxTx(tx, box); nil != err {
		return
	}
	if err = deleteRefsByBoxTx(tx, box); nil != err {
		return
	}
	if err = deleteFileAnnotationRefsByBoxTx(tx, box); nil != err {
		return
	}
	return
}

func deleteBlocksByIDs(tx *sql.Tx, ids []string) (err error) {
	in := bytes.Buffer{}
	in.Grow(4096)
	in.WriteString("(")
	for i, id := range ids {
		in.WriteString("'")
		in.WriteString(id)
		in.WriteString("'")
		if i < len(ids)-1 {
			in.WriteString(",")
		}

		removeBlockCache(id)
	}
	in.WriteString(")")
	stmt := "DELETE FROM blocks WHERE id IN " + in.String()
	if err = execStmtTx(tx, stmt); nil != err {
		return
	}
	stmt = "DELETE FROM blocks_fts WHERE id IN " + in.String()
	if err = execStmtTx(tx, stmt); nil != err {
		return
	}
	stmt = "DELETE FROM blocks_fts_case_insensitive WHERE id IN " + in.String()
	if err = execStmtTx(tx, stmt); nil != err {
		return
	}
	return
}

func deleteBlocksByBoxTx(tx *sql.Tx, box string) (err error) {
	stmt := "DELETE FROM blocks WHERE box = ?"
	if err = execStmtTx(tx, stmt, box); nil != err {
		return
	}
	stmt = "DELETE FROM blocks_fts WHERE box = ?"
	if err = execStmtTx(tx, stmt, box); nil != err {
		return
	}
	stmt = "DELETE FROM blocks_fts_case_insensitive WHERE box = ?"
	if err = execStmtTx(tx, stmt, box); nil != err {
		return
	}
	ClearBlockCache()
	return
}

func deleteSpansByPathTx(tx *sql.Tx, box, path string) (err error) {
	stmt := "DELETE FROM spans WHERE box = ? AND path = ?"
	err = execStmtTx(tx, stmt, box, path)
	return
}

func deleteSpansByRootID(tx *sql.Tx, rootID string) (err error) {
	stmt := "DELETE FROM spans WHERE root_id =?"
	err = execStmtTx(tx, stmt, rootID)
	return
}

func deleteSpansByBoxTx(tx *sql.Tx, box string) (err error) {
	stmt := "DELETE FROM spans WHERE box = ?"
	err = execStmtTx(tx, stmt, box)
	return
}

func deleteAssetsByPathTx(tx *sql.Tx, box, path string) (err error) {
	stmt := "DELETE FROM assets WHERE box = ? AND docpath = ?"
	err = execStmtTx(tx, stmt, box, path)
	return
}

func deleteAttributeByBlockID(tx *sql.Tx, blockID string) (err error) {
	stmt := "DELETE FROM attributes WHERE block_id = ?"
	err = execStmtTx(tx, stmt, blockID)
	return
}

func deleteAttributesByPathTx(tx *sql.Tx, box, path string) (err error) {
	stmt := "DELETE FROM attributes WHERE box = ? AND path = ?"
	err = execStmtTx(tx, stmt, box, path)
	return
}

func deleteAssetsByBoxTx(tx *sql.Tx, box string) (err error) {
	stmt := "DELETE FROM assets WHERE box = ?"
	err = execStmtTx(tx, stmt, box)
	return
}

func deleteAttributesByBoxTx(tx *sql.Tx, box string) (err error) {
	stmt := "DELETE FROM attributes WHERE box = ?"
	err = execStmtTx(tx, stmt, box)
	return
}

func deleteRefsByPath(tx *sql.Tx, box, path string) (err error) {
	stmt := "DELETE FROM refs WHERE box = ? AND path = ?"
	err = execStmtTx(tx, stmt, box, path)
	return
}

func deleteRefsByPathTx(tx *sql.Tx, box, path string) (err error) {
	stmt := "DELETE FROM refs WHERE box = ? AND path = ?"
	err = execStmtTx(tx, stmt, box, path)
	return
}

func DeleteRefsByBoxTx(tx *sql.Tx, box string) (err error) {
	if err = deleteFileAnnotationRefsByBoxTx(tx, box); nil != err {
		return
	}
	return deleteRefsByBoxTx(tx, box)
}

func deleteRefsByBoxTx(tx *sql.Tx, box string) (err error) {
	stmt := "DELETE FROM refs WHERE box = ?"
	err = execStmtTx(tx, stmt, box)
	return
}

func deleteFileAnnotationRefsByPath(tx *sql.Tx, box, path string) (err error) {
	stmt := "DELETE FROM file_annotation_refs WHERE box = ? AND path = ?"
	err = execStmtTx(tx, stmt, box, path)
	return
}

func deleteFileAnnotationRefsByPathTx(tx *sql.Tx, box, path string) (err error) {
	stmt := "DELETE FROM file_annotation_refs WHERE box = ? AND path = ?"
	err = execStmtTx(tx, stmt, box, path)
	return
}

func deleteFileAnnotationRefsByBoxTx(tx *sql.Tx, box string) (err error) {
	stmt := "DELETE FROM file_annotation_refs WHERE box = ?"
	err = execStmtTx(tx, stmt, box)
	return
}

func DeleteByRootID(tx *sql.Tx, rootID string) (err error) {
	stmt := "DELETE FROM blocks WHERE root_id = ?"
	if err = execStmtTx(tx, stmt, rootID); nil != err {
		return
	}
	stmt = "DELETE FROM spans WHERE root_id = ?"
	if err = execStmtTx(tx, stmt, rootID); nil != err {
		return
	}
	stmt = "DELETE FROM assets WHERE root_id = ?"
	if err = execStmtTx(tx, stmt, rootID); nil != err {
		return
	}
	stmt = "DELETE FROM refs WHERE root_id = ?"
	if err = execStmtTx(tx, stmt, rootID); nil != err {
		return
	}
	stmt = "DELETE FROM file_annotation_refs WHERE root_id = ?"
	if err = execStmtTx(tx, stmt, rootID); nil != err {
		return
	}
	ClearBlockCache()
	return
}

func batchDeleteByPathPrefix(tx *sql.Tx, boxID, pathPrefix string) (err error) {
	stmt := "DELETE FROM blocks WHERE box = ? AND path LIKE ?"
	if err = execStmtTx(tx, stmt, boxID, pathPrefix+"%"); nil != err {
		return
	}
	stmt = "DELETE FROM blocks_fts WHERE box = ? AND path LIKE ?"
	if err = execStmtTx(tx, stmt, boxID, pathPrefix+"%"); nil != err {
		return
	}
	stmt = "DELETE FROM blocks_fts_case_insensitive WHERE box = ? AND path LIKE ?"
	if err = execStmtTx(tx, stmt, boxID, pathPrefix+"%"); nil != err {
		return
	}
	stmt = "DELETE FROM spans WHERE box = ? AND path LIKE ?"
	if err = execStmtTx(tx, stmt, boxID, pathPrefix+"%"); nil != err {
		return
	}
	stmt = "DELETE FROM assets WHERE box = ? AND docpath LIKE ?"
	if err = execStmtTx(tx, stmt, boxID, pathPrefix+"%"); nil != err {
		return
	}
	stmt = "DELETE FROM refs WHERE box = ? AND path LIKE ?"
	if err = execStmtTx(tx, stmt, boxID, pathPrefix+"%"); nil != err {
		return
	}
	stmt = "DELETE FROM file_annotation_refs WHERE box = ? AND path LIKE ?"
	if err = execStmtTx(tx, stmt, boxID, pathPrefix+"%"); nil != err {
		return
	}
	ClearBlockCache()
	return
}

func batchUpdateHPath(tx *sql.Tx, boxID, rootID, oldHPath, newHPath string) (err error) {
	stmt := "UPDATE blocks SET hpath = ? WHERE box = ? AND root_id = ? AND hpath = ?"
	if err = execStmtTx(tx, stmt, newHPath, boxID, rootID, oldHPath); nil != err {
		return
	}
	stmt = "UPDATE blocks_fts SET hpath = ? WHERE box = ? AND root_id = ? AND hpath = ?"
	if err = execStmtTx(tx, stmt, newHPath, boxID, rootID, oldHPath); nil != err {
		return
	}
	stmt = "UPDATE blocks_fts_case_insensitive SET hpath = ? WHERE box = ? AND root_id = ? AND hpath = ?"
	if err = execStmtTx(tx, stmt, newHPath, boxID, rootID, oldHPath); nil != err {
		return
	}
	ClearBlockCache()
	return
}

func CloseDatabase() {
	if err := db.Close(); nil != err {
		logging.LogErrorf("close database failed: %s", err)
	}
}

func queryRow(query string, args ...interface{}) *sql.Row {
	query = strings.TrimSpace(query)
	if "" == query {
		logging.LogErrorf("statement is empty")
		return nil
	}
	return db.QueryRow(query, args...)
}

func query(query string, args ...interface{}) (*sql.Rows, error) {
	query = strings.TrimSpace(query)
	if "" == query {
		return nil, errors.New("statement is empty")
	}
	return db.Query(query, args...)
}

func BeginTx() (tx *sql.Tx, err error) {
	if tx, err = db.Begin(); nil != err {
		logging.LogErrorf("begin tx failed: %s\n  %s", err, logging.ShortStack())
		if strings.Contains(err.Error(), "database is locked") {
			os.Exit(util.ExitCodeReadOnlyDatabase)
		}
	}
	return
}

func CommitTx(tx *sql.Tx) (err error) {
	if nil == tx {
		logging.LogErrorf("tx is nil")
		return errors.New("tx is nil")
	}

	if err = tx.Commit(); nil != err {
		logging.LogErrorf("commit tx failed: %s\n  %s", err, logging.ShortStack())
	}
	return
}

func RollbackTx(tx *sql.Tx) {
	if err := tx.Rollback(); nil != err {
		logging.LogErrorf("rollback tx failed: %s\n  %s", err, logging.ShortStack())
	}
}

func prepareExecInsertTx(tx *sql.Tx, stmtSQL string, args []interface{}) (err error) {
	stmt, err := tx.Prepare(stmtSQL)
	if nil != err {
		return
	}
	if _, err = stmt.Exec(args...); nil != err {
		logging.LogErrorf("exec database stmt [%s] failed: %s", stmtSQL, err)
		return
	}
	return
}

func execStmtTx(tx *sql.Tx, stmt string, args ...interface{}) (err error) {
	if _, err = tx.Exec(stmt, args...); nil != err {
		if strings.Contains(err.Error(), "database disk image is malformed") {
			tx.Rollback()
			db.Close()
			removeDatabaseFile()
			logging.LogFatalf("database disk image [%s] is malformed, please restart SiYuan kernel to rebuild it", util.DBPath)
		}
		logging.LogErrorf("exec database stmt [%s] failed: %s\n  %s", stmt, err, logging.ShortStack())
		return
	}
	return
}

func nSort(n *ast.Node) int {
	switch n.Type {
	// 以下为块级元素
	case ast.NodeDocument:
		return 0
	case ast.NodeHeading:
		return 5
	case ast.NodeParagraph:
		return 10
	case ast.NodeCodeBlock:
		return 10
	case ast.NodeMathBlock:
		return 10
	case ast.NodeTable:
		return 10
	case ast.NodeHTMLBlock:
		return 10
	case ast.NodeList:
		return 20
	case ast.NodeListItem:
		return 20
	case ast.NodeBlockquote:
		return 20
	case ast.NodeSuperBlock:
		return 30
	// 以下为行级元素
	case ast.NodeText:
		return 200
	case ast.NodeTag:
		return 205
	}
	return 100
}

func ialAttr(ial, name string) (ret string) {
	idx := strings.Index(ial, name)
	if 0 > idx {
		return ""
	}
	ret = ial[idx+len(name)+2:]
	ret = ret[:strings.Index(ret, "\"")]
	return
}

func IsAssetLinkDest(dest []byte) bool {
	return bytes.HasPrefix(dest, []byte("assets/"))
}

func removeDatabaseFile() (err error) {
	err = os.RemoveAll(util.DBPath)
	if nil != err {
		return
	}
	err = os.RemoveAll(util.DBPath + "-shm")
	if nil != err {
		return
	}
	err = os.RemoveAll(util.DBPath + "-wal")
	if nil != err {
		return
	}
	return
}
