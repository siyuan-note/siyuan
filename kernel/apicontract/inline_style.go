package apicontract

type InlineStyleTheme struct {
	Color           string `json:"color,omitempty" api:"optional,nullable"`
	BackgroundColor string `json:"backgroundColor,omitempty" api:"optional,nullable"`
}

type InlineStyle struct {
	ID     string            `json:"id" api:"optional,nullable"`
	Name   string            `json:"name" api:"optional,nullable"`
	Hidden bool              `json:"hidden,omitempty" api:"optional,nullable"`
	Light  *InlineStyleTheme `json:"light" api:"optional,nullable"`
	Dark   *InlineStyleTheme `json:"dark" api:"optional,nullable"`
}

type InlineStyleBuiltinColor struct {
	Index int               `json:"index" api:"optional,nullable"`
	Light *InlineStyleTheme `json:"light" api:"optional,nullable"`
	Dark  *InlineStyleTheme `json:"dark" api:"optional,nullable"`
}

type InlineStyleBuiltinStyle struct {
	ID    string            `json:"id" api:"optional,nullable"`
	Light *InlineStyleTheme `json:"light" api:"optional,nullable"`
	Dark  *InlineStyleTheme `json:"dark" api:"optional,nullable"`
}

type InlineStyleBuiltinHidden struct {
	Color           []int    `json:"color" api:"optional,nullable"`
	BackgroundColor []int    `json:"backgroundColor" api:"optional,nullable"`
	Style1          []string `json:"style1" api:"optional,nullable"`
	AV              []int    `json:"av" api:"optional,nullable"`
}

type InlineStyleBuiltin struct {
	Colors []*InlineStyleBuiltinColor `json:"colors" api:"optional,nullable"`
	Styles []*InlineStyleBuiltinStyle `json:"styles" api:"optional,nullable"`
	Hidden *InlineStyleBuiltinHidden  `json:"hidden" api:"optional,nullable"`
}

type InlineStyleOrder struct {
	Color           []string `json:"color" api:"optional,nullable"`
	BackgroundColor []string `json:"backgroundColor" api:"optional,nullable"`
	Style1          []string `json:"style1" api:"optional,nullable"`
}

type InlineStyleAV struct {
	Colors []*AttributeViewCustomColor `json:"colors" api:"optional,nullable"`
	Order  []string                    `json:"order" api:"optional,nullable"`
}

type WorkspaceAVBuiltinColorUpdate struct {
	Index      int               `json:"index" api:"optional,nullable"`
	Customized bool              `json:"customized" api:"optional,nullable"`
	Light      *InlineStyleTheme `json:"light" api:"optional,nullable"`
	Dark       *InlineStyleTheme `json:"dark" api:"optional,nullable"`
	Hidden     bool              `json:"hidden" api:"optional,nullable"`
}

type WorkspaceAVPaletteUpdate struct {
	Colors        []*AttributeViewCustomColor      `json:"colors" api:"optional,nullable"`
	Order         []string                         `json:"order" api:"optional,nullable"`
	BuiltinColors []*WorkspaceAVBuiltinColorUpdate `json:"builtinColors" api:"optional,nullable"`
}

type InlineStyles struct {
	Version int                 `json:"version" api:"optional,nullable"`
	Styles  []*InlineStyle      `json:"styles" api:"optional,nullable"`
	Builtin *InlineStyleBuiltin `json:"builtin" api:"optional,nullable"`
	Order   *InlineStyleOrder   `json:"order" api:"optional,nullable"`
	AV      *InlineStyleAV      `json:"av" api:"optional,nullable"`
}

type AttributeViewColorTheme struct {
	Color           string `json:"color" api:"optional,nullable"`
	BackgroundColor string `json:"backgroundColor" api:"optional,nullable"`
}

type AttributeViewColor struct {
	Light AttributeViewColorTheme `json:"light" api:"optional,nullable"`
	Dark  AttributeViewColorTheme `json:"dark" api:"optional,nullable"`
}

type AttributeViewCustomColor struct {
	Index  int  `json:"index" api:"optional,nullable"`
	Hidden bool `json:"hidden,omitempty" api:"optional,nullable"`
	AttributeViewColor
}
