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
	"fmt"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"strings"

	"github.com/88250/lute/parse"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var luteEngine = util.NewLute()

func init() {
	luteEngine.RenderOptions.KramdownBlockIAL = false // 数据库 markdown 字段为标准 md，但是要保留 span block ial
}

const (
	BlocksInsert                   = "INSERT INTO blocks (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated) VALUES %s"
	BlocksFTSInsert                = "INSERT INTO blocks_fts (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated) VALUES %s"
	BlocksFTSCaseInsensitiveInsert = "INSERT INTO blocks_fts_case_insensitive (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated) VALUES %s"
	BlocksPlaceholder              = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"

	SpansInsert      = "INSERT INTO spans (id, block_id, root_id, box, path, content, markdown, type, ial) VALUES %s"
	SpansPlaceholder = "(?, ?, ?, ?, ?, ?, ?, ?, ?)"

	AssetsPlaceholder             = "(?, ?, ?, ?, ?, ?, ?, ?, ?)"
	AttributesPlaceholder         = "(?, ?, ?, ?, ?, ?, ?, ?)"
	RefsPlaceholder               = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
	FileAnnotationRefsPlaceholder = "(?, ?, ?, ?, ?, ?, ?, ?, ?)"
)

func insertBlocks(tx *sql.Tx, blocks []*Block, context map[string]interface{}) (err error) {
	if 1 > len(blocks) {
		return
	}

	var bulk []*Block
	for _, block := range blocks {
		bulk = append(bulk, block)
		if 512 > len(bulk) {
			continue
		}

		if err = insertBlocks0(tx, bulk, context); nil != err {
			return
		}
		bulk = []*Block{}
	}
	if 0 < len(bulk) {
		if err = insertBlocks0(tx, bulk, context); nil != err {
			return
		}
	}
	return
}

func insertBlocks0(tx *sql.Tx, bulk []*Block, context map[string]interface{}) (err error) {
	valueStrings := make([]string, 0, len(bulk))
	valueArgs := make([]interface{}, 0, len(bulk)*strings.Count(BlocksPlaceholder, "?"))
	hashBuf := bytes.Buffer{}
	for _, b := range bulk {
		valueStrings = append(valueStrings, BlocksPlaceholder)
		valueArgs = append(valueArgs, b.ID)
		valueArgs = append(valueArgs, b.ParentID)
		valueArgs = append(valueArgs, b.RootID)
		valueArgs = append(valueArgs, b.Hash)
		valueArgs = append(valueArgs, b.Box)
		valueArgs = append(valueArgs, b.Path)
		valueArgs = append(valueArgs, b.HPath)
		valueArgs = append(valueArgs, b.Name)
		valueArgs = append(valueArgs, b.Alias)
		valueArgs = append(valueArgs, b.Memo)
		valueArgs = append(valueArgs, b.Tag)
		valueArgs = append(valueArgs, b.Content)
		valueArgs = append(valueArgs, b.FContent)
		valueArgs = append(valueArgs, b.Markdown)
		valueArgs = append(valueArgs, b.Length)
		valueArgs = append(valueArgs, b.Type)
		valueArgs = append(valueArgs, b.SubType)
		valueArgs = append(valueArgs, b.IAL)
		valueArgs = append(valueArgs, b.Sort)
		valueArgs = append(valueArgs, b.Created)
		valueArgs = append(valueArgs, b.Updated)
		putBlockCache(b)

		hashBuf.WriteString(b.Hash)
	}

	stmt := fmt.Sprintf(BlocksInsert, strings.Join(valueStrings, ","))
	if err = prepareExecInsertTx(tx, stmt, valueArgs); nil != err {
		return
	}
	hashBuf.WriteString("blocks")
	evtHash := fmt.Sprintf("%x", sha256.Sum256(hashBuf.Bytes()))[:7]
	//eventbus.Publish(eventbus.EvtSQLInsertBlocks, context, current, total, len(bulk), evtHash)

	stmt = fmt.Sprintf(BlocksFTSInsert, strings.Join(valueStrings, ","))
	if err = prepareExecInsertTx(tx, stmt, valueArgs); nil != err {
		return
	}

	if !caseSensitive {
		stmt = fmt.Sprintf(BlocksFTSCaseInsensitiveInsert, strings.Join(valueStrings, ","))
		if err = prepareExecInsertTx(tx, stmt, valueArgs); nil != err {
			return
		}
	}
	hashBuf.WriteString("fts")
	evtHash = fmt.Sprintf("%x", sha256.Sum256(hashBuf.Bytes()))[:7]
	eventbus.Publish(eventbus.EvtSQLInsertBlocksFTS, context, len(bulk), evtHash)
	return
}

