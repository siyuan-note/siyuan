// SiYuan - Refactor your thinking
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
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/mattn/go-sqlite3"
	_ "github.com/mattn/go-sqlite3"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	db        *sql.DB
	historyDB *sql.DB
)

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

var initDatabaseLock = sync.Mutex{}

func InitDatabase(forceRebuild bool) (err error) {
	initDatabaseLock.Lock()
	defer initDatabaseLock.Unlock()

	ClearCache()
	disableCache()
	defer enableCache()

	util.IncBootProgress(2, "Initializing database...")

	if forceRebuild {
		ClearQueue()
	}

	initDBConnection()

	if !forceRebuild {
		// 检查数据库结构版本，如果版本不一致的话说明改过表结构，需要重建
		if util.DatabaseVer == getDatabaseVer() {
			return
		}
		logging.LogInfof("the database structure is changed, rebuilding database...")
	}

	// 不存在库或者版本不一致都会走到这里

	closeDatabase()
	if gulu.File.IsExist(util.DBPath) {
		if err = removeDatabaseFile(); nil != err {
			logging.LogErrorf("remove database file [%s] failed: %s", util.DBPath, err)
			util.PushClearProgress()
			err = nil
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
	_, err := db.Exec("DROP TABLE IF EXISTS stat")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "drop table [stat] failed: %s", err)
	}
	_, err = db.Exec("CREATE TABLE stat (key, value)")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "create table [stat] failed: %s", err)
	}
	setDatabaseVer()

	_, err = db.Exec("DROP TABLE IF EXISTS blocks")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "drop table [blocks] failed: %s", err)
	}
	_, err = db.Exec("CREATE TABLE blocks (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated)")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "create table [blocks] failed: %s", err)
	}

	_, err = db.Exec("DROP TABLE IF EXISTS blocks_fts")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "drop table [blocks_fts] failed: %s", err)
	}
	_, err = db.Exec("CREATE VIRTUAL TABLE blocks_fts USING fts5(id UNINDEXED, parent_id UNINDEXED, root_id UNINDEXED, hash UNINDEXED, box UNINDEXED, path UNINDEXED, hpath, name, alias, memo, tag, content, fcontent, markdown UNINDEXED, length UNINDEXED, type UNINDEXED, subtype UNINDEXED, ial, sort UNINDEXED, created UNINDEXED, updated UNINDEXED, tokenize=\"siyuan\")")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "create table [blocks_fts] failed: %s", err)
	}

	_, err = db.Exec("DROP TABLE IF EXISTS blocks_fts_case_insensitive")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "drop table [blocks_fts_case_insensitive] failed: %s", err)
	}
	_, err = db.Exec("CREATE VIRTUAL TABLE blocks_fts_case_insensitive USING fts5(id UNINDEXED, parent_id UNINDEXED, root_id UNINDEXED, hash UNINDEXED, box UNINDEXED, path UNINDEXED, hpath, name, alias, memo, tag, content, fcontent, markdown UNINDEXED, length UNINDEXED, type UNINDEXED, subtype UNINDEXED, ial, sort UNINDEXED, created UNINDEXED, updated UNINDEXED, tokenize=\"siyuan case_insensitive\")")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "create table [blocks_fts_case_insensitive] failed: %s", err)
	}

	_, err = db.Exec("DROP TABLE IF EXISTS spans")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "drop table [spans] failed: %s", err)
	}
	_, err = db.Exec("CREATE TABLE spans (id, block_id, root_id, box, path, content, markdown, type, ial)")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "create table [spans] failed: %s", err)
	}

	_, err = db.Exec("DROP TABLE IF EXISTS assets")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "drop table [assets] failed: %s", err)
	}
	_, err = db.Exec("CREATE TABLE assets (id, block_id, root_id, box, docpath, path, name, title, hash)")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "create table [assets] failed: %s", err)
	}

	_, err = db.Exec("DROP TABLE IF EXISTS attributes")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "drop table [attributes] failed: %s", err)
	}
	_, err = db.Exec("CREATE TABLE attributes (id, name, value, type, block_id, root_id, box, path)")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "create table [attributes] failed: %s", err)
	}

	_, err = db.Exec("DROP TABLE IF EXISTS refs")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "drop table [refs] failed: %s", err)
	}
	_, err = db.Exec("CREATE TABLE refs (id, def_block_id, def_block_parent_id, def_block_root_id, def_block_path, block_id, root_id, box, path, content, markdown, type)")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "create table [refs] failed: %s", err)
	}

	_, err = db.Exec("DROP TABLE IF EXISTS file_annotation_refs")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "drop table [refs] failed: %s", err)
	}
	_, err = db.Exec("CREATE TABLE file_annotation_refs (id, file_path, annotation_id, block_id, root_id, box, path, content, type)")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "create table [refs] failed: %s", err)
	}
}

