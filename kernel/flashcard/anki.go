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
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/klauspost/compress/zstd"
	_ "github.com/mattn/go-sqlite3"
	"google.golang.org/protobuf/encoding/protowire"
)

const (
	// MaxAnkiPackageArchiveSize 限制通过 HTTP 上传的单个 Anki 压缩包大小。
	MaxAnkiPackageArchiveSize int64 = 1 << 30

	maxAnkiCollectionSize = 4 << 30
	maxAnkiMediaMapSize   = 16 << 20
	maxAnkiNoteCount      = 500_000
	maxAnkiCardCount      = 1_000_000
	maxAnkiReviewCount    = 2_000_000
	maxAnkiRecordCount    = 2_000_000
)

// AnkiPackagePreview 保存导入确认前不含笔记正文的集合结构与兼容性报告。
type AnkiPackagePreview struct {
	PackageDigest      string                `json:"packageDigest"`
	CollectionID       string                `json:"collectionID"`
	CollectionCrt      int64                 `json:"collectionCrt"`
	SchemaVersion      int                   `json:"schemaVersion"`
	NoteCount          int                   `json:"noteCount"`
	CardCount          int                   `json:"cardCount"`
	ReviewCount        int                   `json:"reviewCount"`
	MediaCount         int                   `json:"mediaCount"`
	NoteTypes          []AnkiNoteTypePreview `json:"noteTypes"`
	Decks              []AnkiDeckPreview     `json:"decks"`
	Unsupported        []string              `json:"unsupported"`
	CollectionEntry    string                `json:"collectionEntry"`
	legacyCollectionID string
}

// AnkiNoteTypePreview 描述 Note Type 字段、模板和预期转换方式。
type AnkiNoteTypePreview struct {
	ID         int64                 `json:"id"`
	Name       string                `json:"name"`
	Kind       string                `json:"kind"`
	NoteCount  int                   `json:"noteCount"`
	Fields     []AnkiFieldPreview    `json:"fields"`
	Templates  []AnkiTemplatePreview `json:"templates"`
	Conversion string                `json:"conversion"`
}

// AnkiFieldPreview 描述稳定的 Anki 字段顺序。
type AnkiFieldPreview struct {
	Name string `json:"name"`
	Ord  int    `json:"ord"`
}

// AnkiTemplatePreview 描述单个 Card Type 的安全转换结果。
type AnkiTemplatePreview struct {
	Name           string `json:"name"`
	Ord            int    `json:"ord"`
	Conversion     string `json:"conversion"`
	UsesTypeAnswer bool   `json:"usesTypeAnswer"`
	HasScript      bool   `json:"hasScript"`
}

// AnkiDeckPreview 保存卡包身份与卡片数量。
type AnkiDeckPreview struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	CardCount int    `json:"cardCount"`
}

type ankiModel struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Type int    `json:"type"`
	CSS  string `json:"css"`
	Flds []struct {
		Name string `json:"name"`
		Ord  int    `json:"ord"`
	} `json:"flds"`
	Tmpls []struct {
		Name  string `json:"name"`
		Ord   int    `json:"ord"`
		QFmt  string `json:"qfmt"`
		AFmt  string `json:"afmt"`
		BQFmt string `json:"bqfmt"`
		BAFmt string `json:"bafmt"`
	} `json:"tmpls"`
}

type ankiDeck struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// PreviewAnkiPackage 校验 `.apkg` 容器并只读分析其中的 Anki SQLite 集合。
func PreviewAnkiPackage(ctx context.Context, packagePath string) (AnkiPackagePreview, error) {
	digest, err := digestFile(packagePath)
	if err != nil {
		return AnkiPackagePreview{}, fmt.Errorf("digest Anki package: %w", err)
	}
	archive, err := zip.OpenReader(packagePath)
	if err != nil {
		return AnkiPackagePreview{}, fmt.Errorf("open Anki package: %w", err)
	}
	defer archive.Close()
	collection, media, err := inspectAnkiArchive(archive.File)
	if err != nil {
		return AnkiPackagePreview{}, err
	}
	tempRoot, err := os.MkdirTemp("", "siyuan-anki-preview-")
	if err != nil {
		return AnkiPackagePreview{}, err
	}
	defer os.RemoveAll(tempRoot)
	collectionPath := filepath.Join(tempRoot, "collection.sqlite")
	if err = extractAnkiCollection(collection, collectionPath, maxAnkiCollectionSize); err != nil {
		return AnkiPackagePreview{}, err
	}
	preview, err := previewAnkiCollection(ctx, collectionPath)
	if err != nil {
		return AnkiPackagePreview{}, err
	}
	preview.PackageDigest = digest
	preview.CollectionEntry = collection.Name
	if media != nil {
		mapping, readErr := readLimitedZipEntry(media, maxAnkiMediaMapSize)
		if readErr != nil {
			return AnkiPackagePreview{}, readErr
		}
		var files map[string]string
		if len(mapping) != 0 && json.Unmarshal(mapping, &files) != nil {
			return AnkiPackagePreview{}, errors.New("Anki media map is invalid")
		}
		preview.MediaCount = len(files)
	}
	return preview, nil
}

