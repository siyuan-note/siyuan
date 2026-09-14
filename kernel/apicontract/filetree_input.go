package apicontract

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
)

type fileTreeFields map[string]json.RawMessage

func fileTreeRequestFields(reader io.Reader, path string) (fields fileTreeFields, err error) {
	var raw json.RawMessage
	err = json.NewDecoder(reader).Decode(&raw)
	if err == nil {
		fields, err = legacyJSONValue[fileTreeFields](raw)
	}
	if err != nil {
		if errors.Is(err, io.EOF) {
			err = errors.New("the request body is empty or truncated (EOF)")
		}
		detail := strings.ReplaceAll(err.Error(), "apicontract.fileTreeFields", "map[string]interface {}")
		err = fmt.Errorf("Parses request [%s] failed: %s", path, detail)
	}
	return
}

func fileTreeJSONDecoder[Request, Data any](endpoint *Endpoint[Request, Data]) {
	endpoint.decodeRequest = func(reader io.Reader) (request Request, err error) {
		fields, err := fileTreeRequestFields(reader, endpoint.definition.Path)
		if err == nil {
			request, err = fileTreeBind[Request](fields)
		}
		return request, err
	}
}

func (r FileTreePathRequest) PathError() error { return r.pathError }

func fileTreeBind[T any](fields fileTreeFields) (value T, err error) {
	err = decodeRequestFields(reflect.ValueOf(&value).Elem(), fields)
	return
}

func (r FileTreeHeadingDocRequest) Options() (FileTreeBlockDocOptions, error) {
	return fileTreeBind[FileTreeBlockDocOptions](r.fields)
}
func (r FileTreeListItemDocRequest) Options() (FileTreeBlockDocOptions, error) {
	return fileTreeBind[FileTreeBlockDocOptions](r.fields)
}
func (r FileTreeRenameIDRequest) DocTitle() (string, error) {
	value, err := fileTreeBind[struct {
		Title string `json:"title"`
	}](r.fields)
	return value.Title, err
}
func (r FileTreeListRequest) Options() (FileTreeListOptions, error) {
	fields := make(fileTreeFields, len(r.fields))
	for key, value := range r.fields {
		if key != "ignoreMaxListHint" && key != "app" {
			fields[key] = value
		}
	}
	return fileTreeBind[FileTreeListOptions](fields)
}

func (r FileTreeListRequest) HintOptions() (ignore bool, app string, err error) {
	value, err := fileTreeBind[struct {
		Ignore bool `json:"ignoreMaxListHint" api:"optional,nullable"`
	}](r.fields)
	if err != nil || value.Ignore {
		return value.Ignore, "", err
	}
	application, err := fileTreeBind[struct {
		App string `json:"app" api:"optional,nullable"`
	}](r.fields)
	return false, application.App, err
}

func (r FileTreeDailyNoteRequest) AppID() (string, error) {
	value, err := fileTreeBind[struct {
		App string `json:"app" api:"optional,nullable"`
	}](r.fields)
	return value.App, err
}
func (r FileTreeSetPublishRequest) Options() (FileTreePublishOptions, error) {
	return fileTreeBind[FileTreePublishOptions](r.fields)
}
func (r FileTreeGetDocRequest) Options() (FileTreeGetDocOptions, error) {
	fields := make(fileTreeFields, len(r.fields))
	for key, value := range r.fields {
		fields[key] = value
	}
	var includeDocInfo bool
	if json.Unmarshal(fields["includeDocInfo"], &includeDocInfo) != nil {
		delete(fields, "includeDocInfo")
	}
	if len(fields["startID"]) == 0 || bytes.Equal(fields["startID"], []byte("null")) || len(fields["endID"]) == 0 || bytes.Equal(fields["endID"], []byte("null")) {
		delete(fields, "startID")
		delete(fields, "endID")
	}
	// 文档查询复用分组筛选的兼容规则，未知分组和非布尔选项不会生效。
	filter, _ := json.Marshal(map[string]json.RawMessage{"subTypes": fields["querySubTypes"]})
	if fields["querySubTypes"] != nil {
		filtered, err := searchQueryFields(bytes.NewReader(filter), "/api/filetree/getDoc")
		if err != nil {
			return FileTreeGetDocOptions{}, err
		}
		delete(fields, "querySubTypes")
		if value, ok := filtered["subTypes"]; ok {
			fields["querySubTypes"] = value
		}
	}
	return fileTreeBind[FileTreeGetDocOptions](fields)
}