func InitHistoryDatabase(forceRebuild bool) {
	initHistoryDBConnection()

	if !forceRebuild && gulu.File.IsExist(util.HistoryDBPath) {
		return
	}

	historyDB.Close()
	if err := os.RemoveAll(util.HistoryDBPath); nil != err {
		logging.LogErrorf("remove history database file [%s] failed: %s", util.HistoryDBPath, err)
		return
	}

	initHistoryDBConnection()
	initHistoryDBTables()
}

func initHistoryDBConnection() {
	if nil != historyDB {
		historyDB.Close()
	}

	dsn := util.HistoryDBPath + "?_journal_mode=WAL" +
		"&_synchronous=OFF" +
		"&_mmap_size=2684354560" +
		"&_secure_delete=OFF" +
		"&_cache_size=-20480" +
		"&_page_size=32768" +
		"&_busy_timeout=7000" +
		"&_ignore_check_constraints=ON" +
		"&_temp_store=MEMORY" +
		"&_case_sensitive_like=OFF"
	var err error
	historyDB, err = sql.Open("sqlite3_extended", dsn)
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "create database failed: %s", err)
	}
	historyDB.SetMaxIdleConns(3)
	historyDB.SetMaxOpenConns(3)
	historyDB.SetConnMaxLifetime(365 * 24 * time.Hour)
}

func initHistoryDBTables() {
	historyDB.Exec("DROP TABLE histories_fts_case_insensitive")
	_, err := historyDB.Exec("CREATE VIRTUAL TABLE histories_fts_case_insensitive USING fts5(id UNINDEXED, type UNINDEXED, op UNINDEXED, title, content, path UNINDEXED, created UNINDEXED, tokenize=\"siyuan case_insensitive\")")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "create table [histories_fts_case_insensitive] failed: %s", err)
	}
}

func initDBConnection() {
	if nil != db {
		closeDatabase()
	}
	dsn := util.DBPath + "?_journal_mode=WAL" +
		"&_synchronous=OFF" +
		"&_mmap_size=2684354560" +
		"&_secure_delete=OFF" +
		"&_cache_size=-20480" +
		"&_page_size=32768" +
		"&_busy_timeout=7000" +
		"&_ignore_check_constraints=ON" +
		"&_temp_store=MEMORY" +
		"&_case_sensitive_like=OFF"
	var err error
	db, err = sql.Open("sqlite3_extended", dsn)
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "create database failed: %s", err)
	}
	db.SetMaxIdleConns(20)
	db.SetMaxOpenConns(20)
	db.SetConnMaxLifetime(365 * 24 * time.Hour)
}

var (
	caseSensitive  bool
	indexAssetPath bool
)

func SetCaseSensitive(b bool) {
	caseSensitive = b
	if b {
		db.Exec("PRAGMA case_sensitive_like = ON;")
	} else {
		db.Exec("PRAGMA case_sensitive_like = OFF;")
	}
}

func SetIndexAssetPath(b bool) {
	indexAssetPath = b
}

