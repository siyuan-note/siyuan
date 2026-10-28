// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import "encoding/json"

type ImportedNotebook struct {
	Notebook *Notebook `json:"notebook"`
}

type ImportedNotebooks struct {
	Notebooks []*Notebook `json:"notebooks"`
}

type ImportNotebookData struct {
	notebook  *ImportedNotebook
	notebooks *ImportedNotebooks
}

func ImportedNotebookResult(notebook *Notebook) ImportNotebookData {
	return ImportNotebookData{notebook: &ImportedNotebook{Notebook: notebook}}
}

func ImportedNotebooksResult(notebooks []*Notebook) ImportNotebookData {
	return ImportNotebookData{notebooks: &ImportedNotebooks{Notebooks: notebooks}}
}

func (data ImportNotebookData) MarshalJSON() ([]byte, error) {
	if data.notebook != nil {
		return json.Marshal(data.notebook)
	}
	return json.Marshal(data.notebooks)
}
