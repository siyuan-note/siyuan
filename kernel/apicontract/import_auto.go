package apicontract

import "encoding/json"

type ImportAutoDocument struct {
	Type  string `json:"type" api:"const=\"document\""`
	Token string `json:"token,omitempty"`
}

type ImportAutoNotebook struct {
	Type     string    `json:"type" api:"const=\"notebook\""`
	Notebook *Notebook `json:"notebook"`
}

type ImportAutoNotebooks struct {
	Type      string      `json:"type" api:"const=\"notebooks\""`
	Notebooks []*Notebook `json:"notebooks"`
}

type ImportAutoData struct {
	document  *ImportAutoDocument
	notebook  *ImportAutoNotebook
	notebooks *ImportAutoNotebooks
}

func AutoImportedDocument(token string) ImportAutoData {
	return ImportAutoData{document: &ImportAutoDocument{Type: "document", Token: token}}
}
func AutoImportedNotebook(notebook *Notebook) ImportAutoData {
	return ImportAutoData{notebook: &ImportAutoNotebook{Type: "notebook", Notebook: notebook}}
}
func AutoImportedNotebooks(notebooks []*Notebook) ImportAutoData {
	return ImportAutoData{notebooks: &ImportAutoNotebooks{Type: "notebooks", Notebooks: notebooks}}
}
func (data ImportAutoData) MarshalJSON() ([]byte, error) {
	if data.document != nil {
		return json.Marshal(data.document)
	}
	if data.notebook != nil {
		return json.Marshal(data.notebook)
	}
	return json.Marshal(data.notebooks)
}
