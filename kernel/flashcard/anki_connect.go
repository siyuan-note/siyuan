package flashcard

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/microcosm-cc/bluemonday"
	nethtml "golang.org/x/net/html"
)

// AnkiConnectCollectionID 隔离实时制卡与完整卡包导入，避免集合替换影响增量卡源。
var AnkiConnectCollectionID = DeterministicID("builtin", "anki-connect-collection")

type AnkiConnectNoteInput struct {
	ID        int64
	DeckName  string
	ModelName string
	Fields    map[string]string
	Tags      []string
}

type AnkiConnectStoredNote struct {
	Source  CardSource
	Config  ImportedGenerationConfig
	Content AnkiContentNote
	Cards   []ankiImportCard
}

// AnkiConnectModels 提供内置问答、反向问答、挖空模型，并保留已导入的其他模型字段和模板。
func (store *Store) AnkiConnectModels(ctx context.Context) (map[string]ankiModel, error) {
	var builtin []ankiModel
	if err := json.Unmarshal([]byte(`[
		{"id":1,"name":"Basic","flds":[{"name":"Front","ord":0},{"name":"Back","ord":1}],"tmpls":[{"name":"Card 1","ord":0,"qfmt":"{{Front}}","afmt":"{{FrontSide}}<hr>{{Back}}"}]},
		{"id":2,"name":"Basic (and reversed card)","flds":[{"name":"Front","ord":0},{"name":"Back","ord":1}],"tmpls":[{"name":"Card 1","ord":0,"qfmt":"{{Front}}","afmt":"{{FrontSide}}<hr>{{Back}}"},{"name":"Card 2","ord":1,"qfmt":"{{Back}}","afmt":"{{FrontSide}}<hr>{{Front}}"}]},
		{"id":3,"name":"Cloze","type":1,"flds":[{"name":"Text","ord":0},{"name":"Back Extra","ord":1}],"tmpls":[{"name":"Cloze","ord":0,"qfmt":"{{cloze:Text}}","afmt":"{{cloze:Text}}<br>{{Back Extra}}"}]}
	]`), &builtin); err != nil {
		return nil, err
	}
	ret := make(map[string]ankiModel)
	for _, model := range builtin {
		ret[model.Name] = model
	}
	for offset := 0; ; offset += 1000 {
		page, err := store.projection.ListEntities(ctx, EntityCardSchema, EntityListOptions{Limit: 1000, Offset: offset})
		if err != nil {
			return nil, err
		}
		for _, revision := range page.Entities {
			var schema CardSchema
			if err = json.Unmarshal(revision.Payload, &schema); err != nil {
				return nil, err
			}
			if schema.BuiltinType != "anki" {
				continue
			}
			if _, exists := ret[schema.Name]; exists {
				continue
			}
			model := ankiModel{ID: ankiConnectStableNumber(schema.ID), Name: schema.Name}
			for index, field := range schema.Fields {
				model.Flds = append(model.Flds, struct {
					Name string `json:"name"`
					Ord  int    `json:"ord"`
				}{field.Name, index})
			}
			for index, id := range schema.TemplateIDs {
				value, found, readErr := store.projection.CurrentEntity(ctx, EntityCardTemplate, id)
				if readErr != nil {
					return nil, readErr
				}
				if !found || value.Deleted {
					continue
				}
				var template CardTemplate
				if err = json.Unmarshal(value.Payload, &template); err != nil {
					return nil, err
				}
				var policy struct {
					Anki struct {
						ModelID int64  `json:"modelID"`
						QFmt    string `json:"qfmt"`
						AFmt    string `json:"afmt"`
					} `json:"anki"`
				}
				if err = json.Unmarshal(template.ContextPolicy, &policy); err != nil {
					continue
				}
				if policy.Anki.QFmt == "" {
					continue
				}
				model.CSS = template.Style
				if schema.ID == DeterministicID("anki-schema", AnkiConnectCollectionID, strconv.FormatInt(policy.Anki.ModelID, 10)) {
					model.ID = policy.Anki.ModelID
				}
				if strings.Contains(policy.Anki.QFmt, "{{cloze:") {
					model.Type = 1
				}
				model.Tmpls = append(model.Tmpls, struct {
					Name  string `json:"name"`
					Ord   int    `json:"ord"`
					QFmt  string `json:"qfmt"`
					AFmt  string `json:"afmt"`
					BQFmt string `json:"bqfmt"`
					BAFmt string `json:"bafmt"`
				}{Name: template.Name, Ord: index, QFmt: policy.Anki.QFmt, AFmt: policy.Anki.AFmt})
			}
			if len(model.Tmpls) > 0 {
				ret[model.Name] = model
			}
		}
		if offset+len(page.Entities) >= page.Total {
			break
		}
	}
	return ret, nil
}

