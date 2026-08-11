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
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"html"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/microcosm-cc/bluemonday"
	"github.com/siyuan-note/filelock"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const ankiImportNotesPerDocument = 100

var flashcardV2AnkiImportLock sync.Mutex

type flashcardV2AnkiContentWriter struct {
	notebookID string
	importedAt int64
}

type preparedAnkiContentField struct {
	field flashcardv2.AnkiContentField
	dom   string
}

type preparedAnkiContentNote struct {
	note      flashcardv2.AnkiContentNote
	container string
	fields    []preparedAnkiContentField
	written   flashcardv2.AnkiWrittenNote
}

// ImportFlashcardV2AnkiPackage 把 Anki 正文写入普通笔记本，再记录 v2 卡片实体和历史。
func ImportFlashcardV2AnkiPackage(ctx context.Context, packagePath, notebookID, operationID string,
	importedAt int64) (flashcardv2.AnkiImportReport, error) {
	flashcardV2AnkiImportLock.Lock()
	defer flashcardV2AnkiImportLock.Unlock()

	box, err := getOpenedBox(strings.TrimSpace(notebookID))
	if err != nil {
		return flashcardv2.AnkiImportReport{}, err
	}
	if box.Encrypted || IsEncryptedBox(box.ID) {
		return flashcardv2.AnkiImportReport{}, errors.New(Conf.Language(313))
	}
	if importedAt <= 0 {
		importedAt = time.Now().UnixMilli()
	}
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.AnkiImportReport{}, err
	}
	writer := &flashcardV2AnkiContentWriter{notebookID: box.ID, importedAt: importedAt}
	return store.ImportAnkiPackage(ctx, flashcardv2.AnkiImportRequest{
		OperationID: strings.TrimSpace(operationID), PackagePath: packagePath, TargetID: box.ID, ImportedAt: importedAt,
		NewLimit: Conf.Flashcard.NewCardLimit, ReviewLimit: Conf.Flashcard.ReviewCardLimit, Writer: writer,
	})
}

func (writer *flashcardV2AnkiContentWriter) StoreMedia(ctx context.Context, originalName string,
	data []byte) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	extension := safeAnkiMediaExtension(originalName)
	diskName := fmt.Sprintf("anki-%x%s", digest[:16], extension)
	assetsDir := filepath.Join(util.DataDir, writer.notebookID, "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		return "", err
	}
	writePath := filepath.Join(assetsDir, diskName)
	if existing, err := filelock.ReadFile(writePath); err == nil {
		if sha256.Sum256(existing) != digest {
			return "", errors.New("Anki media digest collision")
		}
	} else if !os.IsNotExist(err) {
		return "", err
	} else if err = filelock.WriteFile(writePath, data); err != nil {
		return "", err
	}
	return "assets/" + url.PathEscape(diskName) + "?box=" + url.QueryEscape(writer.notebookID), nil
}

func safeAnkiMediaExtension(originalName string) string {
	extension := strings.ToLower(filepath.Ext(filepath.Base(originalName)))
	if len(extension) < 2 || len(extension) > 16 {
		return ""
	}
	for _, char := range extension[1:] {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') {
			return ""
		}
	}
	return extension
}

func (writer *flashcardV2AnkiContentWriter) WriteNotes(ctx context.Context,
	notes []flashcardv2.AnkiContentNote) (map[string]flashcardv2.AnkiWrittenNote, error) {
	prepared := make([]preparedAnkiContentNote, 0, len(notes))
	for _, note := range notes {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		value, err := prepareAnkiContentNote(note)
		if err != nil {
			return nil, fmt.Errorf("prepare Anki note [%d]: %w", note.NoteID, err)
		}
		prepared = append(prepared, value)
	}
	ret := make(map[string]flashcardv2.AnkiWrittenNote, len(prepared))
	pending := make([]preparedAnkiContentNote, 0)
	for index := range prepared {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		current := &prepared[index]
		if !writer.canUpdateAnkiNote(current.note) {
			recovered, err := writer.recoverAnkiNote(current.note)
			if err != nil {
				return nil, fmt.Errorf("recover Anki note [%d]: %w", current.note.NoteID, err)
			}
			if recovered.ContainerID != "" {
				current.note.ExistingContainerID = recovered.ContainerID
				current.note.ExistingFieldIDs = recovered.FieldIDs
			}
		}
		if !writer.canUpdateAnkiNote(current.note) {
			pending = append(pending, *current)
			continue
		}
		updates := make([]BlockUpdateInput, 0, len(current.fields))
		written := flashcardv2.AnkiWrittenNote{ContainerID: current.note.ExistingContainerID,
			FieldIDs: map[int]string{}}
		for _, field := range current.fields {
			fieldID := current.note.ExistingFieldIDs[field.field.Ord]
			updates = append(updates, BlockUpdateInput{ID: fieldID,
				Data: ankiSuperBlockDOM(fieldID, field.dom, ""), DataType: "dom"})
			written.FieldIDs[field.field.Ord] = fieldID
		}
		if _, _, err := PerformBlockUpdates(updates); err != nil {
			return nil, fmt.Errorf("update Anki note [%d]: %w", current.note.NoteID, err)
		}
		ret[current.note.SourceID] = written
	}
	for offset := 0; offset < len(pending); offset += ankiImportNotesPerDocument {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		end := min(offset+ankiImportNotesPerDocument, len(pending))
		written, err := writer.createAnkiDocument(pending[offset:end], offset/ankiImportNotesPerDocument+1)
		if err != nil {
			return nil, err
		}
		for sourceID, note := range written {
			ret[sourceID] = note
		}
	}
	return ret, nil
}

