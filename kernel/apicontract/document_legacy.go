package apicontract

import (
	"encoding/json"
	"errors"
)

type StructuredTemplateRequired struct {
	Reason string `json:"reason" api:"enum=structuredTemplateRequired"`
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
