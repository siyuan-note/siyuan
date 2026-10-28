// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
)

type DocumentCreateTitle struct {
	Format string `json:"format"`
	Text   string `json:"text"`
}

type CreateDocByParentRequest struct {
	Notebook               string                  `json:"notebook"`
	ParentID               *string                 `json:"parentID"`
	ID                     string                  `json:"id"`
	Title                  DocumentCreateTitle     `json:"title"`
	Markdown               string                  `json:"markdown"`
	ExpectedParentRevision *string                 `json:"expectedParentRevision,omitempty" api:"optional,nonnullable"`
	ExpectedTarget         *DocumentTargetRevision `json:"expectedTarget,omitempty" api:"optional,nonnullable"`
	NameConditions         []DocumentNameCondition `json:"nameConditions,omitempty" api:"optional,nonnullable"`
	Tags                   string                  `json:"tags,omitempty" api:"optional"`
	WithMath               bool                    `json:"withMath,omitempty" api:"optional"`
	ClippingHref           string                  `json:"clippingHref,omitempty" api:"optional"`
	Sorts                  []string                `json:"sorts,omitempty" api:"optional,nonnullable"`
	SortTargetID           string                  `json:"sortTargetID,omitempty" api:"optional"`
	SortPosition           string                  `json:"sortPosition,omitempty" api:"optional,enum=before|after"`
	DocCreateTemplatePath  string                  `json:"docCreateTemplatePath,omitempty" api:"optional"`
	ListDocTree            bool                    `json:"listDocTree,omitempty" api:"optional"`
}

// UnmarshalJSON 拒绝 path/hPath 等第二位置来源，并保留空标题、显式根与缺省字段的区别。
func (request *CreateDocByParentRequest) UnmarshalJSON(data []byte) error {
	type plain CreateDocByParentRequest
	var next plain
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&next); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for _, key := range []string{"notebook", "parentID", "id", "title", "markdown"} {
		if _, exists := fields[key]; !exists || key != "parentID" && bytes.Equal(fields[key], []byte("null")) {
			return errors.New("missing or null required field: " + key)
		}
	}
	for key, value := range fields {
		if key != "parentID" && bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return errors.New("null field: " + key)
		}
	}
	var title map[string]json.RawMessage
	if err := json.Unmarshal(fields["title"], &title); err != nil {
		return err
	}
	for _, key := range []string{"format", "text"} {
		if value, exists := title[key]; !exists || bytes.Equal(value, []byte("null")) {
			return errors.New("missing or null title field: " + key)
		}
	}
	var conditions []map[string]json.RawMessage
	if value, exists := fields["nameConditions"]; exists {
		if err := json.Unmarshal(value, &conditions); err != nil {
			return err
		}
	}
	if value, exists := fields["expectedTarget"]; exists {
		var target map[string]json.RawMessage
		if err := json.Unmarshal(value, &target); err != nil {
			return err
		}
		for _, key := range []string{"notebook", "purpose", "revision"} {
			if value, exists := target[key]; !exists || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
				return errors.New("missing or null target revision field: " + key)
			}
		}
	}
	for _, condition := range conditions {
		for _, key := range []string{"parentID", "title", "expectedID"} {
			if _, exists := condition[key]; !exists {
				return errors.New("missing name condition field: " + key)
			}
		}
		if bytes.Equal(bytes.TrimSpace(condition["title"]), []byte("null")) {
			return errors.New("null name condition title")
		}
	}
	*request = CreateDocByParentRequest(next)
	return nil
}

type CreatedDocumentData struct {
	ID       string       `json:"id"`
	Document DocumentPath `json:"document"`
}

type DocumentCreateFailure struct {
	Reason      string   `json:"reason" api:"enum=invalidTitle|parentUnavailable|planChanged|documentIDConflict|indexUnavailable|unsupportedTitleFormat|writeFailed"`
	CommitState string   `json:"commitState" api:"enum=none|committed|unknown"`
	ID          string   `json:"id,omitempty" api:"optional"`
	Stage       string   `json:"stage"`
	Completed   []string `json:"completed"`
}

type CreateDocByParentResult struct {
	value   *CreatedDocumentData
	failure *DocumentCreateFailure
}

func NewCreateDocByParentResult(value CreatedDocumentData) CreateDocByParentResult {
	return CreateDocByParentResult{value: &value}
}

func NewCreateDocByParentFailure(value DocumentCreateFailure) CreateDocByParentResult {
	return CreateDocByParentResult{failure: &value}
}

func (value CreateDocByParentResult) MarshalJSON() ([]byte, error) {
	if value.value != nil {
		return json.Marshal(value.value)
	}
	if value.failure != nil {
		return json.Marshal(value.failure)
	}
	return nil, errors.New("document creation response is not set")
}

type DocumentTitle struct {
	Format string `json:"format" api:"enum=plain"`
	Text   string `json:"text"`
	Empty  bool   `json:"empty"`
}

type DocumentPathSegment struct {
	ID    string `json:"id"`
	Text  string `json:"text"`
	Empty bool   `json:"empty"`
}

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

type GetDocPathsRequest struct {
	Notebook string   `json:"notebook"`
	IDs      []string `json:"ids"`
}

type DocumentPathsData struct {
	Documents  []DocumentPath `json:"documents"`
	MissingIDs []string       `json:"missingIDs"`
}

type DocumentPathStart struct {
	Kind string  `json:"kind" api:"enum=root|document"`
	ID   *string `json:"id,omitempty" api:"optional,nonnullable"`
}

type ResolveDocPathRequest struct {
	Notebook string            `json:"notebook"`
	Start    DocumentPathStart `json:"start"`
	Segments []string          `json:"segments"`
}

