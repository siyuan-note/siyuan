package apicontract

import (
	"encoding/json"
	"fmt"
	"io"
)

type SaveTemplateRequest struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Overwrite    bool   `json:"overwrite"`
	DatabaseMode string `json:"databaseMode" api:"optional"`
	Directory    string `json:"directory" api:"optional"`
}

func init() {
	DocSaveAsTemplate.decodeRequest = func(reader io.Reader) (request SaveTemplateRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/template/docSaveAsTemplate")
		if err != nil {
			return request, err
		}
		if request.ID, err = legacyField[string](fields, "id", "String", true); err != nil {
			return request, err
		}
		if request.Name, err = legacyField[string](fields, "name", "String", true); err != nil {
			return request, err
		}
		if request.Overwrite, err = legacyField[bool](fields, "overwrite", "Boolean", true); err != nil {
			return request, err
		}
		request.DatabaseMode = "copy"
		if raw, exists := fields["databaseMode"]; exists {
			if string(raw) == "null" || json.Unmarshal(raw, &request.DatabaseMode) != nil {
				request.DatabaseMode = "invalid"
			}
		}
		if raw, exists := fields["directory"]; exists {
			if string(raw) == "null" || json.Unmarshal(raw, &request.Directory) != nil {
				return request, fmt.Errorf("Invalid template directory")
			}
		}
		return
	}
}

type RenderSprigRequest struct {
	Template string `json:"template"`
}

type TemplateDocumentRequest struct {
	ID string `json:"id"`
}

type TemplateDocumentInfo struct {
	Name        string `json:"name"`
	Directory   string `json:"directory"`
	HasDatabase bool   `json:"hasDatabase"`
}