func prepareAnkiContentNote(note flashcardv2.AnkiContentNote) (preparedAnkiContentNote, error) {
	ret := preparedAnkiContentNote{note: note,
		written: flashcardv2.AnkiWrittenNote{FieldIDs: map[int]string{}}}
	for _, field := range note.Fields {
		markdown, err := safeAnkiHTMLToMarkdown(field.Value)
		if err != nil {
			return ret, err
		}
		contentDOM := util.NewLute().Md2BlockDOM(markdown, false)
		if strings.TrimSpace(contentDOM) == "" {
			contentDOM = util.NewLute().Md2BlockDOM("\u200b", false)
		}
		ret.fields = append(ret.fields, preparedAnkiContentField{field: field, dom: contentDOM})
	}
	return ret, nil
}

func safeAnkiHTMLToMarkdown(value string) (ret string, err error) {
	policy := bluemonday.UGCPolicy()
	policy.AllowElements("audio", "source")
	policy.AllowAttrs("controls", "preload", "src").OnElements("audio")
	policy.AllowAttrs("src", "type").OnElements("source")
	policy.AllowRelativeURLs(true)
	sanitized := policy.Sanitize(value)
	engine := util.NewLute()
	engine.SetHTMLTag2TextMark(true)
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("convert Anki HTML to Markdown: %v", recovered)
		}
	}()
	ret, err = engine.HTML2Markdown(sanitized)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(ret), nil
}

func (writer *flashcardV2AnkiContentWriter) canUpdateAnkiNote(note flashcardv2.AnkiContentNote) bool {
	if len(note.ExistingFieldIDs) != len(note.Fields) {
		return false
	}
	tree, err := LoadTreeByBlockIDInExactBox(note.ExistingContainerID, writer.notebookID)
	if err != nil {
		return false
	}
	container := treenode.GetNodeInTree(tree, note.ExistingContainerID)
	if container == nil || container.Type != ast.NodeSuperBlock {
		return false
	}
	for _, field := range note.Fields {
		fieldID := note.ExistingFieldIDs[field.Ord]
		fieldNode := treenode.GetNodeInTree(tree, fieldID)
		if fieldNode == nil || fieldNode.Type != ast.NodeSuperBlock || !isAnkiDescendant(fieldNode, container) {
			return false
		}
	}
	return true
}

func (writer *flashcardV2AnkiContentWriter) recoverAnkiNote(note flashcardv2.AnkiContentNote) (
	ret flashcardv2.AnkiWrittenNote, err error) {
	containers, err := sql.QueryNoLimitArgs(`SELECT source.block_id FROM attributes source
JOIN attributes note ON note.block_id = source.block_id
WHERE source.name = ? AND source.value = ? AND source.box = ? AND note.name = ? AND note.value = ?
ORDER BY source.block_id`, "custom-anki-source", note.SourceID, writer.notebookID, "custom-anki-note-id",
		strconv.FormatInt(note.NoteID, 10))
	if err != nil {
		return ret, err
	}
	for _, candidate := range containers {
		containerID, _ := candidate["block_id"].(string)
		if containerID == "" {
			continue
		}
		recovered := flashcardv2.AnkiWrittenNote{ContainerID: containerID, FieldIDs: map[int]string{}}
		tree, loadErr := LoadTreeByBlockIDInExactBox(containerID, writer.notebookID)
		if loadErr != nil {
			continue
		}
		container := treenode.GetNodeInTree(tree, containerID)
		if container == nil || container.Type != ast.NodeSuperBlock {
			continue
		}
		complete := true
		for _, field := range note.Fields {
			fieldRows, queryErr := sql.QueryNoLimitArgs(`SELECT source.block_id FROM attributes source
JOIN attributes field ON field.block_id = source.block_id
WHERE source.name = ? AND source.value = ? AND source.box = ? AND field.name = ? AND field.value = ?
ORDER BY source.block_id`, "custom-anki-source", note.SourceID, writer.notebookID, "custom-anki-field-ord",
				strconv.Itoa(field.Ord))
			if queryErr != nil {
				return ret, queryErr
			}
			fieldID := ""
			for _, fieldCandidate := range fieldRows {
				candidateID, _ := fieldCandidate["block_id"].(string)
				fieldNode := treenode.GetNodeInTree(tree, candidateID)
				if fieldNode != nil && fieldNode.Type == ast.NodeSuperBlock && isAnkiDescendant(fieldNode, container) {
					fieldID = candidateID
					break
				}
			}
			if fieldID == "" {
				complete = false
				break
			}
			recovered.FieldIDs[field.Ord] = fieldID
		}
		if complete {
			return recovered, nil
		}
	}
	return ret, nil
}

