package apicontract

type NotebookIDRequest struct {
	Notebook string `json:"notebook" api:"trim"`
}

type CloseNotebookRequest struct {
	Notebook string `json:"notebook"`
}

type SetNotebookIconRequest struct {
	NotebookIDRequest
	Icon string `json:"icon"`
}

type RenameNotebookRequest struct {
	NotebookIDRequest
	Name string `json:"name"`
}

type CreateNotebookRequest struct {
	Name string `json:"name"`
}

type CreateNotebookData struct {
	Notebook *Notebook `json:"notebook"`
}

type ChangeSortNotebookRequest struct {
	Notebooks []string `json:"notebooks"`
}
