package apicontract

import (
	"encoding/json"
	"errors"
)

type StructuredTemplateRequired struct {
	Reason string `json:"reason" api:"enum=structuredTemplateRequired"`
}

type LegacyPathUnsupported struct {
	Reason string `json:"reason" api:"enum=legacyPathUnsupported"`
}

type LegacyPathIDsResult struct {
	value   []string
	failure *LegacyPathUnsupported
}

func NewLegacyPathIDs(value []string) LegacyPathIDsResult { return LegacyPathIDsResult{value: value} }
func UnsupportedLegacyPathIDs() LegacyPathIDsResult {
	return LegacyPathIDsResult{failure: &LegacyPathUnsupported{Reason: "legacyPathUnsupported"}}
}
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

func NewLegacyPathDocument(value string) LegacyPathDocumentResult {
	return LegacyPathDocumentResult{value: value}
}
func UnsupportedLegacyPathDocument() LegacyPathDocumentResult {
	return LegacyPathDocumentResult{failure: &LegacyPathUnsupported{Reason: "legacyPathUnsupported"}}
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
