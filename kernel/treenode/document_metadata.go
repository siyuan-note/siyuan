// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

var ErrDocumentMetadataUnavailable = errors.New("document metadata is not ready")

// DocumentMetadata 仅是可重建的内部索引；父身份来自 ID 数据路径，不来自展示文字。
type DocumentMetadata struct {
	BoxID      string
	ID         string
	ParentID   *string
	Path       string
	Title      DocumentTitle
	SourceSpec string
	Revision   string
}

type DocumentPathSegment struct {
	ID    string `json:"id"`
	Text  string `json:"text"`
	Empty bool   `json:"empty"`
}

// DocumentPath 的标题与段落边界来自同一个数据库快照，displayPath 仅用于展示。
type DocumentPath struct {
	Notebook    string                `json:"notebook"`
	ID          string                `json:"id"`
	ParentID    *string               `json:"parentID"`
	Path        string                `json:"path"`
	Title       DocumentTitle         `json:"title"`
	Segments    []DocumentPathSegment `json:"segments"`
	Depth       int                   `json:"depth"`
	DisplayPath string                `json:"displayPath"`
	Revision    string                `json:"revision"`
}

func ensureDocumentMetadata(database *sql.DB) error {
	for _, stmt := range []string{
		`CREATE TABLE IF NOT EXISTS document_metadata (
			box_id TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT,
			title_text TEXT NOT NULL COLLATE BINARY, title_empty INTEGER NOT NULL,
			title_format TEXT NOT NULL, source_spec TEXT NOT NULL, revision TEXT NOT NULL,
			PRIMARY KEY (box_id, id))`,
		`CREATE INDEX IF NOT EXISTS idx_document_metadata_parent_title ON document_metadata(box_id, parent_id, title_text, id)`,
		`CREATE TABLE IF NOT EXISTS document_metadata_state (box_id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS document_metadata_pending (
			box_id TEXT NOT NULL, id TEXT NOT NULL, path TEXT NOT NULL, revision TEXT NOT NULL,
			PRIMARY KEY (box_id, id))`,
		`CREATE TRIGGER IF NOT EXISTS delete_document_metadata AFTER DELETE ON blocktrees
			WHEN OLD.type = 'd' BEGIN
			DELETE FROM document_metadata WHERE box_id = OLD.box_id AND id = OLD.id;
		END`,
	} {
		if _, err := database.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

// DocumentRevision 使用版本化 JSON 字段边界，避免拼接碰撞及秒级时间戳遗漏连续更改。
func DocumentRevision(value interface{}) string {
	data, _ := json.Marshal(value)
	digest := sha256.Sum256(data)
	return "1:" + hex.EncodeToString(digest[:])
}

func documentMetadataFromTree(tree *parse.Tree) *DocumentMetadata {
	ret := &DocumentMetadata{BoxID: tree.Box, ID: tree.ID, Path: tree.Path,
		Title: ReadDocumentTitle(tree.Root), SourceSpec: tree.Root.Spec}
	if parent := path.Dir(tree.Path); parent != "/" && parent != "." {
		id := path.Base(parent)
		ret.ParentID = &id
	}
	ret.Revision = DocumentRevision([]interface{}{1, ret.BoxID, ret.ID, ret.Path, ret.Title, ret.SourceSpec})
	return ret
}

func upsertDocumentMetadata(tx *sql.Tx, tree *parse.Tree) error {
	meta := documentMetadataFromTree(tree)
	_, err := tx.Exec(`INSERT INTO document_metadata
		(box_id, id, parent_id, title_text, title_empty, title_format, source_spec, revision)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(box_id, id) DO UPDATE SET
		parent_id=excluded.parent_id, title_text=excluded.title_text, title_empty=excluded.title_empty,
		title_format=excluded.title_format, source_spec=excluded.source_spec, revision=excluded.revision`,
		meta.BoxID, meta.ID, meta.ParentID, meta.Title.Text, meta.Title.Empty, meta.Title.Format, meta.SourceSpec, meta.Revision)
	return err
}

const documentMetadataColumns = `m.box_id, m.id, m.parent_id, b.path,
	m.title_text, m.title_empty, m.title_format, m.source_spec, m.revision`
const documentMetadataJoin = `document_metadata m JOIN blocktrees b INDEXED BY idx_blocktrees_id ON
	b.box_id=m.box_id AND b.id=m.id AND b.type='d'`

// 直接约束块树 ID 并固定身份索引，避免按文档类型扫描后再与摘要连接。
const documentMetadataByIDQuery = "SELECT " + documentMetadataColumns + " FROM " + documentMetadataJoin + " WHERE m.box_id=? AND b.id=?"

func scanDocumentMetadata(row interface{ Scan(...interface{}) error }) (*DocumentMetadata, error) {
	ret := &DocumentMetadata{}
	if err := row.Scan(&ret.BoxID, &ret.ID, &ret.ParentID, &ret.Path,
		&ret.Title.Text, &ret.Title.Empty, &ret.Title.Format, &ret.SourceSpec, &ret.Revision); err != nil {
		return nil, err
	}
	if ret.Title.Format != "plain" || ret.Revision != DocumentRevision([]interface{}{1, ret.BoxID, ret.ID, ret.Path, ret.Title, ret.SourceSpec}) {
		return nil, ErrDocumentMetadataUnavailable
	}
	return ret, nil
}

func DocumentMetadataState(boxID string) string {
	row := queryRowForBox(boxID, "SELECT state FROM document_metadata_state WHERE box_id=? AND version=1", boxID)
	var state string
	if row == nil || row.Scan(&state) != nil {
		return "missing"
	}
	if state == "ready" {
		var pending bool
		row = queryRowForBox(boxID, "SELECT EXISTS(SELECT 1 FROM document_metadata_pending WHERE box_id=?)", boxID)
		if row == nil || row.Scan(&pending) != nil || pending {
			return "building"
		}
	}
	return state
}

// SetDocumentMetadataState 仅在全部文档摘要已补齐时发布 ready，中断的 building 可再次恢复。
func SetDocumentMetadataState(boxID, state string) error {
	indexBlockTreeLock.Lock()
	defer indexBlockTreeLock.Unlock()
	tx, err := beginTxForBox(boxID)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if state == "ready" {
		var missing bool
		if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM blocktrees b LEFT JOIN document_metadata m
			ON m.box_id=b.box_id AND m.id=b.id WHERE b.box_id=? AND b.type='d' AND m.id IS NULL)
			OR EXISTS(SELECT 1 FROM document_metadata_pending WHERE box_id=?)`, boxID, boxID).Scan(&missing); err != nil {
			return err
		}
		if missing {
			return ErrDocumentMetadataUnavailable
		}
	}
	if _, err = tx.Exec(`INSERT INTO document_metadata_state (box_id, version, state) VALUES (?, 1, ?)
		ON CONFLICT(box_id) DO UPDATE SET version=1, state=excluded.state`, boxID, state); err != nil {
		return err
	}
	return tx.Commit()
}

// BeginDocumentMetadataWrite 在源替换前记录恢复身份；正文保存而摘要未变时不产生额外写入。
// 独立的源文件工具可在索引尚未打开时运行，之后由全量索引建立摘要。
func BeginDocumentMetadataWrite(tree *parse.Tree) (bool, error) {
	indexBlockTreeLock.Lock()
	defer indexBlockTreeLock.Unlock()
	if db == nil && getEncryptedBlockTreeDB(tree.Box) == nil {
		return false, nil
	}
	meta := documentMetadataFromTree(tree)
	current, err := GetDocumentMetadata(tree.Box, tree.ID)
	if err == nil && current.Revision == meta.Revision {
		var pending bool
		row := queryRowForBox(tree.Box, "SELECT EXISTS(SELECT 1 FROM document_metadata_pending WHERE box_id=? AND id=?)", tree.Box, tree.ID)
		if row == nil {
			return false, ErrDocumentMetadataUnavailable
		}
		if err = row.Scan(&pending); err != nil {
			return false, err
		}
		if !pending {
			return false, nil
		}
	}
	_, err = execForBox(tree.Box, `INSERT INTO document_metadata_pending (box_id, id, path, revision)
		VALUES (?, ?, ?, ?) ON CONFLICT(box_id, id) DO UPDATE SET path=excluded.path, revision=excluded.revision`,
		tree.Box, tree.ID, tree.Path, meta.Revision)
	return err == nil, err
}

// BeginDocumentMetadataRecovery 在原始文件变更前登记身份，恢复时只信任实际认证源。
func BeginDocumentMetadataRecovery(doc *BlockTree) (bool, error) {
	indexBlockTreeLock.Lock()
	defer indexBlockTreeLock.Unlock()
	if db == nil && getEncryptedBlockTreeDB(doc.BoxID) == nil {
		return false, nil
	}
	_, err := execForBox(doc.BoxID, `INSERT INTO document_metadata_pending (box_id, id, path, revision)
		VALUES (?, ?, ?, '') ON CONFLICT(box_id, id) DO UPDATE SET path=excluded.path, revision=''`,
		doc.BoxID, doc.ID, doc.Path)
	return err == nil, err
}

// CommitDocumentMetadataWrite 仅在源写入成功后调用，文档行、摘要和恢复标记在同一事务提交。
func CommitDocumentMetadataWrite(tree *parse.Tree) error {
	indexBlockTreeLock.Lock()
	defer indexBlockTreeLock.Unlock()
	docs, err := DocHPaths(tree.Box, tree.Path)
	if err != nil {
		return err
	}
	tx, err := beginTxForBox(tree.Box)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	execInsertBlocktrees(tx, tree, []*ast.Node{tree.Root})
	var state string
	if stateErr := tx.QueryRow("SELECT state FROM document_metadata_state WHERE box_id=? AND version=1", tree.Box).Scan(&state); stateErr != nil && !errors.Is(stateErr, sql.ErrNoRows) {
		return stateErr
	}
	// Rebuilds may not yet have descendant summaries. They cannot serve legacy
	// queries until the existing full rebuild publishes ready.
	if state == "ready" {
		if err = refreshDocumentHPathsInTx(tx, tree, docs); err != nil {
			return err
		}
	}

	if _, err = tx.Exec("DELETE FROM document_metadata_pending WHERE box_id=? AND id=? AND revision=?",
		tree.Box, tree.ID, documentMetadataFromTree(tree).Revision); err != nil {
		return err
	}
	return tx.Commit()
}

func PendingDocumentMetadata(boxID string) ([]*BlockTree, error) {
	rows, err := queryForBox(boxID, "SELECT id, path FROM document_metadata_pending WHERE box_id=? ORDER BY path", boxID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ret := []*BlockTree{}
	for rows.Next() {
		doc := &BlockTree{BoxID: boxID, Type: "d"}
		if err = rows.Scan(&doc.ID, &doc.Path); err != nil {
			return nil, err
		}
		doc.RootID = doc.ID
		ret = append(ret, doc)
	}
	return ret, rows.Err()
}

// FinishDocumentMetadataRecovery 由源恢复后清除旧的意图版本，或移除从未落盘的新建索引。
func FinishDocumentMetadataRecovery(boxID, id string, missing bool) error {
	indexBlockTreeLock.Lock()
	defer indexBlockTreeLock.Unlock()
	tx, err := beginTxForBox(boxID)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if missing {
		if _, err = tx.Exec("DELETE FROM blocktrees WHERE box_id=? AND root_id=?", boxID, id); err != nil {
			return err
		}
	}
	if _, err = tx.Exec("DELETE FROM document_metadata_pending WHERE box_id=? AND id=?", boxID, id); err != nil {
		return err
	}
	return tx.Commit()
}

func GetDocumentMetadata(boxID, id string) (*DocumentMetadata, error) {
	row := queryRowForBox(boxID, documentMetadataByIDQuery, boxID, id)
	if row == nil {
		return nil, ErrDocumentMetadataUnavailable
	}
	return scanDocumentMetadata(row)
}

// GetDocumentPath 按 ID 祖先关系组装路径，不跨笔记本回退，也不拆分可读路径。
// notebookDocumentID 由业务层确认，笔记本文档自身表示逻辑根，不能算作普通文档的祖先。
func GetDocumentPath(boxID, id, notebookDocumentID string, mode int) (*DocumentPath, error) {
	tx, err := beginTxForBox(boxID)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	return documentPathInTx(tx, boxID, id, notebookDocumentID, mode)
}

func documentPathInTx(tx *sql.Tx, boxID, id, notebookDocumentID string, mode int) (*DocumentPath, error) {
	var chain []*DocumentMetadata
	seen := map[string]bool{}
	currentID := id
	for {
		if seen[currentID] {
			return nil, ErrDocumentMetadataUnavailable
		}
		seen[currentID] = true
		meta, err := scanDocumentMetadata(tx.QueryRow(documentMetadataByIDQuery, boxID, currentID))
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				var exists bool
				if queryErr := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM blocktrees WHERE box_id=? AND id=? AND type='d')", boxID, currentID).Scan(&exists); queryErr != nil {
					return nil, queryErr
				}
				if exists || len(chain) > 0 {
					return nil, ErrDocumentMetadataUnavailable
				}
			}
			return nil, err
		}
		if len(chain) > 0 && (currentID == notebookDocumentID || strings.TrimSuffix(meta.Path, ".sy") != path.Dir(chain[len(chain)-1].Path)) {
			return nil, ErrDocumentMetadataUnavailable
		}
		chain = append(chain, meta)
		if meta.ParentID == nil {
			if path.Dir(meta.Path) != "/" {
				return nil, ErrDocumentMetadataUnavailable
			}
			break
		}
		currentID = *meta.ParentID
	}
	leaf := chain[0]
	ret := &DocumentPath{Notebook: boxID, ID: id, ParentID: leaf.ParentID, Path: leaf.Path, Title: leaf.Title,
		Segments: []DocumentPathSegment{}}
	var texts, revisions []string
	for i := len(chain) - 1; i >= 0; i-- {
		meta := chain[i]
		revisions = append(revisions, meta.Revision)
		if meta.ID != notebookDocumentID {
			ret.Segments = append(ret.Segments, DocumentPathSegment{ID: meta.ID, Text: meta.Title.Text, Empty: meta.Title.Empty})
			texts = append(texts, meta.Title.Text)
		}
	}
	ret.Depth = len(ret.Segments)
	ret.DisplayPath = "/" + strings.Join(texts, "/")
	ret.Revision = DocumentRevision([]interface{}{1, boxID, id, leaf.Path, mode, revisions})
	return ret, nil
}

// MissingDocumentMetadata 返回需要从源重建的文档身份；不从展示字符串补齐标题。
func MissingDocumentMetadata(boxID string) ([]*BlockTree, error) {
	rows, err := queryForBox(boxID, `SELECT b.id, b.path FROM blocktrees b
		LEFT JOIN document_metadata m ON m.box_id=b.box_id AND m.id=b.id
		WHERE b.box_id=? AND b.type='d' AND m.id IS NULL ORDER BY b.path`, boxID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ret := []*BlockTree{}
	for rows.Next() {
		bt := &BlockTree{BoxID: boxID, Type: "d"}
		if err = rows.Scan(&bt.ID, &bt.Path); err != nil {
			return nil, err
		}
		bt.RootID = bt.ID
		ret = append(ret, bt)
	}
	return ret, rows.Err()
}

// RecoverDocumentMetadata 只为仍在原位置且没有并发更新的文档补建摘要。
func RecoverDocumentMetadata(tree *parse.Tree) error {
	indexBlockTreeLock.Lock()
	defer indexBlockTreeLock.Unlock()
	tx, err := beginTxForBox(tree.Box)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var currentPath string
	if err = tx.QueryRow("SELECT path FROM blocktrees WHERE box_id=? AND id=? AND type='d'", tree.Box, tree.ID).Scan(&currentPath); err != nil {
		return err
	}
	if currentPath != tree.Path {
		return ErrDocumentMetadataUnavailable
	}
	var exists int
	if err = tx.QueryRow("SELECT COUNT(*) FROM document_metadata WHERE box_id=? AND id=?", tree.Box, tree.ID).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		if err = upsertDocumentMetadata(tx, tree); err != nil {
			return err
		}
	}
	return tx.Commit()
}