func ankiConnectStableNumber(value string) int64 {
	digest := sha256.Sum256([]byte(value))
	return int64(binary.BigEndian.Uint64(digest[:8])&((1<<52)-1)) + 1
}

func newAnkiConnectNumber() (int64, error) {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return 0, err
	}
	return int64(binary.BigEndian.Uint64(bytes[:])&((1<<52)-1)) + 1, nil
}

func ankiConnectDeckID(name string) string {
	return DeterministicID("anki-review-set", AnkiConnectCollectionID, strconv.FormatInt(ankiConnectStableNumber(name), 10))
}

func (store *Store) AnkiConnectDecks(ctx context.Context) (map[string]int64, error) {
	ret := make(map[string]int64)
	for offset := 0; ; offset += 1000 {
		page, err := store.projection.ListEntities(ctx, EntityReviewSet, EntityListOptions{Limit: 1000, Offset: offset})
		if err != nil {
			return nil, err
		}
		for _, revision := range page.Entities {
			var set ReviewSet
			if err = json.Unmarshal(revision.Payload, &set); err != nil {
				return nil, err
			}
			if set.ID == ankiConnectDeckID(set.Name) {
				ret[set.Name] = ankiConnectStableNumber(set.Name)
			}
		}
		if offset+len(page.Entities) >= page.Total {
			break
		}
	}
	return ret, nil
}

func (store *Store) CreateAnkiConnectDeck(ctx context.Context, name string, now int64) (int64, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 1024 {
		return 0, errors.New("invalid deck name")
	}
	definition := AnkiImportRequest{OperationID: DeterministicID("anki-connect-deck", name, strconv.FormatInt(time.Now().UnixNano(), 10)), ImportedAt: now}
	set := ReviewSet{ID: ankiConnectDeckID(name), Name: name, NewLimit: 20, ReviewLimit: 200, DefaultReviewMode: "normal"}
	var mutations []EntityMutation
	if err := store.appendAnkiDefinitionMutation(ctx, &mutations, definition, EntityReviewSet, set.ID, set, true); err != nil {
		return 0, err
	}
	if len(mutations) > 0 {
		if _, err := store.MutateEntities(ctx, definition.OperationID, mutations); err != nil {
			return 0, err
		}
	}
	return ankiConnectStableNumber(name), nil
}