func insertAttributes(tx *sql.Tx, attributes []*Attribute) (err error) {
	if 1 > len(attributes) {
		return
	}

	var bulk []*Attribute
	for _, attr := range attributes {
		bulk = append(bulk, attr)
		if 512 > len(bulk) {
			continue
		}

		if err = insertAttribute0(tx, bulk); nil != err {
			return
		}
		bulk = []*Attribute{}
	}
	if 0 < len(bulk) {
		if err = insertAttribute0(tx, bulk); nil != err {
			return
		}
	}
	return
}

func insertAttribute0(tx *sql.Tx, bulk []*Attribute) (err error) {
	if 1 > len(bulk) {
		return
	}

	valueStrings := make([]string, 0, len(bulk))
	valueArgs := make([]interface{}, 0, len(bulk)*strings.Count(AttributesPlaceholder, "?"))
	for _, attr := range bulk {
		valueStrings = append(valueStrings, AttributesPlaceholder)
		valueArgs = append(valueArgs, attr.ID)
		valueArgs = append(valueArgs, attr.Name)
		valueArgs = append(valueArgs, attr.Value)
		valueArgs = append(valueArgs, attr.Type)
		valueArgs = append(valueArgs, attr.BlockID)
		valueArgs = append(valueArgs, attr.RootID)
		valueArgs = append(valueArgs, attr.Box)
		valueArgs = append(valueArgs, attr.Path)
	}
	stmt := fmt.Sprintf("INSERT INTO attributes (id, name, value, type, block_id, root_id, box, path) VALUES %s", strings.Join(valueStrings, ","))
	err = prepareExecInsertTx(tx, stmt, valueArgs)
	return
}

func insertAssets(tx *sql.Tx, assets []*Asset) (err error) {
	if 1 > len(assets) {
		return
	}

	var bulk []*Asset
	for _, asset := range assets {
		bulk = append(bulk, asset)
		if 512 > len(bulk) {
			continue
		}

		if err = insertAsset0(tx, bulk); nil != err {
			return
		}
		bulk = []*Asset{}
	}
	if 0 < len(bulk) {
		if err = insertAsset0(tx, bulk); nil != err {
			return
		}
	}
	return
}

func insertAsset0(tx *sql.Tx, bulk []*Asset) (err error) {
	if 1 > len(bulk) {
		return
	}

	valueStrings := make([]string, 0, len(bulk))
	valueArgs := make([]interface{}, 0, len(bulk)*strings.Count(AssetsPlaceholder, "?"))
	for _, asset := range bulk {
		valueStrings = append(valueStrings, AssetsPlaceholder)
		valueArgs = append(valueArgs, asset.ID)
		valueArgs = append(valueArgs, asset.BlockID)
		valueArgs = append(valueArgs, asset.RootID)
		valueArgs = append(valueArgs, asset.Box)
		valueArgs = append(valueArgs, asset.DocPath)
		valueArgs = append(valueArgs, asset.Path)
		valueArgs = append(valueArgs, asset.Name)
		valueArgs = append(valueArgs, asset.Title)
		valueArgs = append(valueArgs, asset.Hash)
	}
	stmt := fmt.Sprintf("INSERT INTO assets (id, block_id, root_id, box, docpath, path, name, title, hash) VALUES %s", strings.Join(valueStrings, ","))
	err = prepareExecInsertTx(tx, stmt, valueArgs)
	return
}

func insertSpans(tx *sql.Tx, spans []*Span) (err error) {
	if 1 > len(spans) {
		return
	}

	var bulk []*Span
	for _, span := range spans {
		bulk = append(bulk, span)
		if 512 > len(bulk) {
			continue
		}

		if err = insertSpans0(tx, bulk); nil != err {
			return
		}
		bulk = []*Span{}
	}
	if 0 < len(bulk) {
		if err = insertSpans0(tx, bulk); nil != err {
			return
		}
	}
	return
}

