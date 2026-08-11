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

package flashcard

import (
	"archive/zip"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

const (
	maxAnkiMediaFileSize  = 256 << 20
	maxAnkiMediaTotalSize = 8 << 30
	maxAnkiMediaFiles     = 100000
)

// AnkiContentField 是需要落入普通笔记本的单个可编辑 Anki 字段。
type AnkiContentField struct {
	Ord   int    `json:"ord"`
	Name  string `json:"name"`
	Value string `json:"value"`
}

// AnkiContentNote 是内容写入器接收的稳定 Note 身份和字段内容。
type AnkiContentNote struct {
	SourceID            string             `json:"sourceID"`
	NoteID              int64              `json:"noteID"`
	GUID                string             `json:"guid"`
	ModelID             int64              `json:"modelID"`
	ModelName           string             `json:"modelName"`
	Fields              []AnkiContentField `json:"fields"`
	ExistingContainerID string             `json:"existingContainerID,omitempty"`
	ExistingFieldIDs    map[int]string     `json:"existingFieldIDs,omitempty"`
}

// AnkiWrittenNote 返回卡源容器以及字段序号到普通块 ID 的映射。
type AnkiWrittenNote struct {
	ContainerID string         `json:"containerID"`
	FieldIDs    map[int]string `json:"fieldIDs"`
}

// AnkiContentWriter 将媒体和正文写入普通笔记本；闪卡元数据不会把正文复制进 v2。
type AnkiContentWriter interface {
	StoreMedia(ctx context.Context, originalName string, data []byte) (string, error)
	WriteNotes(ctx context.Context, notes []AnkiContentNote) (map[string]AnkiWrittenNote, error)
}

type ankiImportNote struct {
	ID       int64
	GUID     string
	ModelID  int64
	Modified int64
	Tags     []string
	Fields   []string
}

type ankiImportCard struct {
	ID             int64
	NoteID         int64
	DeckID         int64
	OriginalDeckID int64
	Ord            int
	Type           int
	Queue          int
	Due            int64
	OriginalDue    int64
	Interval       int64
	Factor         int
	Reps           int64
	Lapses         int64
	Flags          int
}

type ankiImportReview struct {
	ID           int64
	CardID       int64
	Ease         int
	Interval     int64
	LastInterval int64
	Factor       int
	DurationMS   int64
	Type         int
}

type ankiImportPackage struct {
	Preview    AnkiPackagePreview
	Models     []ankiModel
	Decks      []ankiDeck
	Notes      []ankiImportNote
	Cards      []ankiImportCard
	Reviews    []ankiImportReview
	MediaPaths map[string]string
}

func readAnkiImportPackage(ctx context.Context, packagePath string,
	writer AnkiContentWriter) (ankiImportPackage, error) {
	preview, err := PreviewAnkiPackage(ctx, packagePath)
	if err != nil {
		return ankiImportPackage{}, err
	}
	archive, err := zip.OpenReader(packagePath)
	if err != nil {
		return ankiImportPackage{}, fmt.Errorf("open Anki package: %w", err)
	}
	defer archive.Close()
	collectionEntry, mediaEntry, err := inspectAnkiArchive(archive.File)
	if err != nil {
		return ankiImportPackage{}, err
	}
	tempRoot, err := os.MkdirTemp("", "siyuan-anki-import-")
	if err != nil {
		return ankiImportPackage{}, err
	}
	defer os.RemoveAll(tempRoot)
	collectionPath := filepath.Join(tempRoot, "collection.sqlite")
	if err = extractAnkiCollection(collectionEntry, collectionPath, maxAnkiCollectionSize); err != nil {
		return ankiImportPackage{}, err
	}
	ret := ankiImportPackage{Preview: preview, MediaPaths: map[string]string{}}
	dsn := "file:" + filepath.ToSlash(collectionPath) + "?mode=ro&immutable=1&_query_only=1"
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return ankiImportPackage{}, err
	}
	defer db.Close()
	if preview.SchemaVersion >= 15 {
		ret.Models, err = parseModernAnkiModels(ctx, db)
		if err == nil {
			ret.Decks, err = parseModernAnkiDecks(ctx, db)
		}
	} else {
		var modelsJSON, decksJSON []byte
		if err = db.QueryRowContext(ctx, "SELECT models, decks FROM col LIMIT 1").Scan(&modelsJSON,
			&decksJSON); err == nil {
			ret.Models, err = parseAnkiModels(modelsJSON)
		}
		if err == nil {
			ret.Decks, err = parseAnkiDecks(decksJSON)
		}
	}
	if err != nil {
		return ankiImportPackage{}, err
	}
	if ret.Notes, err = readAnkiImportNotes(ctx, db, nil); err == nil {
		ret.Cards, err = readAnkiImportCards(ctx, db)
	}
	if err == nil {
		ret.Reviews, err = readAnkiImportReviews(ctx, db)
	}
	if err != nil {
		return ankiImportPackage{}, err
	}
	if mediaEntry != nil {
		ret.MediaPaths, err = importAnkiMedia(ctx, archive.File, mediaEntry, writer)
		if err != nil {
			return ankiImportPackage{}, err
		}
		for noteIndex := range ret.Notes {
			for fieldIndex := range ret.Notes[noteIndex].Fields {
				ret.Notes[noteIndex].Fields[fieldIndex] = rewriteAnkiMediaReferences(
					ret.Notes[noteIndex].Fields[fieldIndex], ret.MediaPaths)
			}
		}
	}
	return ret, nil
}