// AnkiConnectNotes 从可重建投影读取权威身份及块引用，不把正文另存为闪卡元数据。
func (store *Store) AnkiConnectNotes(ctx context.Context) ([]AnkiConnectStoredNote, error) {
	ret := make([]AnkiConnectStoredNote, 0)
	for offset := 0; ; offset += 1000 {
		page, err := store.projection.ListEntities(ctx, EntityCardSource, EntityListOptions{Limit: 1000, Offset: offset})
		if err != nil {
			return nil, err
		}
		for _, revision := range page.Entities {
			var note AnkiConnectStoredNote
			if err = json.Unmarshal(revision.Payload, &note.Source); err != nil {
				return nil, err
			}
			if note.Source.SourceType != "anki" || note.Source.Status == "deleted" {
				continue
			}
			if err = json.Unmarshal(note.Source.GenerationConfig, &note.Config); err != nil {
				return nil, err
			}
			if note.Config.CollectionID != AnkiConnectCollectionID {
				continue
			}
			config := note.Config
			note.Content = AnkiContentNote{SourceID: note.Source.ID, NoteID: config.NoteID, GUID: config.GUID,
				ModelID: config.ModelID, ExistingFieldIDs: make(map[int]string)}
			schemaRevision, found, err := store.projection.CurrentEntity(ctx, EntityCardSchema, note.Source.SchemaID)
			if err != nil {
				return nil, err
			}
			if !found || schemaRevision.Deleted {
				continue
			}
			var schema CardSchema
			if err = json.Unmarshal(schemaRevision.Payload, &schema); err != nil {
				return nil, err
			}
			note.Content.ModelName = schema.Name
			references, err := store.projection.CardSourceReferences(ctx, note.Source.ID)
			if err != nil {
				return nil, err
			}
			for index, field := range schema.Fields {
				note.Content.Fields = append(note.Content.Fields, AnkiContentField{Ord: index, Name: field.Name})
				for _, ref := range references {
					if ref.FieldID == field.ID {
						note.Content.ExistingFieldIDs[index] = ref.EntityID
					}
				}
			}
			for _, ref := range references {
				if ref.Role == "container" {
					note.Content.ExistingContainerID = ref.EntityID
				}
			}
			for _, variant := range config.Variants {
				var data struct {
					ID    int64  `json:"ankiCardID"`
					Ord   int    `json:"ord"`
					SetID string `json:"reviewSetID"`
				}
				if err = json.Unmarshal(variant.Data, &data); err != nil {
					return nil, err
				}
				setRevision, found, err := store.projection.CurrentEntity(ctx, EntityReviewSet, data.SetID)
				if err != nil {
					return nil, err
				}
				if !found || setRevision.Deleted {
					continue
				}
				var set ReviewSet
				if err = json.Unmarshal(setRevision.Payload, &set); err != nil {
					return nil, err
				}
				note.Cards = append(note.Cards, ankiImportCard{ID: data.ID, NoteID: config.NoteID, Ord: data.Ord, DeckID: ankiConnectStableNumber(set.Name)})
			}
			ret = append(ret, note)
		}
		if offset+len(page.Entities) >= page.Total {
			break
		}
	}
	sort.Slice(ret, func(i, j int) bool { return ret[i].Config.NoteID < ret[j].Config.NoteID })
	return ret, nil
}

var ankiConnectCloze = regexp.MustCompile(`(?s)\{\{c([1-9][0-9]*)::.+?\}\}`)
var ankiConnectSoundField = regexp.MustCompile(`\[sound:([^\]]+)\]`)

func NormalizeAnkiConnectField(value string) string {
	value = ankiConnectSoundField.ReplaceAllString(value, `<audio src="$1"></audio>`)
	plain := strings.TrimSpace(html.UnescapeString(bluemonday.StrictPolicy().Sanitize(value)))
	tokens := nethtml.NewTokenizer(strings.NewReader(value))
	var media []string
	for {
		tokenType := tokens.Next()
		if tokenType == nethtml.ErrorToken {
			break
		}
		if tokenType != nethtml.StartTagToken && tokenType != nethtml.SelfClosingTagToken {
			continue
		}
		token := tokens.Token()
		if token.Data != "img" && token.Data != "audio" && token.Data != "video" {
			continue
		}
		for _, attribute := range token.Attr {
			if attribute.Key == "src" && attribute.Val != "" {
				media = append(media, strings.TrimPrefix(attribute.Val, "assets/"))
			}
		}
	}
	if len(media) > 0 {
		plain += "\n" + strings.Join(media, "\n")
	}
	return plain
}

var ankiConnectVisualMedia = regexp.MustCompile(`(?i)<(?:img|audio|video)\b[^>]*\bsrc\s*=`)