type DocumentLocation struct {
	Notebook string  `json:"notebook"`
	ID       *string `json:"id"`
	Revision string  `json:"revision"`
}

type DocumentNameCondition struct {
	ParentID   *string `json:"parentID"`
	Title      string  `json:"title"`
	ExpectedID *string `json:"expectedID"`
}

type ResolvedDocumentPathData struct {
	Status              string                  `json:"status" api:"enum=resolved|missing|ambiguous"`
	Start               DocumentLocation        `json:"start"`
	Resolved            *DocumentPath           `json:"resolved"`
	NextIndex           int                     `json:"nextIndex"`
	Candidates          []DocumentPath          `json:"candidates"`
	CandidatesTruncated bool                    `json:"candidatesTruncated"`
	NameConditions      []DocumentNameCondition `json:"nameConditions"`
}

type DocumentAddressingFailure struct {
	Reason string `json:"reason" api:"enum=invalidTitle|parentUnavailable|planChanged|documentIDConflict|legacyPathUnsupported|pathAmbiguous|indexUnavailable|unsupportedTitleFormat|targetModeUnsupported|writeFailed"`
}

type DocumentPathsResult struct {
	value   *DocumentPathsData
	failure *DocumentAddressingFailure
}

func NewDocumentPathsResult(value DocumentPathsData) DocumentPathsResult {
	return DocumentPathsResult{value: &value}
}

func NewDocumentPathsFailure(value DocumentAddressingFailure) DocumentPathsResult {
	return DocumentPathsResult{failure: &value}
}

func (value DocumentPathsResult) MarshalJSON() ([]byte, error) {
	if value.value != nil {
		return json.Marshal(value.value)
	}
	if value.failure != nil {
		return json.Marshal(value.failure)
	}
	return nil, errors.New("document paths response is not set")
}

type ResolveDocPathResult struct {
	value   *ResolvedDocumentPathData
	failure *DocumentAddressingFailure
}

func NewResolveDocPathResult(value ResolvedDocumentPathData) ResolveDocPathResult {
	return ResolveDocPathResult{value: &value}
}

func NewResolveDocPathFailure(value DocumentAddressingFailure) ResolveDocPathResult {
	return ResolveDocPathResult{failure: &value}
}

func (value ResolveDocPathResult) MarshalJSON() ([]byte, error) {
	if value.value != nil {
		return json.Marshal(value.value)
	}
	if value.failure != nil {
		return json.Marshal(value.failure)
	}
	return nil, errors.New("document path resolution response is not set")
}

func documentAddressingSchema(b *schemaBuilder, t reflect.Type, input bool) (*Schema, error) {
	if t.Kind() == reflect.Pointer && (t.Elem() == reflect.TypeFor[NotebookConfPatch]() || t.Elem() == reflect.TypeFor[StructuredDocumentTarget]()) {
		value, err := documentAddressingSchema(b, t.Elem(), input)
		if err != nil {
			return nil, err
		}
		return nullable(value), nil
	}
	if t == reflect.TypeFor[CreateDocByParentRequest]() || t == reflect.TypeFor[NotebookConfPatch]() ||
		t == reflect.TypeFor[StructuredDocumentTarget]() {
		name := t.Name()
		if input {
			name += "Input"
		}
		if _, exists := b.definitions[name]; !exists {
			object := &Schema{Type: "object", Properties: map[string]*Schema{}, AdditionalProperties: false}
			b.definitions[name] = object
			if err := b.fields(object, t, input); err != nil {
				return nil, err
			}
		}
		return &Schema{Ref: "#/$defs/" + name}, nil
	}
	var valueType reflect.Type
	failureType := reflect.TypeFor[DocumentAddressingFailure]()
	switch t {
	case reflect.TypeFor[LegacyPathIDsResult]():
		valueType, failureType = reflect.TypeFor[[]string](), reflect.TypeFor[LegacyPathUnsupported]()
	case reflect.TypeFor[LegacyPathDocumentResult]():
		valueType, failureType = reflect.TypeFor[string](), reflect.TypeFor[LegacyPathUnsupported]()
	case reflect.TypeFor[FileTreeCreateSavePathResult]():
		valueType, failureType = reflect.TypeFor[FileTreeCreateSavePathData](), reflect.TypeFor[StructuredTemplateRequired]()
	case reflect.TypeFor[FileTreeSavePathResult]():
		valueType, failureType = reflect.TypeFor[FileTreeSavePathData](), reflect.TypeFor[StructuredTemplateRequired]()
	case reflect.TypeFor[DocumentCreateTarget]():
		valueType, failureType = reflect.TypeFor[LegacyDocumentTarget](), reflect.TypeFor[StructuredDocumentTarget]()
	case reflect.TypeFor[CreateDocByParentResult]():
		valueType, failureType = reflect.TypeFor[CreatedDocumentData](), reflect.TypeFor[DocumentCreateFailure]()
	case reflect.TypeFor[DocumentPathsResult]():
		valueType = reflect.TypeFor[DocumentPathsData]()
	case reflect.TypeFor[ResolveDocPathResult]():
		valueType = reflect.TypeFor[ResolvedDocumentPathData]()
	default:
		return nil, nil
	}
	name := t.Name()
	if _, exists := b.definitions[name]; !exists {
		result := &Schema{}
		b.definitions[name] = result
		for _, member := range []reflect.Type{valueType, failureType} {
			schema, err := b.schema(member, input)
			if err != nil {
				return nil, err
			}
			result.AnyOf = append(result.AnyOf, schema)
		}
	}
	return &Schema{Ref: "#/$defs/" + name}, nil
}