func insertSpans0(tx *sql.Tx, bulk []*Span) (err error) {
	if 1 > len(bulk) {
		return
	}

	valueStrings := make([]string, 0, len(bulk))
	valueArgs := make([]interface{}, 0, len(bulk)*strings.Count(SpansPlaceholder, "?"))
	for _, span := range bulk {
		valueStrings = append(valueStrings, SpansPlaceholder)
		valueArgs = append(valueArgs, span.ID)
		valueArgs = append(valueArgs, span.BlockID)
		valueArgs = append(valueArgs, span.RootID)
		valueArgs = append(valueArgs, span.Box)
		valueArgs = append(valueArgs, span.Path)
		valueArgs = append(valueArgs, span.Content)
		valueArgs = append(valueArgs, span.Markdown)
		valueArgs = append(valueArgs, span.Type)
		valueArgs = append(valueArgs, span.IAL)
	}
	stmt := fmt.Sprintf(SpansInsert, strings.Join(valueStrings, ","))
	err = prepareExecInsertTx(tx, stmt, valueArgs)
	return
}

func insertBlockRefs(tx *sql.Tx, refs []*Ref) (err error) {
	if 1 > len(refs) {
		return
	}

	var bulk []*Ref
	for _, ref := range refs {
		bulk = append(bulk, ref)
		if 512 > len(bulk) {
			continue
		}

		if err = insertRefs0(tx, bulk); nil != err {
			return
		}
		bulk = []*Ref{}
	}
	if 0 < len(bulk) {
		if err = insertRefs0(tx, bulk); nil != err {
			return
		}
	}
	return
}

func insertRefs0(tx *sql.Tx, bulk []*Ref) (err error) {
	if 1 > len(bulk) {
		return
	}

	valueStrings := make([]string, 0, len(bulk))
	valueArgs := make([]interface{}, 0, len(bulk)*strings.Count(RefsPlaceholder, "?"))
	for _, ref := range bulk {
		valueStrings = append(valueStrings, RefsPlaceholder)
		valueArgs = append(valueArgs, ref.ID)
		valueArgs = append(valueArgs, ref.DefBlockID)
		valueArgs = append(valueArgs, ref.DefBlockParentID)
		valueArgs = append(valueArgs, ref.DefBlockRootID)
		valueArgs = append(valueArgs, ref.DefBlockPath)
		valueArgs = append(valueArgs, ref.BlockID)
		valueArgs = append(valueArgs, ref.RootID)
		valueArgs = append(valueArgs, ref.Box)
		valueArgs = append(valueArgs, ref.Path)
		valueArgs = append(valueArgs, ref.Content)
		valueArgs = append(valueArgs, ref.Markdown)
		valueArgs = append(valueArgs, ref.Type)

		putRefCache(ref)
	}
	stmt := fmt.Sprintf("INSERT INTO refs (id, def_block_id, def_block_parent_id, def_block_root_id, def_block_path, block_id, root_id, box, path, content, markdown, type) VALUES %s", strings.Join(valueStrings, ","))
	err = prepareExecInsertTx(tx, stmt, valueArgs)
	return
}

func insertFileAnnotationRefs(tx *sql.Tx, refs []*FileAnnotationRef) (err error) {
	if 1 > len(refs) {
		return
	}

	var bulk []*FileAnnotationRef
	for _, ref := range refs {
		bulk = append(bulk, ref)
		if 512 > len(bulk) {
			continue
		}

		if err = insertFileAnnotationRefs0(tx, bulk); nil != err {
			return
		}
		bulk = []*FileAnnotationRef{}
	}
	if 0 < len(bulk) {
		if err = insertFileAnnotationRefs0(tx, bulk); nil != err {
			return
		}
	}
	return
}

func insertFileAnnotationRefs0(tx *sql.Tx, bulk []*FileAnnotationRef) (err error) {
	if 1 > len(bulk) {
		return
	}

	valueStrings := make([]string, 0, len(bulk))
	valueArgs := make([]interface{}, 0, len(bulk)*strings.Count(FileAnnotationRefsPlaceholder, "?"))
	for _, ref := range bulk {
		valueStrings = append(valueStrings, FileAnnotationRefsPlaceholder)
		valueArgs = append(valueArgs, ref.ID)
		valueArgs = append(valueArgs, ref.FilePath)
		valueArgs = append(valueArgs, ref.AnnotationID)
		valueArgs = append(valueArgs, ref.BlockID)
		valueArgs = append(valueArgs, ref.RootID)
		valueArgs = append(valueArgs, ref.Box)
		valueArgs = append(valueArgs, ref.Path)
		valueArgs = append(valueArgs, ref.Content)
		valueArgs = append(valueArgs, ref.Type)
	}
	stmt := fmt.Sprintf("INSERT INTO file_annotation_refs (id, file_path, annotation_id, block_id, root_id, box, path, content, type) VALUES %s", strings.Join(valueStrings, ","))
	err = prepareExecInsertTx(tx, stmt, valueArgs)
	return
}