func isAnkiDescendant(node, ancestor *ast.Node) bool {
	for parent := node.Parent; parent != nil; parent = parent.Parent {
		if parent == ancestor {
			return true
		}
	}
	return false
}

func (writer *flashcardV2AnkiContentWriter) createAnkiDocument(notes []preparedAnkiContentNote,
	part int) (map[string]flashcardv2.AnkiWrittenNote, error) {
	engine := util.NewLute()
	var content strings.Builder
	for index := range notes {
		note := &notes[index]
		note.written.ContainerID = ast.NewNodeID()
		var children strings.Builder
		children.WriteString(engine.Md2BlockDOM("## "+escapeAnkiMarkdownText(note.note.ModelName+" "+
			strconv.FormatInt(note.note.NoteID, 10)), false))
		for _, field := range note.fields {
			children.WriteString(engine.Md2BlockDOM("### "+escapeAnkiMarkdownText(field.field.Name), false))
			fieldID := ast.NewNodeID()
			note.written.FieldIDs[field.field.Ord] = fieldID
			fieldAttributes := ` custom-anki-source="` + html.EscapeString(note.note.SourceID) + `"` +
				` custom-anki-field-ord="` + strconv.Itoa(field.field.Ord) + `"`
			children.WriteString(ankiSuperBlockDOM(fieldID, field.dom, fieldAttributes))
		}
		attributes := ` custom-anki-source="` + html.EscapeString(note.note.SourceID) + `"` +
			` custom-anki-guid="` + html.EscapeString(note.note.GUID) + `"` +
			` custom-anki-note-id="` + strconv.FormatInt(note.note.NoteID, 10) + `"`
		note.container = ankiSuperBlockDOM(note.written.ContainerID, children.String(), attributes)
		content.WriteString(note.container)
	}
	documentID := ast.NewNodeID()
	title := "Anki " + time.UnixMilli(writer.importedAt).Format("2006-01-02 15-04") + " " + strconv.Itoa(part)
	tree, err := createFlashcardV2AnkiDocument(writer.notebookID, "/"+documentID+".sy", title,
		content.String())
	if err != nil {
		return nil, err
	}
	ret := make(map[string]flashcardv2.AnkiWrittenNote, len(notes))
	for _, note := range notes {
		container := treenode.GetNodeInTree(tree, note.written.ContainerID)
		if container == nil || container.Type != ast.NodeSuperBlock {
			return nil, fmt.Errorf("created Anki note [%d] container was not found", note.note.NoteID)
		}
		for _, fieldID := range note.written.FieldIDs {
			field := treenode.GetNodeInTree(tree, fieldID)
			if field == nil || field.Type != ast.NodeSuperBlock {
				return nil, fmt.Errorf("created Anki note [%d] field was not found", note.note.NoteID)
			}
		}
		ret[note.note.SourceID] = note.written
	}
	return ret, nil
}

func createFlashcardV2AnkiDocument(boxID, documentPath, title, dom string) (tree *parse.Tree, err error) {
	createDocLock.Lock()
	defer createDocLock.Unlock()
	box, err := getOpenedBox(boxID)
	if err != nil {
		return nil, err
	}
	tree, err = createDoc(box.ID, documentPath, title, dom, false)
	if err != nil {
		return nil, err
	}
	FlushTxQueue()
	box.setSortByConf(path.Dir(tree.Path), tree.ID)
	FlushTxQueue()
	PushCreate(box, documentPath, nil)
	return tree, nil
}

func ankiSuperBlockDOM(id, children, attributes string) string {
	return `<div data-node-id="` + html.EscapeString(id) + `" data-type="NodeSuperBlock" class="sb" ` +
		`data-sb-layout="col"` + attributes + `>` + children +
		`<div class="protyle-attr" contenteditable="false"></div></div>`
}

func escapeAnkiMarkdownText(value string) string {
	replacer := strings.NewReplacer("\\", "\\\\", "`", "\\`", "*", "\\*", "_", "\\_", "[", "\\[",
		"]", "\\]", "<", "\\<", ">", "\\>", "#", "\\#")
	return replacer.Replace(strings.TrimSpace(value))
}