func (r FileTreeSortModeRequest) Mode() (*int, error) {
	raw := r.sortModeFields["sortMode"]
	if len(raw) == 0 {
		return nil, fmt.Errorf("Field [sortMode] is required")
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, nil
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, fmt.Errorf("Field [sortMode] must be an integer or null: %s", err)
	}
	return &value, nil
}

func init() {
	fileTreeJSONDecoder(&MoveLocalShorthands)
	fileTreeJSONDecoder(&UpsertIndexes)
	fileTreeJSONDecoder(&RemoveIndexes)
	fileTreeJSONDecoder(&Doc2Heading)
	fileTreeJSONDecoder(&GetHPathByPath)
	fileTreeJSONDecoder(&GetHPathsByPaths)
	fileTreeJSONDecoder(&GetHPathByID)
	fileTreeJSONDecoder(&GetFullHPathByID)
	fileTreeJSONDecoder(&MoveDocs)
	fileTreeJSONDecoder(&MoveDocsByID)
	fileTreeJSONDecoder(&RemoveDoc)
	fileTreeJSONDecoder(&RemoveDocs)
	fileTreeJSONDecoder(&RenameDoc)
	fileTreeJSONDecoder(&DuplicateDoc)
	fileTreeJSONDecoder(&CreateDoc)
	fileTreeJSONDecoder(&CreateDocWithMd)
	fileTreeJSONDecoder(&GetDocCreateSavePath)
	fileTreeJSONDecoder(&GetRefCreateSavePath)
	fileTreeJSONDecoder(&GetShorthandSavePath)
	fileTreeJSONDecoder(&ChangeSort)
	fileTreeJSONDecoder(&SearchDocs)
	fileTreeJSONDecoder(&GetPublishAccess)
	fileTreeJSONDecoder(&AuthFilePublishAccess)
	trimIDDecoder := func(path string) func(io.Reader) (FileTreeTrimIDRequest, error) {
		return func(reader io.Reader) (r FileTreeTrimIDRequest, err error) {
			fields, err := fileTreeRequestFields(reader, path)
			if err != nil {
				return r, err
			}
			r.ID, err = legacyField[string](fields, "id", "String", true)
			if err == nil {
				r.ID = strings.TrimSpace(r.ID)
				if r.ID == "" {
					err = fmt.Errorf("Field [id] must not be empty")
				}
			}
			return r, err
		}
	}
	RemoveDocByID.decodeRequest = trimIDDecoder(RemoveDocByID.definition.Path)
	GetPathByID.decodeRequest = trimIDDecoder(GetPathByID.definition.Path)
	GetIDsByHPath.decodeRequest = func(reader io.Reader) (r FileTreeOptionalPathRequest, err error) {
		fields, err := fileTreeRequestFields(reader, GetIDsByHPath.definition.Path)
		if err != nil {
			return r, err
		}
		for _, key := range []string{"path", "notebook"} {
			if len(fields[key]) == 0 || bytes.Equal(fields[key], []byte("null")) {
				return r, nil
			}
		}
		return fileTreeBind[FileTreeOptionalPathRequest](fields)
	}
	CreateDailyNote.decodeRequest = func(reader io.Reader) (r FileTreeDailyNoteRequest, err error) {
		r.fields, err = fileTreeRequestFields(reader, CreateDailyNote.definition.Path)
		if err != nil {
			return r, err
		}
		value, err := fileTreeBind[FileTreeNotebookRequest](r.fields)
		r.Notebook = value.Notebook
		return r, err
	}
	ListDocTree.decodeRequest = func(reader io.Reader) (r FileTreePathRequest, err error) {
		fields, err := fileTreeRequestFields(reader, ListDocTree.definition.Path)
		if err != nil {
			return r, err
		}
		initial, err := fileTreeBind[FileTreeNotebookRequest](fields)
		if err != nil {
			return r, err
		}
		r.Notebook = initial.Notebook
		value, decodeErr := fileTreeBind[struct {
			Path string `json:"path"`
		}](fields)
		r.Path, r.pathError = value.Path, decodeErr
		return r, nil
	}
	ReorderDocs.decodeRequest = func(reader io.Reader) (r FileTreeReorderRequest, err error) {
		var value struct {
			RespectSort bool     `json:"respectSort"`
			Preview     bool     `json:"preview"`
			RemoveSorts bool     `json:"removeSorts"`
			SourceIDs   []string `json:"sourceIDs"`
			TargetID    string   `json:"targetID"`
			Position    string   `json:"position"`
		}
		if err = json.NewDecoder(reader).Decode(&value); err != nil {
			return r, fmt.Errorf("Parses request [%s] failed: %s", ReorderDocs.definition.Path, err)
		}
		r = FileTreeReorderRequest(value)
		return r, nil
	}
	SetSort.decodeRequest = func(reader io.Reader) (r FileTreeSetSortRequest, err error) {
		var value struct {
			NotebookSorts []*FileTreeSortItem `json:"notebookSorts"`
			DocSorts      []*FileTreeSortItem `json:"docSorts"`
		}
		if err = json.NewDecoder(reader).Decode(&value); err != nil {
			detail := strings.ReplaceAll(err.Error(), "FileTreeSortItem.", "sortRequestItem.")
			return r, fmt.Errorf("Parses request [%s] failed: %s", SetSort.definition.Path, detail)
		}
		r = FileTreeSetSortRequest(value)
		return r, nil
	}
	Heading2Doc.decodeRequest = func(reader io.Reader) (r FileTreeHeadingDocRequest, err error) {
		r.fields, err = fileTreeRequestFields(reader, Heading2Doc.definition.Path)
		if err != nil {
			return r, err
		}
		value, err := fileTreeBind[struct {
			SrcHeadingID   string `json:"srcHeadingID"`
			TargetNotebook string `json:"targetNoteBook"`
		}](r.fields)
		r.SrcHeadingID, r.TargetNotebook = value.SrcHeadingID, value.TargetNotebook
		return r, err
	}
	Li2Doc.decodeRequest = func(reader io.Reader) (r FileTreeListItemDocRequest, err error) {
		r.fields, err = fileTreeRequestFields(reader, Li2Doc.definition.Path)
		if err != nil {
			return r, err
		}
		value, err := fileTreeBind[struct {
			SrcListItemID  string `json:"srcListItemID"`
			TargetNotebook string `json:"targetNoteBook"`
		}](r.fields)
		r.SrcListItemID, r.TargetNotebook = value.SrcListItemID, value.TargetNotebook
		return r, err
	}
	RenameDocByID.decodeRequest = func(reader io.Reader) (r FileTreeRenameIDRequest, err error) {
		r.fields, err = fileTreeRequestFields(reader, RenameDocByID.definition.Path)
		if err != nil {
			return r, err
		}
		value, err := fileTreeBind[FileTreeOptionalIDRequest](r.fields)
		r.ID = value.ID
		return r, err
	}
	ListDocsByPath.decodeRequest = func(reader io.Reader) (r FileTreeListRequest, err error) {
		r.fields, err = fileTreeRequestFields(reader, ListDocsByPath.definition.Path)
		if err == nil {
			r.FileTreePathRequest, err = fileTreeBind[FileTreePathRequest](r.fields)
		}
		return r, err
	}
	GetDoc.decodeRequest = func(reader io.Reader) (r FileTreeGetDocRequest, err error) {
		r.fields, err = fileTreeRequestFields(reader, GetDoc.definition.Path)
		if err != nil {
			return r, err
		}
		r.ID, err = legacyField[string](r.fields, "id", "String", true)
		if err != nil {
			return r, err
		}
		value, err := fileTreeBind[struct {
			ID       string `json:"id" api:"trim"`
			Notebook string `json:"notebook" api:"optional,nullable,ignoretype"`
		}](r.fields)
		r.ID, r.Notebook = value.ID, value.Notebook
		return r, err
	}
	SetPublishAccess.decodeRequest = func(reader io.Reader) (r FileTreeSetPublishRequest, err error) {
		r.fields, err = fileTreeRequestFields(reader, SetPublishAccess.definition.Path)
		if err != nil {
			return r, err
		}
		value, err := fileTreeBind[FileTreeIDRequest](r.fields)
		r.ID = value.ID
		return r, err
	}
	SetDocSortMode.decodeRequest = func(reader io.Reader) (r FileTreeSortModeRequest, err error) {
		var value struct {
			ID       string          `json:"id"`
			SortMode json.RawMessage `json:"sortMode"`
		}
		if err = json.NewDecoder(reader).Decode(&value); err != nil {
			return r, fmt.Errorf("Parses request [%s] failed: %s", SetDocSortMode.definition.Path, err)
		}
		r.ID, r.sortModeFields = value.ID, fileTreeFields{"sortMode": value.SortMode}
		return r, nil
	}
}