func inspectAnkiArchive(files []*zip.File) (collection, media *zip.File, err error) {
	collections := map[string]*zip.File{}
	for _, file := range files {
		normalized := strings.ReplaceAll(file.Name, "\\", "/")
		clean := path.Clean(normalized)
		if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || path.IsAbs(clean) ||
			filepath.VolumeName(clean) != "" || normalized != file.Name || clean != normalized ||
			file.FileInfo().Mode()&os.ModeSymlink != 0 {
			return nil, nil, errors.New("Anki package contains an unsafe entry")
		}
		switch file.Name {
		case "collection.anki2", "collection.anki21", "collection.anki21b":
			if collections[file.Name] != nil {
				return nil, nil, fmt.Errorf("Anki package contains duplicate entry [%s]", file.Name)
			}
			collections[file.Name] = file
		case "media":
			if media != nil {
				return nil, nil, errors.New("Anki package contains duplicate media maps")
			}
			media = file
		}
	}
	for _, name := range []string{"collection.anki21b", "collection.anki21", "collection.anki2"} {
		if collections[name] != nil {
			return collections[name], media, nil
		}
	}
	return nil, nil, errors.New("Anki package has no supported collection database")
}

func previewAnkiCollection(ctx context.Context, path string) (AnkiPackagePreview, error) {
	dsn := "file:" + filepath.ToSlash(path) + "?mode=ro&immutable=1&_query_only=1"
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return AnkiPackagePreview{}, err
	}
	defer db.Close()
	var integrity string
	if err = db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&integrity); err != nil || integrity != "ok" {
		return AnkiPackagePreview{}, errors.New("Anki collection database is corrupt")
	}
	var created int64
	var version int
	if err = db.QueryRowContext(ctx, "SELECT crt, ver FROM col LIMIT 1").Scan(&created, &version); err != nil {
		return AnkiPackagePreview{}, fmt.Errorf("read Anki collection metadata: %w", err)
	}
	if version > 18 || version == 12 || version == 13 {
		return AnkiPackagePreview{}, fmt.Errorf("unsupported Anki collection schema [%d]", version)
	}
	var models []ankiModel
	var decks []ankiDeck
	if version >= 15 {
		models, err = parseModernAnkiModels(ctx, db)
		if err == nil {
			decks, err = parseModernAnkiDecks(ctx, db)
		}
	} else {
		var modelsJSON, decksJSON []byte
		if err = db.QueryRowContext(ctx, "SELECT models, decks FROM col LIMIT 1").
			Scan(&modelsJSON, &decksJSON); err == nil {
			models, err = parseAnkiModels(modelsJSON)
		}
		if err == nil {
			decks, err = parseAnkiDecks(decksJSON)
		}
	}
	if err != nil {
		return AnkiPackagePreview{}, err
	}
	preview := AnkiPackagePreview{CollectionCrt: created, SchemaVersion: version}
	if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM notes").Scan(&preview.NoteCount); err != nil {
		return AnkiPackagePreview{}, fmt.Errorf("count Anki notes: %w", err)
	}
	if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM cards").Scan(&preview.CardCount); err != nil {
		return AnkiPackagePreview{}, fmt.Errorf("count Anki cards: %w", err)
	}
	if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM revlog").Scan(&preview.ReviewCount); err != nil {
		return AnkiPackagePreview{}, fmt.Errorf("count Anki reviews: %w", err)
	}
	if err = validateAnkiRecordCounts(preview); err != nil {
		return AnkiPackagePreview{}, err
	}
	notesByModel, err := ankiCountByID(ctx, db, "SELECT mid, COUNT(*) FROM notes GROUP BY mid")
	if err != nil {
		return AnkiPackagePreview{}, err
	}
	cardsByDeck, err := ankiCountByID(ctx, db, "SELECT did, COUNT(*) FROM cards GROUP BY did")
	if err != nil {
		return AnkiPackagePreview{}, err
	}
	modelIDs := make([]int64, 0, len(models))
	for _, model := range models {
		modelIDs = append(modelIDs, model.ID)
		preview.NoteTypes = append(preview.NoteTypes, previewAnkiModel(model, notesByModel[model.ID], &preview.Unsupported))
	}
	deckIDs := make([]int64, 0, len(decks))
	for _, deck := range decks {
		deckIDs = append(deckIDs, deck.ID)
		preview.Decks = append(preview.Decks, AnkiDeckPreview{ID: deck.ID, Name: deck.Name,
			CardCount: cardsByDeck[deck.ID]})
	}
	sort.Slice(preview.NoteTypes, func(i, j int) bool { return preview.NoteTypes[i].ID < preview.NoteTypes[j].ID })
	sort.Slice(preview.Decks, func(i, j int) bool { return preview.Decks[i].ID < preview.Decks[j].ID })
	sort.Slice(modelIDs, func(i, j int) bool { return modelIDs[i] < modelIDs[j] })
	sort.Slice(deckIDs, func(i, j int) bool { return deckIDs[i] < deckIDs[j] })
	identity, err := checksum(struct {
		Created int64
		Models  []int64
		Decks   []int64
	}{created, modelIDs, deckIDs})
	if err != nil {
		return AnkiPackagePreview{}, err
	}
	preview.CollectionID = DeterministicID("anki-collection", strconv.FormatInt(created, 10))
	preview.legacyCollectionID = DeterministicID("anki-collection", strconv.FormatInt(created, 10), identity)
	return preview, nil
}