func refsFromTree(tree *parse.Tree) (refs []*Ref, fileAnnotationRefs []*FileAnnotationRef) {
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering {
			return ast.WalkContinue
		}

		if treenode.IsBlockRef(n) {
			ref := buildRef(tree, n)
			refs = append(refs, ref)
		} else if treenode.IsFileAnnotationRef(n) {
			pathID := n.TextMarkFileAnnotationRefID
			idx := strings.LastIndex(pathID, "/")
			if -1 == idx {
				return ast.WalkContinue
			}

			filePath := pathID[:idx]
			annotationID := pathID[idx+1:]

			anchor := n.TextMarkTextContent
			text := filePath
			if "" != anchor {
				text = anchor
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
		} else if treenode.IsEmbedBlockRef(n) {
			ref := buildEmbedRef(tree, n)
			refs = append(refs, ref)
		}
		return ast.WalkContinue
	})
	return
}

func buildRef(tree *parse.Tree, refNode *ast.Node) *Ref {
	markdown := treenode.ExportNodeStdMd(refNode, luteEngine)
	defBlockID, text, _ := treenode.GetBlockRef(refNode)
	var defBlockParentID, defBlockRootID, defBlockPath string
	defBlock := treenode.GetBlockTree(defBlockID)
	if nil != defBlock {
		defBlockParentID = defBlock.ParentID
		defBlockRootID = defBlock.RootID
		defBlockPath = defBlock.Path
	}
	parentBlock := treenode.ParentBlock(refNode)
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
		Type:             treenode.TypeAbbr(refNode.Type.String()),
	}
}

func buildEmbedRef(tree *parse.Tree, embedNode *ast.Node) *Ref {
	defBlockID := getEmbedRef(embedNode)
	var defBlockParentID, defBlockRootID, defBlockPath string
	defBlock := treenode.GetBlockTree(defBlockID)
	if nil != defBlock {
		defBlockParentID = defBlock.ParentID
		defBlockRootID = defBlock.RootID
		defBlockPath = defBlock.Path
	}

	return &Ref{
		ID:               ast.NewNodeID(),
		DefBlockID:       defBlockID,
		DefBlockParentID: defBlockParentID,
		DefBlockRootID:   defBlockRootID,
		DefBlockPath:     defBlockPath,
		BlockID:          embedNode.ID,
		RootID:           tree.ID,
		Box:              tree.Box,
		Path:             tree.Path,
		Content:          "", // 通过嵌入块构建引用时定义块可能还没有入库，所以这里统一不填充内容
		Markdown:         "",
		Type:             treenode.TypeAbbr(embedNode.Type.String()),
	}
}

