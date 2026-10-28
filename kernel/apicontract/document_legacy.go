// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"encoding/json"
	"errors"
)

type StructuredTemplateRequired struct {
	Reason string `json:"reason" api:"enum=structuredTemplateRequired"`
}

type LegacyPathUnsupported struct {
	// The historical type name is retained for plugin source compatibility.
	Reason         string   `json:"reason" api:"enum=legacyPathUnsupported|pathAmbiguous|indexUnavailable"`
	CleanIDs       []string `json:"cleanIDs,omitempty"`
	UnsupportedIDs []string `json:"unsupportedIDs,omitempty"`
}

type LegacyPathIDsResult struct {
	value   []string
	failure *LegacyPathUnsupported
}

func NewLegacyPathIDsFailure(value LegacyPathUnsupported) LegacyPathIDsResult {
	return LegacyPathIDsResult{failure: &value}
}
func NewLegacyPathIDs(value []string) LegacyPathIDsResult { return LegacyPathIDsResult{value: value} }
func (result LegacyPathIDsResult) MarshalJSON() ([]byte, error) {
	if result.failure != nil {
		return json.Marshal(result.failure)
	}
	return json.Marshal(result.value)
}

type LegacyPathDocumentResult struct {
	value   string
	failure *LegacyPathUnsupported
}

func NewLegacyPathDocumentFailure(value LegacyPathUnsupported) LegacyPathDocumentResult {
	return LegacyPathDocumentResult{failure: &value}
}
func NewLegacyPathDocument(value string) LegacyPathDocumentResult {
	return LegacyPathDocumentResult{value: value}
}
func (result LegacyPathDocumentResult) MarshalJSON() ([]byte, error) {
	if result.failure != nil {
		return json.Marshal(result.failure)
	}
	return json.Marshal(result.value)
}

type FileTreeCreateSavePathResult struct {
	value   *FileTreeCreateSavePathData
	failure *StructuredTemplateRequired
}

func NewFileTreeCreateSavePathResult(value FileTreeCreateSavePathData) FileTreeCreateSavePathResult {
	return FileTreeCreateSavePathResult{value: &value}
}
func NewFileTreeCreateSavePathFailure() FileTreeCreateSavePathResult {
	return FileTreeCreateSavePathResult{failure: &StructuredTemplateRequired{Reason: "structuredTemplateRequired"}}
}
func (result FileTreeCreateSavePathResult) MarshalJSON() ([]byte, error) {
	if result.value != nil {
		return json.Marshal(result.value)
	}
	if result.failure != nil {
		return json.Marshal(result.failure)
	}
	return nil, errors.New("document save path result is not set")
}

type FileTreeSavePathResult struct {
	value   *FileTreeSavePathData
	failure *StructuredTemplateRequired
}

func NewFileTreeSavePathResult(value FileTreeSavePathData) FileTreeSavePathResult {
	return FileTreeSavePathResult{value: &value}
}
func NewFileTreeSavePathFailure() FileTreeSavePathResult {
	return FileTreeSavePathResult{failure: &StructuredTemplateRequired{Reason: "structuredTemplateRequired"}}
}
func (result FileTreeSavePathResult) MarshalJSON() ([]byte, error) {
	if result.value != nil {
		return json.Marshal(result.value)
	}
	if result.failure != nil {
		return json.Marshal(result.failure)
	}
	return nil, errors.New("reference save path result is not set")
}
