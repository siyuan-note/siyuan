// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"bytes"
	"encoding/json"
	"errors"
)

type DocumentTargetRevision struct {
	Notebook string `json:"notebook"`
	Purpose  string `json:"purpose" api:"enum=document|reference|dailyNote"`
	Revision string `json:"revision"`
}

type GetDocCreateTargetRequest struct {
	Notebook string `json:"notebook"`
	Purpose  string `json:"purpose" api:"enum=document|reference|dailyNote"`
}

type LegacyDocumentTarget struct {
	Version  int    `json:"version" api:"const=1"`
	Notebook string `json:"notebook"`
	Path     string `json:"path"`
}

type DocumentTargetAnchor struct {
	Kind string `json:"kind" api:"enum=notebookRoot|context|document"`
	ID   string `json:"id,omitempty" api:"optional"`
}

type StructuredDocumentTarget struct {
	Version         int                  `json:"version" api:"const=2"`
	Notebook        string               `json:"notebook"`
	Anchor          DocumentTargetAnchor `json:"anchor"`
	Up              int                  `json:"up"`
	Parents         []string             `json:"parents" api:"nonnullable"`
	Title           string               `json:"title"`
	OnMissingParent string               `json:"onMissingParent" api:"enum=create|error"`
}

type DocumentCreateTarget struct {
	legacy     *LegacyDocumentTarget
	structured *StructuredDocumentTarget
}

func (target *StructuredDocumentTarget) UnmarshalJSON(data []byte) error {
	type plain StructuredDocumentTarget
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
	for _, name := range []string{"version", "notebook", "anchor", "up", "parents", "title", "onMissingParent"} {
		if value, exists := fields[name]; !exists || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return errors.New("missing or null document target field: " + name)
		}
	}
	*target = StructuredDocumentTarget(next)
	return nil
}

func LegacyCreateTarget(notebook, path string) DocumentCreateTarget {
	return DocumentCreateTarget{legacy: &LegacyDocumentTarget{Version: 1, Notebook: notebook, Path: path}}
}

func StructuredCreateTarget(value StructuredDocumentTarget) DocumentCreateTarget {
	return DocumentCreateTarget{structured: &value}
}

func (target DocumentCreateTarget) MarshalJSON() ([]byte, error) {
	if target.legacy != nil {
		return json.Marshal(target.legacy)
	}
	if target.structured != nil {
		return json.Marshal(target.structured)
	}
	return nil, errors.New("document target is not set")
}

type DocumentCreateTargetData struct {
	Target                DocumentCreateTarget `json:"target"`
	DocCreateTemplatePath string               `json:"docCreateTemplatePath"`
	Revision              string               `json:"revision"`
}

type PlanDocCreateRequest struct {
	Notebook  string  `json:"notebook"`
	Purpose   string  `json:"purpose" api:"enum=document|reference|dailyNote"`
	ContextID *string `json:"contextID,omitempty" api:"optional,nullable"`
	Title     *string `json:"title,omitempty" api:"optional,nonnullable"`
	ID        string  `json:"id"`
	Placement string  `json:"placement,omitempty" api:"optional,enum=configured|child"`
	Reuse     bool    `json:"reuse,omitempty" api:"optional"`
	Date      *string `json:"date,omitempty" api:"optional,nonnullable"`
}

type DocumentCreatePlan struct {
	Notebook   string                     `json:"notebook"`
	Title      string                     `json:"title"`
	ExistingID string                     `json:"existingID,omitempty"`
	Steps      []CreateDocByParentRequest `json:"steps" api:"nonnullable"`
}