func importAnkiMedia(ctx context.Context, files []*zip.File, mediaEntry *zip.File,
	writer AnkiContentWriter) (map[string]string, error) {
	mappingData, err := readLimitedZipEntry(mediaEntry, maxAnkiMediaMapSize)
	if err != nil {
		return nil, err
	}
	var mapping map[string]string
	if err = json.Unmarshal(mappingData, &mapping); err != nil {
		return nil, errors.New("Anki media map is invalid")
	}
	if len(mapping) > maxAnkiMediaFiles {
		return nil, errors.New("Anki package contains too many media files")
	}
	entries := make(map[string]*zip.File, len(files))
	for _, file := range files {
		if entries[file.Name] != nil {
			return nil, fmt.Errorf("Anki package contains duplicate entry [%s]", file.Name)
		}
		entries[file.Name] = file
	}
	keys := make([]string, 0, len(mapping))
	for key := range mapping {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	originalNames := make(map[string]struct{}, len(mapping))
	var totalSize uint64
	for _, key := range keys {
		originalName := strings.TrimSpace(mapping[key])
		clean := path.Clean(strings.ReplaceAll(originalName, "\\", "/"))
		if originalName == "" || clean == "." || clean == ".." || strings.HasPrefix(clean, "../") ||
			path.IsAbs(clean) {
			return nil, fmt.Errorf("Anki media name [%s] is unsafe", originalName)
		}
		entry := entries[key]
		if entry == nil {
			return nil, fmt.Errorf("Anki media entry [%s] is missing", key)
		}
		if entry.UncompressedSize64 > maxAnkiMediaFileSize ||
			totalSize > maxAnkiMediaTotalSize-entry.UncompressedSize64 {
			return nil, errors.New("Anki package media exceeds its size limit")
		}
		totalSize += entry.UncompressedSize64
		if _, duplicate := originalNames[originalName]; duplicate {
			return nil, fmt.Errorf("Anki media name [%s] is duplicated", originalName)
		}
		originalNames[originalName] = struct{}{}
	}
	ret := make(map[string]string, len(mapping))
	for _, key := range keys {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		originalName := strings.TrimSpace(mapping[key])
		clean := path.Clean(strings.ReplaceAll(originalName, "\\", "/"))
		entry := entries[key]
		data, readErr := readLimitedZipEntry(entry, maxAnkiMediaFileSize)
		if readErr != nil {
			return nil, fmt.Errorf("read Anki media [%s]: %w", originalName, readErr)
		}
		storedPath, storeErr := writer.StoreMedia(ctx, path.Base(clean), data)
		if storeErr != nil {
			return nil, fmt.Errorf("store Anki media [%s]: %w", originalName, storeErr)
		}
		ret[originalName] = storedPath
	}
	return ret, nil
}

func readAnkiImportNotes(ctx context.Context, db *sql.DB,
	mediaPaths map[string]string) ([]ankiImportNote, error) {
	rows, err := db.QueryContext(ctx, "SELECT id, guid, mid, mod, tags, flds FROM notes ORDER BY id")
	if err != nil {
		return nil, fmt.Errorf("read Anki notes: %w", err)
	}
	defer rows.Close()
	var ret []ankiImportNote
	identities := map[string]int64{}
	for rows.Next() {
		var note ankiImportNote
		var tags, fields string
		if err = rows.Scan(&note.ID, &note.GUID, &note.ModelID, &note.Modified, &tags, &fields); err != nil {
			return nil, err
		}
		if note.ID == 0 || note.ModelID == 0 {
			return nil, errors.New("Anki note identity is incomplete")
		}
		identity := strings.TrimSpace(note.GUID)
		if identity == "" {
			identity = "note:" + fmt.Sprintf("%d", note.ID)
		}
		if previousID, duplicate := identities[identity]; duplicate {
			return nil, fmt.Errorf("Anki notes [%d] and [%d] have the same identity", previousID, note.ID)
		}
		identities[identity] = note.ID
		note.Tags = strings.Fields(tags)
		note.Fields = strings.Split(fields, "\x1f")
		for index := range note.Fields {
			note.Fields[index] = rewriteAnkiMediaReferences(note.Fields[index], mediaPaths)
		}
		ret = append(ret, note)
	}
	return ret, rows.Err()
}

func readAnkiImportCards(ctx context.Context, db *sql.DB) ([]ankiImportCard, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses,
		odue, odid, flags
		FROM cards ORDER BY nid, id`)
	if err != nil {
		return nil, fmt.Errorf("read Anki cards: %w", err)
	}
	defer rows.Close()
	var ret []ankiImportCard
	for rows.Next() {
		var card ankiImportCard
		if err = rows.Scan(&card.ID, &card.NoteID, &card.DeckID, &card.Ord, &card.Type, &card.Queue, &card.Due,
			&card.Interval, &card.Factor, &card.Reps, &card.Lapses, &card.OriginalDue, &card.OriginalDeckID,
			&card.Flags); err != nil {
			return nil, err
		}
		if card.OriginalDeckID > 0 {
			card.DeckID = card.OriginalDeckID
			if card.OriginalDue > 0 {
				card.Due = card.OriginalDue
			}
		}
		if card.ID == 0 || card.NoteID == 0 || card.DeckID == 0 || card.Ord < 0 {
			return nil, errors.New("Anki card identity is incomplete")
		}
		ret = append(ret, card)
	}
	return ret, rows.Err()
}

func readAnkiImportReviews(ctx context.Context, db *sql.DB) ([]ankiImportReview, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, cid, ease, ivl, lastIvl, factor, time, type
		FROM revlog ORDER BY cid, id`)
	if err != nil {
		return nil, fmt.Errorf("read Anki review history: %w", err)
	}
	defer rows.Close()
	var ret []ankiImportReview
	for rows.Next() {
		var review ankiImportReview
		if err = rows.Scan(&review.ID, &review.CardID, &review.Ease, &review.Interval, &review.LastInterval,
			&review.Factor, &review.DurationMS, &review.Type); err != nil {
			return nil, err
		}
		if review.ID <= 0 || review.CardID == 0 {
			return nil, errors.New("Anki review identity is incomplete")
		}
		ret = append(ret, review)
	}
	return ret, rows.Err()
}

func rewriteAnkiMediaReferences(value string, mediaPaths map[string]string) string {
	for originalName, storedPath := range mediaPaths {
		encodedName := url.PathEscape(originalName)
		for _, name := range []string{originalName, encodedName} {
			value = strings.ReplaceAll(value, `src="`+name+`"`, `src="`+storedPath+`"`)
			value = strings.ReplaceAll(value, `src='`+name+`'`, `src='`+storedPath+`'`)
		}
		value = strings.ReplaceAll(value, "[sound:"+originalName+"]",
			`<audio controls="controls" src="`+storedPath+`"></audio>`)
	}
	return value
}
