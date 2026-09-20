package apicontract

type MigrateLegacyMindmapsRequest struct {
	ID       string `json:"id"`
	Notebook string `json:"notebook"`
}

type MigrateLegacyMindmapsData struct {
	Converted int            `json:"converted"`
	Blocks    []BlockDOMData `json:"blocks"`
}
