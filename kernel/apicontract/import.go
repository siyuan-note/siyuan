package apicontract

import (
	"encoding/json"
	"io"
	"mime/multipart"
)

type ImportTokenRequest struct {
	Token string `json:"token" api:"trim"`
}

type ImportDataRequest struct {
	File *multipart.FileHeader `json:"file" api:"optional"`
}

type ImportSYRequest struct {
	File     *multipart.FileHeader `json:"file" api:"optional"`
	Notebook string                `json:"notebook" api:"optional"`
	ToPath   *string               `json:"toPath" api:"optional,nonnullable"`
}

func (request ImportSYRequest) TargetPath() string {
	if request.ToPath == nil {
		return "/"
	}
	return *request.ToPath
}

type ImportZipMarkdownRequest struct {
	File     *multipart.FileHeader `json:"file" api:"optional"`
	Notebook *string               `json:"notebook" api:"optional,nonnullable"`
	ToPath   *string               `json:"toPath" api:"optional,nonnullable"`
	SkipRoot string                `json:"skipRoot" api:"optional"`
}

type ContinueImportSYRequest struct {
	Token    string `json:"token" api:"trim"`
	Notebook string `json:"notebook" api:"trim"`
}

type ImportDocumentData struct {
	Type string `json:"type" api:"const=\"document\""`
}

type ImportMarkdownRequest struct {
	Notebook  string `json:"notebook"`
	LocalPath string `json:"localPath"`
	ToPath    string `json:"toPath"`
	SkipRoot  bool   `json:"skipRoot" api:"optional,nullable"`
}

func init() {
	ImportStdMd.decodeRequest = func(reader io.Reader) (request ImportMarkdownRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/import/importStdMd")
		if err != nil {
			return request, err
		}
		if request.Notebook, err = legacyField[string](fields, "notebook", "String", true); err != nil {
			return request, err
		}
		if request.LocalPath, err = legacyField[string](fields, "localPath", "String", true); err != nil {
			return request, err
		}
		if request.ToPath, err = legacyField[string](fields, "toPath", "String", true); err != nil {
			return request, err
		}
		_ = json.Unmarshal(fields["skipRoot"], &request.SkipRoot)
		return request, nil
	}
}