func validateAnkiRecordCounts(preview AnkiPackagePreview) error {
	if preview.NoteCount < 0 || preview.CardCount < 0 || preview.ReviewCount < 0 {
		return errors.New("Anki package contains an invalid record count")
	}
	if preview.NoteCount > maxAnkiNoteCount {
		return errors.New("Anki package contains too many notes")
	}
	if preview.CardCount > maxAnkiCardCount {
		return errors.New("Anki package contains too many cards")
	}
	if preview.ReviewCount > maxAnkiReviewCount {
		return errors.New("Anki package contains too many reviews")
	}
	total := int64(preview.NoteCount) + int64(preview.CardCount) + int64(preview.ReviewCount)
	if total > maxAnkiRecordCount {
		return errors.New("Anki package contains too many records")
	}
	return nil
}

func parseModernAnkiModels(ctx context.Context, db *sql.DB) ([]ankiModel, error) {
	rows, err := db.QueryContext(ctx, "SELECT id, name, config FROM notetypes ORDER BY id")
	if err != nil {
		return nil, fmt.Errorf("read modern Anki note types: %w", err)
	}
	defer rows.Close()
	models := map[int64]*ankiModel{}
	for rows.Next() {
		var model ankiModel
		var config []byte
		if err = rows.Scan(&model.ID, &model.Name, &config); err != nil {
			return nil, err
		}
		kind, found, parseErr := ankiProtoVarint(config, 1)
		if parseErr != nil {
			return nil, fmt.Errorf("decode modern Anki note type [%d]: %w", model.ID, parseErr)
		}
		if found {
			model.Type = int(kind)
		}
		if model.ID == 0 || strings.TrimSpace(model.Name) == "" {
			return nil, errors.New("modern Anki note type is incomplete")
		}
		models[model.ID] = &model
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	fieldRows, err := db.QueryContext(ctx, "SELECT ntid, ord, name FROM fields ORDER BY ntid, ord")
	if err != nil {
		return nil, fmt.Errorf("read modern Anki fields: %w", err)
	}
	for fieldRows.Next() {
		var noteTypeID int64
		var field struct {
			Name string `json:"name"`
			Ord  int    `json:"ord"`
		}
		if err = fieldRows.Scan(&noteTypeID, &field.Ord, &field.Name); err != nil {
			_ = fieldRows.Close()
			return nil, err
		}
		model := models[noteTypeID]
		if model == nil {
			_ = fieldRows.Close()
			return nil, fmt.Errorf("modern Anki field references missing note type [%d]", noteTypeID)
		}
		model.Flds = append(model.Flds, field)
	}
	if err = fieldRows.Err(); err != nil {
		_ = fieldRows.Close()
		return nil, err
	}
	if err = fieldRows.Close(); err != nil {
		return nil, err
	}
	templateRows, err := db.QueryContext(ctx,
		"SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord")
	if err != nil {
		return nil, fmt.Errorf("read modern Anki templates: %w", err)
	}
	for templateRows.Next() {
		var noteTypeID int64
		var config []byte
		var template struct {
			Name  string `json:"name"`
			Ord   int    `json:"ord"`
			QFmt  string `json:"qfmt"`
			AFmt  string `json:"afmt"`
			BQFmt string `json:"bqfmt"`
			BAFmt string `json:"bafmt"`
		}
		if err = templateRows.Scan(&noteTypeID, &template.Ord, &template.Name, &config); err != nil {
			_ = templateRows.Close()
			return nil, err
		}
		var parseErr error
		if template.QFmt, _, parseErr = ankiProtoString(config, 1); parseErr == nil {
			template.AFmt, _, parseErr = ankiProtoString(config, 2)
		}
		if parseErr == nil {
			template.BQFmt, _, parseErr = ankiProtoString(config, 3)
		}
		if parseErr == nil {
			template.BAFmt, _, parseErr = ankiProtoString(config, 4)
		}
		if parseErr != nil {
			_ = templateRows.Close()
			return nil, fmt.Errorf("decode modern Anki template [%d:%d]: %w", noteTypeID, template.Ord,
				parseErr)
		}
		model := models[noteTypeID]
		if model == nil {
			_ = templateRows.Close()
			return nil, fmt.Errorf("modern Anki template references missing note type [%d]", noteTypeID)
		}
		model.Tmpls = append(model.Tmpls, template)
	}
	if err = templateRows.Err(); err != nil {
		_ = templateRows.Close()
		return nil, err
	}
	if err = templateRows.Close(); err != nil {
		return nil, err
	}
	ret := make([]ankiModel, 0, len(models))
	for _, model := range models {
		if len(model.Flds) == 0 {
			return nil, fmt.Errorf("modern Anki note type [%d] has no fields", model.ID)
		}
		ret = append(ret, *model)
	}
	return ret, nil
}

func parseModernAnkiDecks(ctx context.Context, db *sql.DB) ([]ankiDeck, error) {
	rows, err := db.QueryContext(ctx, "SELECT id, name FROM decks ORDER BY id")
	if err != nil {
		return nil, fmt.Errorf("read modern Anki decks: %w", err)
	}
	defer rows.Close()
	ret := make([]ankiDeck, 0)
	for rows.Next() {
		var deck ankiDeck
		if err = rows.Scan(&deck.ID, &deck.Name); err != nil {
			return nil, err
		}
		if deck.ID == 0 || strings.TrimSpace(deck.Name) == "" {
			return nil, errors.New("modern Anki deck is incomplete")
		}
		ret = append(ret, deck)
	}
	return ret, rows.Err()
}

func ankiProtoVarint(data []byte, fieldNumber protowire.Number) (uint64, bool, error) {
	for len(data) != 0 {
		number, typ, tagLength := protowire.ConsumeTag(data)
		if tagLength < 0 {
			return 0, false, errors.New("invalid protobuf tag")
		}
		data = data[tagLength:]
		if number == fieldNumber && typ == protowire.VarintType {
			value, length := protowire.ConsumeVarint(data)
			if length < 0 {
				return 0, false, errors.New("invalid protobuf varint")
			}
			return value, true, nil
		}
		length := protowire.ConsumeFieldValue(number, typ, data)
		if length < 0 {
			return 0, false, errors.New("invalid protobuf field")
		}
		data = data[length:]
	}
	return 0, false, nil
}

func ankiProtoString(data []byte, fieldNumber protowire.Number) (string, bool, error) {
	for len(data) != 0 {
		number, typ, tagLength := protowire.ConsumeTag(data)
		if tagLength < 0 {
			return "", false, errors.New("invalid protobuf tag")
		}
		data = data[tagLength:]
		if number == fieldNumber && typ == protowire.BytesType {
			value, length := protowire.ConsumeBytes(data)
			if length < 0 {
				return "", false, errors.New("invalid protobuf string")
			}
			return string(value), true, nil
		}
		length := protowire.ConsumeFieldValue(number, typ, data)
		if length < 0 {
			return "", false, errors.New("invalid protobuf field")
		}
		data = data[length:]
	}
	return "", false, nil
}

func previewAnkiModel(model ankiModel, noteCount int, unsupported *[]string) AnkiNoteTypePreview {
	ret := AnkiNoteTypePreview{ID: model.ID, Name: model.Name, NoteCount: noteCount, Kind: "standard",
		Conversion: "declarative"}
	if model.Type == 1 {
		ret.Kind = "cloze"
		ret.Conversion = "cloze"
	}
	for _, field := range model.Flds {
		ret.Fields = append(ret.Fields, AnkiFieldPreview{Name: field.Name, Ord: field.Ord})
	}
	sort.Slice(ret.Fields, func(i, j int) bool { return ret.Fields[i].Ord < ret.Fields[j].Ord })
	for _, template := range model.Tmpls {
		markup := strings.ToLower(template.QFmt + template.AFmt + template.BQFmt + template.BAFmt)
		hasScript := strings.Contains(markup, "<script") || strings.Contains(markup, "javascript:")
		usesType := strings.Contains(markup, "{{type:")
		conversion := ret.Conversion
		if hasScript {
			conversion = "safeFallback"
			ret.Conversion = "safeFallback"
			*unsupported = append(*unsupported, fmt.Sprintf("noteType:%d:template:%d:script", model.ID, template.Ord))
		}
		ret.Templates = append(ret.Templates, AnkiTemplatePreview{Name: template.Name, Ord: template.Ord,
			Conversion: conversion, UsesTypeAnswer: usesType, HasScript: hasScript})
	}
	sort.Slice(ret.Templates, func(i, j int) bool { return ret.Templates[i].Ord < ret.Templates[j].Ord })
	return ret
}

func parseAnkiModels(data []byte) ([]ankiModel, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("decode Anki note types: %w", err)
	}
	ret := make([]ankiModel, 0, len(raw))
	for key, value := range raw {
		var model ankiModel
		if err := json.Unmarshal(value, &model); err != nil {
			return nil, fmt.Errorf("decode Anki note type [%s]: %w", key, err)
		}
		if model.ID == 0 {
			model.ID, _ = strconv.ParseInt(key, 10, 64)
		}
		if model.ID == 0 || strings.TrimSpace(model.Name) == "" || len(model.Flds) == 0 {
			return nil, fmt.Errorf("Anki note type [%s] is incomplete", key)
		}
		ret = append(ret, model)
	}
	return ret, nil
}