func AnkiConnectFieldHasContent(value string) bool {
	return NormalizeAnkiConnectField(value) != "" || ankiConnectVisualMedia.MatchString(value) || strings.Contains(value, "[sound:")
}

// ValidateAnkiConnectFields 与实际制卡共用题面判断，使预检查不会接受空题面或无效挖空。
func (store *Store) ValidateAnkiConnectFields(ctx context.Context, modelName string, fields map[string]string) error {
	models, err := store.AnkiConnectModels(ctx)
	if err != nil {
		return err
	}
	model, found := models[modelName]
	if !found {
		return errors.New("model was not found: " + modelName)
	}
	_, err = ankiConnectNoteOrdinals(model, fields)
	return err
}

func ankiConnectNoteOrdinals(model ankiModel, fields map[string]string) ([]int, error) {
	if len(model.Flds) == 0 || !AnkiConnectFieldHasContent(fields[model.Flds[0].Name]) {
		return nil, errors.New("cannot create note because it is empty")
	}
	ordinals := make([]int, 0)
	if model.Type == 1 {
		seen := make(map[int]bool)
		for _, field := range model.Flds {
			used := false
			for _, template := range model.Tmpls {
				for _, token := range ankiTemplateFieldPattern.FindAllStringSubmatch(template.QFmt, -1) {
					if strings.TrimSpace(token[1]) == "cloze:"+field.Name {
						used = true
					}
				}
			}
			if !used {
				continue
			}
			for _, match := range ankiConnectCloze.FindAllStringSubmatch(fields[field.Name], -1) {
				ordinal, err := strconv.Atoi(match[1])
				if err != nil || ordinal > 100 {
					return nil, errors.New("invalid cloze number")
				}
				if !seen[ordinal] {
					seen[ordinal] = true
					ordinals = append(ordinals, ordinal-1)
				}
			}
		}
	} else {
		for _, template := range model.Tmpls {
			if ankiConnectQuestionHasContent(template.QFmt, fields) {
				ordinals = append(ordinals, template.Ord)
			}
		}
	}
	if len(ordinals) == 0 {
		return nil, errors.New("The field values you have provided would make an empty question on all cards.")
	}
	sort.Ints(ordinals)
	return ordinals, nil
}

func ankiConnectQuestionHasContent(format string, fields map[string]string) bool {
	type section struct {
		name    string
		enabled bool
	}
	stack := []section{{enabled: true}}
	var output strings.Builder
	position := 0
	for _, match := range ankiTemplateFieldPattern.FindAllStringSubmatchIndex(format, -1) {
		active := stack[len(stack)-1].enabled
		if active {
			output.WriteString(format[position:match[0]])
		}
		position = match[1]
		token := strings.TrimSpace(format[match[2]:match[3]])
		if strings.HasPrefix(token, "#") || strings.HasPrefix(token, "^") {
			name := strings.TrimSpace(token[1:])
			enabled := AnkiConnectFieldHasContent(fields[name])
			if token[0] == '^' {
				enabled = !enabled
			}
			stack = append(stack, section{name: name, enabled: active && enabled})
		} else if strings.HasPrefix(token, "/") {
			if len(stack) == 1 || stack[len(stack)-1].name != strings.TrimSpace(token[1:]) {
				return false
			}
			stack = stack[:len(stack)-1]
		} else if active {
			if separator := strings.LastIndex(token, ":"); separator >= 0 {
				token = strings.TrimSpace(token[separator+1:])
			}
			output.WriteString(fields[token])
		}
	}
	if len(stack) != 1 {
		return false
	}
	output.WriteString(format[position:])
	return AnkiConnectFieldHasContent(output.String())
}

