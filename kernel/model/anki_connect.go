package model

import (
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const ankiConnectMaxMedia = 32 << 20

var ankiConnectActions = []string{"version", "apiReflect", "multi", "deckNames", "deckNamesAndIds", "createDeck",
	"modelNames", "modelFieldNames", "canAddNotes", "canAddNotesWithErrorDetail", "addNote", "addNotes", "notesInfo",
	"updateNoteFields", "findNotes", "storeMediaFile"}

// AuthorizeAnkiConnect 只为兼容入口接受协议密钥或显式启用的可信本机免密请求。
func AuthorizeAnkiConnect(c *gin.Context, key string) error {
	if Conf.Flashcard == nil || !Conf.Flashcard.AnkiConnectEnabled {
		return errors.New("AnkiConnect is disabled")
	}
	if key == "" {
		for _, prefix := range []string{"Token ", "token ", "Bearer ", "bearer "} {
			if strings.HasPrefix(c.GetHeader("Authorization"), prefix) {
				key = strings.TrimPrefix(c.GetHeader("Authorization"), prefix)
				break
			}
		}
	}
	if key == "" {
		key = c.Query("token")
	}
	if key != "" {
		ip := c.ClientIP()
		if retryAfter := util.AuthThrottleCheck(ip); retryAfter > 0 {
			util.AuthThrottleFail(ip)
			c.Header("Retry-After", strconv.Itoa(retryAfter))
			return errors.New("too many authentication attempts")
		}
		if Conf.Api == nil || Conf.Api.Token == "" || !util.AuthCodeEquals(Conf.Api.Token, key) {
			util.AuthThrottleFail(ip)
			return errors.New("valid api key must be provided")
		}
		util.AuthThrottleReset(ip)
		c.Set(RoleContextKey, RoleAdministrator)
		return nil
	}
	if IsAdminRoleContext(c) {
		return nil
	}
	if Conf.Flashcard.AnkiConnectLocalWithoutKey && IsLocalRequest(c) && isLocalHostRequestAllowed(c) &&
		!util.IsCrossSiteFetchSite(c.GetHeader("Sec-Fetch-Site")) && c.GetHeader("Origin") == "" {
		c.Set(RoleContextKey, RoleAdministrator)
		return nil
	}
	return errors.New("valid api key must be provided")
}

type ankiConnectService struct {
	ctx      context.Context
	store    *flashcardv2.Store
	writer   *flashcardV2AnkiContentWriter
	readOnly bool
	requests int
}

func ProcessAnkiConnect(ctx context.Context, request apicontract.AnkiConnectRequest, readOnly bool) ([]byte, error) {
	flashcardV2AnkiImportLock.Lock()
	defer flashcardV2AnkiImportLock.Unlock()
	service := &ankiConnectService{ctx: ctx, readOnly: readOnly}
	return service.reply(request, 0)
}

func (service *ankiConnectService) reply(request apicontract.AnkiConnectRequest, depth int) ([]byte, error) {
	version := 4
	if request.Version != nil {
		version = *request.Version
	}
	service.requests++
	var value []byte
	var err error
	if version < 1 || version > 6 {
		err = errors.New("unsupported API version")
	} else if depth > 4 || service.requests > 100 {
		err = errors.New("too many AnkiConnect actions")
	} else if request.Key != "" && (Conf.Api == nil || !util.AuthCodeEquals(Conf.Api.Token, request.Key)) {
		err = errors.New("valid api key must be provided")
	} else {
		value, err = service.dispatch(request, depth)
	}
	if err == nil && version <= 4 {
		return value, nil
	}
	result := struct {
		Result json.RawMessage `json:"result"`
		Error  *string         `json:"error"`
	}{Result: value}
	if err != nil {
		message := err.Error()
		result.Result = nil
		result.Error = &message
	}
	return json.Marshal(result)
}

func (service *ankiConnectService) open(writable bool) error {
	if err := service.ctx.Err(); err != nil {
		return err
	}
	if writable && service.readOnly {
		return errors.New("SiYuan is read-only")
	}
	notebookID := strings.TrimSpace(Conf.Flashcard.AnkiConnectNotebook)
	if IsEncryptedBox(notebookID) {
		return errors.New("AnkiConnect does not support encrypted notebooks")
	}
	box, err := getOpenedBox(notebookID)
	if err != nil {
		return errors.New("select an opened notebook for AnkiConnect")
	}
	if box.Encrypted || IsEncryptedBox(box.ID) {
		return errors.New("AnkiConnect does not support encrypted notebooks")
	}
	if service.store != nil && !writable {
		return nil
	}
	store, err := requireFlashcardV2Store(service.ctx, writable)
	if err != nil {
		return err
	}
	service.store = store
	service.writer = &flashcardV2AnkiContentWriter{notebookID: box.ID, importedAt: time.Now().UnixMilli()}
	return nil
}

func (service *ankiConnectService) dispatch(request apicontract.AnkiConnectRequest, depth int) ([]byte, error) {
	supported := false
	for _, action := range ankiConnectActions {
		if action == request.Action {
			supported = true
			break
		}
	}
	if !supported {
		return nil, errors.New("unsupported action")
	}
	params := request.Params
	switch request.Action {
	case "version":
		return json.Marshal(6)
	case "apiReflect":
		if params.Scopes == nil {
			return nil, errors.New("scopes has invalid value")
		}
		includeActions := false
		for _, scope := range params.Scopes {
			if scope == "actions" {
				includeActions = true
			}
		}
		if !includeActions {
			return json.Marshal(apicontract.AnkiConnectReflection{Scopes: []string{}})
		}
		names := append([]string(nil), ankiConnectActions...)
		if params.Actions != nil && params.Actions.Names != nil {
			names = make([]string, 0)
			for _, requested := range params.Actions.Names {
				for _, name := range ankiConnectActions {
					if requested == name {
						names = append(names, name)
						break
					}
				}
			}
		} else if params.Actions != nil {
			return nil, errors.New("actions has invalid value")
		}
		return json.Marshal(apicontract.AnkiConnectReflection{Scopes: []string{"actions"}, Actions: &names})
	case "multi":
		if params.Actions == nil || params.Actions.Requests == nil || len(params.Actions.Requests) > 100 {
			return nil, errors.New("invalid actions")
		}
		replies := make([]json.RawMessage, 0, len(params.Actions.Requests))
		for _, action := range params.Actions.Requests {
			value, err := service.reply(action, depth+1)
			if err != nil {
				return nil, err
			}
			replies = append(replies, value)
		}
		return json.Marshal(replies)
	}
	writable := request.Action == "createDeck" || request.Action == "addNote" || request.Action == "addNotes" || request.Action == "updateNoteFields" || request.Action == "storeMediaFile"
	if err := service.open(writable); err != nil {
		return nil, err
	}
	switch request.Action {
	case "deckNames", "deckNamesAndIds":
		decks, err := service.store.AnkiConnectDecks(service.ctx)
		if err != nil {
			return nil, err
		}
		if request.Action == "deckNamesAndIds" {
			return json.Marshal(decks)
		}
		names := make([]string, 0, len(decks))
		for name := range decks {
			names = append(names, name)
		}
		sort.Strings(names)
		return json.Marshal(names)
	case "createDeck":
		id, err := service.store.CreateAnkiConnectDeck(service.ctx, params.Deck, time.Now().UnixMilli())
		if err != nil {
			return nil, err
		}
		return json.Marshal(id)
	case "modelNames", "modelFieldNames":
		models, err := service.store.AnkiConnectModels(service.ctx)
		if err != nil {
			return nil, err
		}
		names := make([]string, 0)
		if request.Action == "modelNames" {
			for name := range models {
				names = append(names, name)
			}
			sort.Strings(names)
		} else {
			model, found := models[params.ModelName]
			if !found {
				return nil, errors.New("model was not found: " + params.ModelName)
			}
			for _, field := range model.Flds {
				names = append(names, field.Name)
			}
		}
		return json.Marshal(names)
	case "addNote":
		if params.Note == nil {
			return nil, errors.New("note is required")
		}
		id, err := service.addNote(*params.Note)
		if err != nil {
			return nil, err
		}
		return json.Marshal(id)
	case "addNotes", "canAddNotes", "canAddNotesWithErrorDetail":
		if params.Notes == nil || params.Notes.Values == nil || len(params.Notes.Values) > 100 {
			return nil, errors.New("invalid notes")
		}
		ids := make([]*int64, 0, len(params.Notes.Values))
		allowed := make([]bool, 0, len(params.Notes.Values))
		type detail struct {
			CanAdd bool    `json:"canAdd"`
			Error  *string `json:"error"`
		}
		details := make([]detail, 0, len(params.Notes.Values))
		for _, note := range params.Notes.Values {
			_, err := service.validateNote(note)
			if request.Action == "addNotes" && err == nil {
				id, writeErr := service.addNote(note)
				err = writeErr
				if err == nil {
					ids = append(ids, &id)
				} else {
					ids = append(ids, nil)
				}
			} else if request.Action == "addNotes" {
				ids = append(ids, nil)
			}
			allowed = append(allowed, err == nil)
			item := detail{CanAdd: err == nil}
			if err != nil {
				message := err.Error()
				item.Error = &message
			}
			details = append(details, item)
		}
		if request.Action == "addNotes" {
			return json.Marshal(ids)
		}
		if request.Action == "canAddNotes" {
			return json.Marshal(allowed)
		}
		return json.Marshal(details)
	case "notesInfo", "findNotes":
		notes, err := service.notes()
		if err != nil {
			return nil, err
		}
		if request.Action == "findNotes" {
			return findAnkiConnectNotes(params.Query, notes)
		}
		if params.Notes == nil || params.Notes.IDs == nil || len(params.Notes.IDs) > 100 {
			return nil, errors.New("invalid note IDs")
		}
		result := make([]apicontract.AnkiConnectNoteInfoResult, 0, len(params.Notes.IDs))
		for _, id := range params.Notes.IDs {
			var item *apicontract.AnkiConnectNoteInfo
			for index := range notes {
				if notes[index].NoteID == id {
					note := notes[index]
					item = &apicontract.AnkiConnectNoteInfo{NoteID: note.NoteID, ModelName: note.ModelName,
						Tags: note.Tags, Fields: note.Fields, Cards: note.Cards}
					break
				}
			}
			result = append(result, apicontract.AnkiConnectNoteInfoResult{Note: item})
		}
		return json.Marshal(result)
	case "updateNoteFields":
		if params.Note == nil || params.Note.ID <= 0 {
			return nil, errors.New("invalid note ID")
		}
		if len(params.Note.Fields) > 100 {
			return nil, errors.New("too many note fields")
		}
		for _, value := range params.Note.Fields {
			if len(value) > 2<<20 {
				return nil, errors.New("note field is too large")
			}
		}
		stored, err := service.store.AnkiConnectNotes(service.ctx)
		if err != nil {
			return nil, err
		}
		for _, note := range stored {
			if note.Config.NoteID != params.Note.ID {
				continue
			}
			input, err := service.readNote(note)
			if err != nil {
				return nil, err
			}
			for name, value := range params.Note.Fields {
				field, ok := input.Fields[name]
				if !ok {
					continue
				}
				field.Value = value
				input.Fields[name] = field
			}
			fields := make(map[string]string)
			for name, field := range input.Fields {
				fields[name] = field.Value
			}
			if err = service.attachMedia(fields, *params.Note); err != nil {
				return nil, err
			}
			_, err = service.store.UpsertAnkiConnectNote(service.ctx, flashcardv2.AnkiConnectNoteInput{ID: input.NoteID,
				DeckName: input.DeckName, ModelName: input.ModelName, Fields: fields, Tags: input.Tags}, &note, service.writer, time.Now().UnixMilli())
			if err != nil {
				return nil, err
			}
			return []byte("null"), nil
		}
		return nil, errors.New("Note was not found")
	case "storeMediaFile":
		filename, err := service.media(apicontract.AnkiConnectMedia{Filename: params.Filename, Data: params.Data, URL: params.URL, Path: params.Path, SkipHash: params.SkipHash})
		if err != nil {
			return nil, err
		}
		if filename == "" {
			return []byte("null"), nil
		}
		return json.Marshal(filename)
	default:
		return nil, errors.New("unsupported action")
	}
}

type ankiConnectFieldInfo = apicontract.AnkiConnectFieldInfo
type ankiConnectNoteInfo struct {
	NoteID    int64                           `json:"noteId"`
	ModelName string                          `json:"modelName"`
	Tags      []string                        `json:"tags"`
	Fields    map[string]ankiConnectFieldInfo `json:"fields"`
	Cards     []int64                         `json:"cards"`
	DeckName  string                          `json:"-"`
}

func (service *ankiConnectService) readNote(note flashcardv2.AnkiConnectStoredNote) (ankiConnectNoteInfo, error) {
	ret := ankiConnectNoteInfo{NoteID: note.Config.NoteID, ModelName: note.Content.ModelName,
		Tags: make([]string, 0), Fields: make(map[string]ankiConnectFieldInfo), Cards: make([]int64, 0)}
	ids := []string{note.Content.ExistingContainerID}
	for _, id := range note.Content.ExistingFieldIDs {
		ids = append(ids, id)
	}
	if err := ValidateFlashcardBlockIDs(ids); err != nil {
		return ret, err
	}
	for _, field := range note.Content.Fields {
		dom := GetBlockDOM(note.Content.ExistingFieldIDs[field.Ord])
		if dom == "" {
			return ret, errors.New("note field is unavailable")
		}
		ret.Fields[field.Name] = ankiConnectFieldInfo{Value: util.NewLute().BlockDOM2HTML(dom), Order: field.Ord}
	}
	for _, id := range note.Config.ReviewSetIDs {
		revision, found, err := service.store.Projection().CurrentEntity(service.ctx, flashcardv2.EntityReviewSet, id)
		if err != nil {
			return ret, err
		}
		if found && !revision.Deleted {
			var set flashcardv2.ReviewSet
			if err = json.Unmarshal(revision.Payload, &set); err != nil {
				return ret, err
			}
			ret.DeckName = set.Name
			break
		}
	}
	for _, id := range note.Config.TagIDs {
		parts := make([]string, 0)
		for count := 0; id != "" && count < 64; count++ {
			revision, found, err := service.store.Projection().CurrentEntity(service.ctx, flashcardv2.EntityTag, id)
			if err != nil {
				return ret, err
			}
			if !found || revision.Deleted {
				break
			}
			var tag flashcardv2.Tag
			if err = json.Unmarshal(revision.Payload, &tag); err != nil {
				return ret, err
			}
			parts = append([]string{tag.Name}, parts...)
			id = tag.ParentID
		}
		if len(parts) > 0 {
			ret.Tags = append(ret.Tags, strings.Join(parts, "::"))
		}
	}
	for _, variant := range note.Config.Variants {
		var data struct {
			ID int64 `json:"ankiCardID"`
		}
		if err := json.Unmarshal(variant.Data, &data); err != nil {
			return ret, err
		}
		ret.Cards = append(ret.Cards, data.ID)
	}
	return ret, nil
}

func (service *ankiConnectService) notes() ([]ankiConnectNoteInfo, error) {
	stored, err := service.store.AnkiConnectNotes(service.ctx)
	if err != nil {
		return nil, err
	}
	ret := make([]ankiConnectNoteInfo, 0, len(stored))
	for _, note := range stored {
		if err := service.ctx.Err(); err != nil {
			return nil, err
		}
		value, err := service.readNote(note)
		if err != nil {
			continue
		}
		ret = append(ret, value)
	}
	return ret, nil
}

func (service *ankiConnectService) validateNote(note apicontract.AnkiConnectNote) (flashcardv2.AnkiConnectNoteInput, error) {
	input := flashcardv2.AnkiConnectNoteInput{DeckName: strings.TrimSpace(note.DeckName), ModelName: note.ModelName, Fields: make(map[string]string), Tags: note.Tags}
	models, err := service.store.AnkiConnectModels(service.ctx)
	if err != nil {
		return input, err
	}
	model, found := models[note.ModelName]
	if !found {
		return input, errors.New("model was not found: " + note.ModelName)
	}
	decks, err := service.store.AnkiConnectDecks(service.ctx)
	if err != nil {
		return input, err
	}
	if _, found := decks[input.DeckName]; !found {
		return input, errors.New("deck was not found: " + input.DeckName)
	}
	if len(note.Fields) > 100 || len(note.Tags) > 100 {
		return input, errors.New("too many note fields or tags")
	}
	for _, field := range model.Flds {
		input.Fields[field.Name] = ""
		for name, value := range note.Fields {
			if strings.EqualFold(field.Name, name) {
				if len(value) > 2<<20 {
					return input, errors.New("note field is too large")
				}
				input.Fields[field.Name] = value
				break
			}
		}
	}
	if len(model.Flds) == 0 {
		return input, errors.New("model has no fields")
	}
	first := input.Fields[model.Flds[0].Name]
	if !flashcardv2.AnkiConnectFieldHasContent(first) && len(note.Audio)+len(note.Video)+len(note.Picture) == 0 {
		return input, errors.New("cannot create note because it is empty")
	}
	if model.Type == 1 && !strings.Contains(first, "{{c") {
		return input, errors.New("note has no cloze")
	}
	questionFields := make(map[string]string, len(input.Fields))
	for name, value := range input.Fields {
		questionFields[name] = value
	}
	for _, items := range [][]apicontract.AnkiConnectMedia{note.Audio, note.Video, note.Picture} {
		if len(items) > 20 {
			return input, errors.New("too many media files")
		}
		for _, item := range items {
			if len(item.Fields) == 0 || len(item.Fields) > 100 {
				return input, errors.New("invalid media fields")
			}
			for _, name := range item.Fields {
				if _, found := questionFields[name]; !found {
					return input, errors.New("media field was not found: " + name)
				}
				questionFields[name] += `<img src="media">`
			}
		}
	}
	if err = service.store.ValidateAnkiConnectFields(service.ctx, input.ModelName, questionFields); err != nil {
		return input, err
	}
	if note.Options.DuplicateScope != "" && note.Options.DuplicateScope != "collection" && note.Options.DuplicateScope != "deck" {
		return input, errors.New("unsupported duplicate scope")
	}
	if !note.Options.AllowDuplicate {
		existing, err := service.notes()
		if err != nil {
			return input, err
		}
		for _, candidate := range existing {
			if !note.Options.DuplicateScopeOptions.CheckAllModels && candidate.ModelName != input.ModelName {
				continue
			}
			if note.Options.DuplicateScope == "deck" {
				deck := input.DeckName
				if note.Options.DuplicateScopeOptions.DeckName != "" {
					deck = note.Options.DuplicateScopeOptions.DeckName
				}
				if candidate.DeckName != deck && !(note.Options.DuplicateScopeOptions.CheckChildren && strings.HasPrefix(candidate.DeckName, deck+"::")) {
					continue
				}
			}
			for _, field := range candidate.Fields {
				if field.Order == 0 && flashcardv2.NormalizeAnkiConnectField(field.Value) == flashcardv2.NormalizeAnkiConnectField(first) {
					return input, errors.New("cannot create note because it is a duplicate")
				}
			}
		}
	}
	return input, nil
}

var ankiConnectMediaReference = regexp.MustCompile(`(?i)(?:src=["']|\[sound:)(anki-[a-f0-9]{32}(?:\.[a-z0-9]{1,15})?)`)

func (service *ankiConnectService) addNote(note apicontract.AnkiConnectNote) (int64, error) {
	input, err := service.validateNote(note)
	if err != nil {
		return 0, err
	}
	if err = service.attachMedia(input.Fields, note); err != nil {
		return 0, err
	}
	note.Fields, note.Audio, note.Video, note.Picture = input.Fields, nil, nil, nil
	input, err = service.validateNote(note)
	if err != nil {
		return 0, err
	}
	return service.store.UpsertAnkiConnectNote(service.ctx, input, nil, service.writer, time.Now().UnixMilli())
}

var ankiConnectSound = regexp.MustCompile(`\[sound:(assets/anki-[a-f0-9]{32}(?:\.[a-zA-Z0-9]{1,15})?)\]`)

func (service *ankiConnectService) attachMedia(fields map[string]string, note apicontract.AnkiConnectNote) error {
	for name, value := range fields {
		value = ankiConnectMediaReference.ReplaceAllStringFunc(value, func(match string) string {
			groups := ankiConnectMediaReference.FindStringSubmatch(match)
			return strings.Replace(match, groups[1], "assets/"+groups[1], 1)
		})
		fields[name] = ankiConnectSound.ReplaceAllString(value, `<audio controls src="$1"></audio>`)
	}
	for index, items := range [][]apicontract.AnkiConnectMedia{note.Audio, note.Video, note.Picture} {
		if len(items) > 20 {
			return errors.New("too many media files")
		}
		for _, item := range items {
			if len(item.Fields) == 0 || len(item.Fields) > 100 {
				return errors.New("invalid media fields")
			}
			for _, field := range item.Fields {
				if _, found := fields[field]; !found {
					return errors.New("media field was not found: " + field)
				}
			}
			filename, err := service.media(item)
			if err != nil {
				return err
			}
			if filename == "" {
				continue
			}
			for _, field := range item.Fields {
				if _, found := fields[field]; !found {
					return errors.New("media field was not found: " + field)
				}
				src := html.EscapeString("assets/" + filename)
				markup := "<audio controls src=\"" + src + "\"></audio>"
				if index == 1 {
					markup = "<video controls src=\"" + src + "\"></video>"
				}
				if index == 2 {
					markup = "<img src=\"" + src + "\">"
				}
				fields[field] += markup
			}
		}
	}
	return nil
}

func (service *ankiConnectService) media(media apicontract.AnkiConnectMedia) (string, error) {
	if media.Filename == "" || filepath.Base(media.Filename) != media.Filename || strings.ContainsAny(media.Filename, "\\/") {
		return "", errors.New("invalid media filename")
	}
	if media.Path != "" {
		return "", errors.New("local file paths are not supported; use base64 data or an HTTP URL")
	}
	var data []byte
	var err error
	if media.Data != "" {
		if len(media.Data) > base64.StdEncoding.EncodedLen(ankiConnectMaxMedia) {
			return "", errors.New("media file is too large")
		}
		data, err = base64.StdEncoding.DecodeString(media.Data)
	} else if media.URL != "" {
		parsed, parseErr := url.Parse(media.URL)
		if parseErr != nil || parsed.Host == "" || parsed.User != nil || parsed.Scheme != "http" && parsed.Scheme != "https" {
			return "", errors.New("invalid media URL")
		}
		request, requestErr := http.NewRequestWithContext(service.ctx, http.MethodGet, media.URL, nil)
		if requestErr != nil {
			return "", requestErr
		}
		client := &http.Client{Timeout: 15 * time.Second}
		response, requestErr := client.Do(request)
		if requestErr != nil {
			return "", requestErr
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return "", fmt.Errorf("media download failed: HTTP %d", response.StatusCode)
		}
		data, err = io.ReadAll(io.LimitReader(response.Body, ankiConnectMaxMedia+1))
	} else {
		return "", errors.New("media data or URL is required")
	}
	if err != nil {
		return "", err
	}
	if len(data) > ankiConnectMaxMedia {
		return "", errors.New("media file is too large")
	}
	if media.SkipHash != "" {
		digest := md5.Sum(data)
		if strings.EqualFold(media.SkipHash, hex.EncodeToString(digest[:])) {
			return "", nil
		}
	}
	path, err := service.writer.StoreMedia(service.ctx, media.Filename, data)
	if err != nil {
		return "", err
	}
	return strings.TrimPrefix(path, "assets/"), nil
}