func parseAnkiDecks(data []byte) ([]ankiDeck, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("decode Anki decks: %w", err)
	}
	ret := make([]ankiDeck, 0, len(raw))
	for key, value := range raw {
		var deck ankiDeck
		if err := json.Unmarshal(value, &deck); err != nil {
			return nil, fmt.Errorf("decode Anki deck [%s]: %w", key, err)
		}
		if deck.ID == 0 {
			deck.ID, _ = strconv.ParseInt(key, 10, 64)
		}
		if deck.ID == 0 || strings.TrimSpace(deck.Name) == "" {
			return nil, fmt.Errorf("Anki deck [%s] is incomplete", key)
		}
		ret = append(ret, deck)
	}
	return ret, nil
}

func ankiCountByID(ctx context.Context, db *sql.DB, query string) (map[int64]int, error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ret := map[int64]int{}
	for rows.Next() {
		var id int64
		var count int
		if err = rows.Scan(&id, &count); err != nil {
			return nil, err
		}
		ret[id] = count
	}
	return ret, rows.Err()
}

func extractAnkiCollection(entry *zip.File, target string, limit uint64) error {
	if entry.Name != "collection.anki21b" && entry.UncompressedSize64 > limit {
		return errors.New("Anki collection database is too large")
	}
	reader, err := entry.Open()
	if err != nil {
		return err
	}
	defer reader.Close()
	file, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	var source io.Reader = reader
	var decoder *zstd.Decoder
	if entry.Name == "collection.anki21b" {
		decoder, err = zstd.NewReader(reader, zstd.WithDecoderMaxMemory(1<<30))
		if err != nil {
			_ = file.Close()
			return fmt.Errorf("open compressed Anki collection: %w", err)
		}
		defer decoder.Close()
		source = decoder
	}
	written, copyErr := io.Copy(file, io.LimitReader(source, int64(limit)+1))
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written > int64(limit) {
		return errors.New("Anki collection database exceeds its size limit")
	}
	return nil
}

func readLimitedZipEntry(entry *zip.File, limit uint64) ([]byte, error) {
	if entry.UncompressedSize64 > limit {
		return nil, errors.New("Anki media map is too large")
	}
	reader, err := entry.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, int64(limit)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > int(limit) {
		return nil, errors.New("Anki media map exceeds its size limit")
	}
	return data, nil
}

func digestFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