func getEmbedRef(embedNode *ast.Node) (queryBlockID string) {
	queryBlockID = treenode.GetEmbedBlockRef(embedNode)
	return
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
	case ast.NodeImage:
		text := n.Text()
		markdown := treenode.ExportNodeStdMd(n, luteEngine)
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

		destNode := n.ChildByType(ast.NodeLinkDest)
		if nil == destNode {
			return
		}

		// assetsLinkDestsInTree

		if !util.IsAssetLinkDest(destNode.Tokens) {
			return
		}

		dest := gulu.Str.FromBytes(destNode.Tokens)
		var title string
		if titleNode := n.ChildByType(ast.NodeLinkTitle); nil != titleNode {
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
		return
	case ast.NodeTextMark:
		typ := treenode.TypeAbbr(n.Type.String()) + " " + n.TextMarkType
		text := n.Content()
		markdown := treenode.ExportNodeStdMd(n, luteEngine)
		parentBlock := treenode.ParentBlock(n)
		span := &Span{
			ID:       ast.NewNodeID(),
			BlockID:  parentBlock.ID,
			RootID:   rootID,
			Box:      boxID,
			Path:     p,
			Content:  text,
			Markdown: markdown,
			Type:     typ,
			IAL:      treenode.IALStr(n),
		}
		spans = append(spans, span)

		if n.IsTextMarkType("a") {
			dest := n.TextMarkAHref
			if util.IsAssetLinkDest([]byte(dest)) {
				var title string
				if titleNode := n.ChildByType(ast.NodeLinkTitle); nil != titleNode {
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
			}
		}
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

		if !util.IsAssetLinkDest(src) {
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
		markdown = treenode.ExportNodeStdMd(n, luteEngine)
		content = treenode.NodeStaticContent(n, nil, true, indexAssetPath)
		fc := treenode.FirstLeafBlock(n)
		fcontent = treenode.NodeStaticContent(fc, nil, true, false)
		parentID = n.Parent.ID
		// 将标题块作为父节点
		if h := heading(n); nil != h {
			parentID = h.ID
		}
		length = utf8.RuneCountInString(fcontent)
	} else {
		markdown = treenode.ExportNodeStdMd(n, luteEngine)
		content = treenode.NodeStaticContent(n, nil, true, indexAssetPath)
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

		if n.IsTextMarkType("tag") {
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

func deleteByBoxTx(tx *sql.Tx, box string) (err error) {
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
	if err = deleteBlockRefsByBoxTx(tx, box); nil != err {
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
	if !caseSensitive {
		stmt = "DELETE FROM blocks_fts_case_insensitive WHERE id IN " + in.String()
		if err = execStmtTx(tx, stmt); nil != err {
			return
		}
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
	if !caseSensitive {
		stmt = "DELETE FROM blocks_fts_case_insensitive WHERE box = ?"
		if err = execStmtTx(tx, stmt, box); nil != err {
			return
		}
	}
	ClearCache()
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

func deleteRefsByBoxTx(tx *sql.Tx, box string) (err error) {
	if err = deleteFileAnnotationRefsByBoxTx(tx, box); nil != err {
		return
	}
	return deleteBlockRefsByBoxTx(tx, box)
}

func deleteBlockRefsByBoxTx(tx *sql.Tx, box string) (err error) {
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

func deleteByRootID(tx *sql.Tx, rootID string, context map[string]interface{}) (err error) {
	stmt := "DELETE FROM blocks WHERE root_id = ?"
	if err = execStmtTx(tx, stmt, rootID); nil != err {
		return
	}
	stmt = "DELETE FROM blocks_fts WHERE root_id = ?"
	if err = execStmtTx(tx, stmt, rootID); nil != err {
		return
	}
	if !caseSensitive {
		stmt = "DELETE FROM blocks_fts_case_insensitive WHERE root_id = ?"
		if err = execStmtTx(tx, stmt, rootID); nil != err {
			return
		}
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
	ClearCache()
	eventbus.Publish(eventbus.EvtSQLDeleteBlocks, context, rootID)
	return
}

func batchDeleteByRootIDs(tx *sql.Tx, rootIDs []string, context map[string]interface{}) (err error) {
	ids := strings.Join(rootIDs, "','")
	ids = "('" + ids + "')"
	stmt := "DELETE FROM blocks WHERE root_id IN " + ids
	if err = execStmtTx(tx, stmt); nil != err {
		return
	}
	stmt = "DELETE FROM blocks_fts WHERE root_id IN " + ids
	if err = execStmtTx(tx, stmt); nil != err {
		return
	}
	if !caseSensitive {
		stmt = "DELETE FROM blocks_fts_case_insensitive WHERE root_id IN " + ids
		if err = execStmtTx(tx, stmt); nil != err {
			return
		}
	}
	stmt = "DELETE FROM spans WHERE root_id IN " + ids
	if err = execStmtTx(tx, stmt); nil != err {
		return
	}
	stmt = "DELETE FROM assets WHERE root_id IN " + ids
	if err = execStmtTx(tx, stmt); nil != err {
		return
	}
	stmt = "DELETE FROM refs WHERE root_id IN " + ids
	if err = execStmtTx(tx, stmt); nil != err {
		return
	}
	stmt = "DELETE FROM file_annotation_refs WHERE root_id IN " + ids
	if err = execStmtTx(tx, stmt); nil != err {
		return
	}
	ClearCache()
	eventbus.Publish(eventbus.EvtSQLDeleteBlocks, context, fmt.Sprintf("%d", len(rootIDs)))
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
	if !caseSensitive {
		stmt = "DELETE FROM blocks_fts_case_insensitive WHERE box = ? AND path LIKE ?"
		if err = execStmtTx(tx, stmt, boxID, pathPrefix+"%"); nil != err {
			return
		}
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
	ClearCache()
	return
}

func batchUpdateHPath(tx *sql.Tx, boxID, rootID, newHPath string, context map[string]interface{}) (err error) {
	stmt := "UPDATE blocks SET hpath = ? WHERE box = ? AND root_id = ?"
	if err = execStmtTx(tx, stmt, newHPath, boxID, rootID); nil != err {
		return
	}
	stmt = "UPDATE blocks_fts SET hpath = ? WHERE box = ? AND root_id = ?"
	if err = execStmtTx(tx, stmt, newHPath, boxID, rootID); nil != err {
		return
	}
	if !caseSensitive {
		stmt = "UPDATE blocks_fts_case_insensitive SET hpath = ? WHERE box = ? AND root_id = ?"
		if err = execStmtTx(tx, stmt, newHPath, boxID, rootID); nil != err {
			return
		}
	}
	ClearCache()
	evtHash := fmt.Sprintf("%x", sha256.Sum256([]byte(rootID)))[:7]
	eventbus.Publish(eventbus.EvtSQLInsertBlocksFTS, context, 1, evtHash)
	return
}

func CloseDatabase() {
	if err := closeDatabase(); nil != err {
		logging.LogErrorf("close database failed: %s", err)
		return
	}
	if err := historyDB.Close(); nil != err {
		logging.LogErrorf("close history database failed: %s", err)
		return
	}
	logging.LogInfof("closed database")
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

func beginTx() (tx *sql.Tx, err error) {
	if tx, err = db.Begin(); nil != err {
		logging.LogErrorf("begin tx failed: %s\n  %s", err, logging.ShortStack())
		if strings.Contains(err.Error(), "database is locked") {
			os.Exit(logging.ExitCodeReadOnlyDatabase)
		}
	}
	return
}

func beginHistoryTx() (tx *sql.Tx, err error) {
	if tx, err = historyDB.Begin(); nil != err {
		logging.LogErrorf("begin history tx failed: %s\n  %s", err, logging.ShortStack())
		if strings.Contains(err.Error(), "database is locked") {
			os.Exit(logging.ExitCodeReadOnlyDatabase)
		}
	}
	return
}

func commitHistoryTx(tx *sql.Tx) (err error) {
	if nil == tx {
		logging.LogErrorf("tx is nil")
		return errors.New("tx is nil")
	}

	if err = tx.Commit(); nil != err {
		logging.LogErrorf("commit tx failed: %s\n  %s", err, logging.ShortStack())
	}
	return
}

func commitTx(tx *sql.Tx) (err error) {
	if nil == tx {
		logging.LogErrorf("tx is nil")
		return errors.New("tx is nil")
	}

	if err = tx.Commit(); nil != err {
		logging.LogErrorf("commit tx failed: %s\n  %s", err, logging.ShortStack())
	}
	return
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
			closeDatabase()
			removeDatabaseFile()
			logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "database disk image [%s] is malformed, please restart SiYuan kernel to rebuild it", util.DBPath)
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
	case ast.NodeText, ast.NodeTextMark:
		if n.IsTextMarkType("tag") {
			return 205
		}
		return 200
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

func closeDatabase() (err error) {
	if nil == db {
		return
	}

	err = db.Close()
	debug.FreeOSMemory()
	runtime.GC() // 没有这句的话文件句柄不会释放，后面就无法删除文件
	return
}