// UpsertAnkiConnectNote 仅协调指定卡源，字段更新保留已有卡片身份、排期和复习历史。
func (store *Store) UpsertAnkiConnectNote(ctx context.Context, input AnkiConnectNoteInput,
	existing *AnkiConnectStoredNote, writer AnkiContentWriter, now int64) (int64, error) {
	models, err := store.AnkiConnectModels(ctx)
	if err != nil {
		return 0, err
	}
	model, found := models[input.ModelName]
	if !found {
		return 0, errors.New("model was not found: " + input.ModelName)
	}
	decks, err := store.AnkiConnectDecks(ctx)
	if err != nil {
		return 0, err
	}
	deckID, found := decks[input.DeckName]
	if !found {
		return 0, errors.New("deck was not found: " + input.DeckName)
	}
	noteID := input.ID
	if existing == nil {
		for {
			if noteID, err = newAnkiConnectNumber(); err != nil {
				return 0, err
			}
			candidate := ankiImportNote{GUID: strconv.FormatInt(noteID, 10)}
			_, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, ankiSourceID(AnkiConnectCollectionID, candidate))
			if err != nil {
				return 0, err
			}
			if !found {
				break
			}
		}
	} else {
		noteID = existing.Config.NoteID
	}
	note := ankiImportNote{ID: noteID, GUID: strconv.FormatInt(noteID, 10), ModelID: model.ID, Tags: input.Tags, Modified: now / 1000}
	for _, field := range model.Flds {
		note.Fields = append(note.Fields, input.Fields[field.Name])
	}
	ordinals, err := ankiConnectNoteOrdinals(model, input.Fields)
	if err != nil {
		return 0, err
	}
	previousCards := make(map[int]int64)
	if existing != nil {
		// 非活跃变体仍保留身份，题面恢复后继续沿用对应排期与复习历史。
		revisions, err := store.projection.cardRevisionsBySource(ctx, existing.Source.ID)
		if err != nil {
			return 0, err
		}
		for _, revision := range revisions {
			var card Card
			if err = json.Unmarshal(revision.Payload, &card); err != nil {
				return 0, err
			}
			var variant struct {
				ID  int64 `json:"ankiCardID"`
				Ord int   `json:"ord"`
			}
			if err = json.Unmarshal(card.VariantData, &variant); err != nil {
				return 0, err
			}
			previousCards[variant.Ord] = variant.ID
		}
	}
	cards := make([]ankiImportCard, 0)
	{
		for _, ordinal := range ordinals {
			id, err := newAnkiConnectNumber()
			if err != nil {
				return 0, err
			}
			if previousCards[ordinal] != 0 {
				id = previousCards[ordinal]
			}
			cards = append(cards, ankiImportCard{ID: id, NoteID: noteID, DeckID: deckID, Ord: ordinal})
		}
	}
	data := ankiImportPackage{Preview: AnkiPackagePreview{CollectionID: AnkiConnectCollectionID, CollectionCrt: 1},
		Models: []ankiModel{model}, Notes: []ankiImportNote{note}, Decks: []ankiDeck{{ID: deckID, Name: input.DeckName}}}
	operationID := DeterministicID("anki-connect-note-operation", strconv.FormatInt(time.Now().UnixNano(), 10), strconv.FormatInt(noteID, 10))
	request := AnkiImportRequest{OperationID: operationID, ImportedAt: now, Writer: writer}
	definitions, err := store.prepareAnkiDefinitions(ctx, data, request)
	if err != nil {
		return 0, err
	}
	if len(definitions.definitions) > 0 {
		if _, err = store.MutateEntities(ctx, operationID+":definitions", definitions.definitions); err != nil {
			return 0, err
		}
	}
	content, err := store.prepareAnkiContentNotes(ctx, data, definitions)
	if err != nil {
		return 0, err
	}
	written, err := writer.WriteNotes(ctx, content)
	if err != nil {
		return 0, err
	}
	_, _, _, err = store.importAnkiNote(ctx, request, data, definitions, note, cards, nil, written[ankiSourceID(AnkiConnectCollectionID, note)])
	if err != nil {
		return 0, fmt.Errorf("write AnkiConnect note: %w", err)
	}
	return noteID, nil
}