func insertRefs(tx *sql.Tx, tree *parse.Tree) (err error) {
	refs, fileAnnotationRefs := refsFromTree(tree)
	if err = insertBlockRefs(tx, refs); nil != err {
		return
	}
	if err = insertFileAnnotationRefs(tx, fileAnnotationRefs); nil != err {
		return
	}
	return err
}

func indexTree(tx *sql.Tx, box, p string, context map[string]interface{}) (err error) {
	tree, err := filesys.LoadTree(box, p, luteEngine)
	if nil != err {
		return
	}

	err = insertTree(tx, tree, context)
	return
}

func insertTree(tx *sql.Tx, tree *parse.Tree, context map[string]interface{}) (err error) {
	blocks, spans, assets, attributes := fromTree(tree.Root, tree)
	refs, fileAnnotationRefs := refsFromTree(tree)
	err = insertTree0(tx, tree, context, blocks, spans, assets, attributes, refs, fileAnnotationRefs)
	return
}

func upsertTree(tx *sql.Tx, tree *parse.Tree, context map[string]interface{}) (err error) {
	oldBlockHashes := queryBlockHashes(tree.ID)
	blocks, spans, assets, attributes := fromTree(tree.Root, tree)
	newBlockHashes := map[string]string{}
	for _, block := range blocks {
		newBlockHashes[block.ID] = block.Hash
	}
	unChanges := hashset.New()
	var toRemoves []string
	for id, hash := range oldBlockHashes {
		if newHash, ok := newBlockHashes[id]; ok {
			if newHash == hash {
				unChanges.Add(id)
			}
		} else {
			toRemoves = append(toRemoves, id)
		}
	}
	tmp := blocks[:0]
	for _, b := range blocks {
		if !unChanges.Contains(b.ID) {
			tmp = append(tmp, b)
		}
	}
	blocks = tmp
	for _, b := range blocks {
		toRemoves = append(toRemoves, b.ID)
	}

	if err = deleteBlocksByIDs(tx, toRemoves); nil != err {
		return
	}

	if err = deleteSpansByPathTx(tx, tree.Box, tree.Path); nil != err {
		return
	}
	if err = deleteAssetsByPathTx(tx, tree.Box, tree.Path); nil != err {
		return
	}
	if err = deleteAttributesByPathTx(tx, tree.Box, tree.Path); nil != err {
		return
	}
	if err = deleteRefsByPathTx(tx, tree.Box, tree.Path); nil != err {
		return
	}
	if err = deleteFileAnnotationRefsByPathTx(tx, tree.Box, tree.Path); nil != err {
		return
	}

	refs, fileAnnotationRefs := refsFromTree(tree)
	if err = insertTree0(tx, tree, context, blocks, spans, assets, attributes, refs, fileAnnotationRefs); nil != err {
		return
	}
	return err
}

func insertTree0(tx *sql.Tx, tree *parse.Tree, context map[string]interface{},
	blocks []*Block, spans []*Span, assets []*Asset, attributes []*Attribute,
	refs []*Ref, fileAnnotationRefs []*FileAnnotationRef) (err error) {
	if err = insertBlocks(tx, blocks, context); nil != err {
		return
	}

	if err = insertBlockRefs(tx, refs); nil != err {
		return
	}
	if err = insertFileAnnotationRefs(tx, fileAnnotationRefs); nil != err {
		return
	}

	if 0 < len(spans) {
		// 移除文档标签，否则会重复添加 https://github.com/siyuan-note/siyuan/issues/3723
		if err = deleteSpansByRootID(tx, tree.Root.ID); nil != err {
			return
		}
		if err = insertSpans(tx, spans); nil != err {
			return
		}
	}
	if err = insertAssets(tx, assets); nil != err {
		return
	}
	if err = insertAttributes(tx, attributes); nil != err {
		return
	}
	return
}
