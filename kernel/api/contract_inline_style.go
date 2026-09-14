package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func inlineStyleThemeContract(value *model.InlineStyleTheme) *apicontract.InlineStyleTheme {
	if value == nil {
		return nil
	}
	result := &apicontract.InlineStyleTheme{}
	result.Color = value.Color
	result.BackgroundColor = value.BackgroundColor
	return result
}

func inlineStyleContract(value *model.InlineStyle) *apicontract.InlineStyle {
	if value == nil {
		return nil
	}
	result := &apicontract.InlineStyle{}
	result.ID = value.ID
	result.Name = value.Name
	result.Hidden = value.Hidden
	result.Light = inlineStyleThemeContract(value.Light)
	result.Dark = inlineStyleThemeContract(value.Dark)
	return result
}

func inlineStyleBuiltinColorContract(value *model.InlineStyleBuiltinColor) *apicontract.InlineStyleBuiltinColor {
	if value == nil {
		return nil
	}
	result := &apicontract.InlineStyleBuiltinColor{}
	result.Index = value.Index
	result.Light = inlineStyleThemeContract(value.Light)
	result.Dark = inlineStyleThemeContract(value.Dark)
	return result
}

func inlineStyleBuiltinStyleContract(value *model.InlineStyleBuiltinStyle) *apicontract.InlineStyleBuiltinStyle {
	if value == nil {
		return nil
	}
	result := &apicontract.InlineStyleBuiltinStyle{}
	result.ID = value.ID
	result.Light = inlineStyleThemeContract(value.Light)
	result.Dark = inlineStyleThemeContract(value.Dark)
	return result
}

func inlineStyleBuiltinHiddenContract(value *model.InlineStyleBuiltinHidden) *apicontract.InlineStyleBuiltinHidden {
	if value == nil {
		return nil
	}
	result := &apicontract.InlineStyleBuiltinHidden{}
	result.Color = value.Color
	result.BackgroundColor = value.BackgroundColor
	result.Style1 = value.Style1
	result.AV = value.AV
	return result
}

func inlineStyleBuiltinContract(value *model.InlineStyleBuiltin) *apicontract.InlineStyleBuiltin {
	if value == nil {
		return nil
	}
	result := &apicontract.InlineStyleBuiltin{}
	if value.Colors != nil {
		result.Colors = make([]*apicontract.InlineStyleBuiltinColor, len(value.Colors))
		for i, entry := range value.Colors {
			result.Colors[i] = inlineStyleBuiltinColorContract(entry)
		}
	}
	if value.Styles != nil {
		result.Styles = make([]*apicontract.InlineStyleBuiltinStyle, len(value.Styles))
		for i, entry := range value.Styles {
			result.Styles[i] = inlineStyleBuiltinStyleContract(entry)
		}
	}
	result.Hidden = inlineStyleBuiltinHiddenContract(value.Hidden)
	return result
}

func inlineStyleOrderContract(value *model.InlineStyleOrder) *apicontract.InlineStyleOrder {
	if value == nil {
		return nil
	}
	result := &apicontract.InlineStyleOrder{}
	result.Color = value.Color
	result.BackgroundColor = value.BackgroundColor
	result.Style1 = value.Style1
	return result
}

func inlineStyleAVContract(value *model.InlineStyleAV) *apicontract.InlineStyleAV {
	if value == nil {
		return nil
	}
	result := &apicontract.InlineStyleAV{}
	if value.Colors != nil {
		result.Colors = make([]*apicontract.AttributeViewCustomColor, len(value.Colors))
		for i, entry := range value.Colors {
			result.Colors[i] = attributeViewCustomColorContract(entry)
		}
	}
	result.Order = value.Order
	return result
}

func workspaceAVBuiltinColorUpdateContract(value *model.WorkspaceAVBuiltinColorUpdate) *apicontract.WorkspaceAVBuiltinColorUpdate {
	if value == nil {
		return nil
	}
	result := &apicontract.WorkspaceAVBuiltinColorUpdate{}
	result.Index = value.Index
	result.Customized = value.Customized
	result.Light = inlineStyleThemeContract(value.Light)
	result.Dark = inlineStyleThemeContract(value.Dark)
	result.Hidden = value.Hidden
	return result
}

func workspaceAVPaletteUpdateContract(value *model.WorkspaceAVPaletteUpdate) *apicontract.WorkspaceAVPaletteUpdate {
	if value == nil {
		return nil
	}
	result := &apicontract.WorkspaceAVPaletteUpdate{}
	if value.Colors != nil {
		result.Colors = make([]*apicontract.AttributeViewCustomColor, len(value.Colors))
		for i, entry := range value.Colors {
			result.Colors[i] = attributeViewCustomColorContract(entry)
		}
	}
	result.Order = value.Order
	if value.BuiltinColors != nil {
		result.BuiltinColors = make([]*apicontract.WorkspaceAVBuiltinColorUpdate, len(value.BuiltinColors))
		for i, entry := range value.BuiltinColors {
			result.BuiltinColors[i] = workspaceAVBuiltinColorUpdateContract(entry)
		}
	}
	return result
}

func inlineStylesContract(value *model.InlineStyles) *apicontract.InlineStyles {
	if value == nil {
		return nil
	}
	result := &apicontract.InlineStyles{}
	result.Version = value.Version
	if value.Styles != nil {
		result.Styles = make([]*apicontract.InlineStyle, len(value.Styles))
		for i, entry := range value.Styles {
			result.Styles[i] = inlineStyleContract(entry)
		}
	}
	result.Builtin = inlineStyleBuiltinContract(value.Builtin)
	result.Order = inlineStyleOrderContract(value.Order)
	result.AV = inlineStyleAVContract(value.AV)
	return result
}

func attributeViewColorThemeContract(value *av.AttributeViewColorTheme) *apicontract.AttributeViewColorTheme {
	if value == nil {
		return nil
	}
	result := &apicontract.AttributeViewColorTheme{}
	result.Color = value.Color
	result.BackgroundColor = value.BackgroundColor
	return result
}

func attributeViewColorContract(value *av.AttributeViewColor) *apicontract.AttributeViewColor {
	if value == nil {
		return nil
	}
	result := &apicontract.AttributeViewColor{}
	result.Light = *attributeViewColorThemeContract(&value.Light)
	result.Dark = *attributeViewColorThemeContract(&value.Dark)
	return result
}

func attributeViewCustomColorContract(value *av.AttributeViewCustomColor) *apicontract.AttributeViewCustomColor {
	if value == nil {
		return nil
	}
	result := &apicontract.AttributeViewCustomColor{}
	result.Index = value.Index
	result.Hidden = value.Hidden
	result.AttributeViewColor = *attributeViewColorContract(&value.AttributeViewColor)
	return result
}

func inlineStyleThemeModel(value *apicontract.InlineStyleTheme) *model.InlineStyleTheme {
	if value == nil {
		return nil
	}
	result := &model.InlineStyleTheme{}
	result.Color = value.Color
	result.BackgroundColor = value.BackgroundColor
	return result
}

func inlineStyleModel(value *apicontract.InlineStyle) *model.InlineStyle {
	if value == nil {
		return nil
	}
	result := &model.InlineStyle{}
	result.ID = value.ID
	result.Name = value.Name
	result.Hidden = value.Hidden
	result.Light = inlineStyleThemeModel(value.Light)
	result.Dark = inlineStyleThemeModel(value.Dark)
	return result
}

func inlineStyleBuiltinColorModel(value *apicontract.InlineStyleBuiltinColor) *model.InlineStyleBuiltinColor {
	if value == nil {
		return nil
	}
	result := &model.InlineStyleBuiltinColor{}
	result.Index = value.Index
	result.Light = inlineStyleThemeModel(value.Light)
	result.Dark = inlineStyleThemeModel(value.Dark)
	return result
}

func inlineStyleBuiltinStyleModel(value *apicontract.InlineStyleBuiltinStyle) *model.InlineStyleBuiltinStyle {
	if value == nil {
		return nil
	}
	result := &model.InlineStyleBuiltinStyle{}
	result.ID = value.ID
	result.Light = inlineStyleThemeModel(value.Light)
	result.Dark = inlineStyleThemeModel(value.Dark)
	return result
}

func inlineStyleBuiltinHiddenModel(value *apicontract.InlineStyleBuiltinHidden) *model.InlineStyleBuiltinHidden {
	if value == nil {
		return nil
	}
	result := &model.InlineStyleBuiltinHidden{}
	result.Color = value.Color
	result.BackgroundColor = value.BackgroundColor
	result.Style1 = value.Style1
	result.AV = value.AV
	return result
}

func inlineStyleBuiltinModel(value *apicontract.InlineStyleBuiltin) *model.InlineStyleBuiltin {
	if value == nil {
		return nil
	}
	result := &model.InlineStyleBuiltin{}
	if value.Colors != nil {
		result.Colors = make([]*model.InlineStyleBuiltinColor, len(value.Colors))
		for i, entry := range value.Colors {
			result.Colors[i] = inlineStyleBuiltinColorModel(entry)
		}
	}
	if value.Styles != nil {
		result.Styles = make([]*model.InlineStyleBuiltinStyle, len(value.Styles))
		for i, entry := range value.Styles {
			result.Styles[i] = inlineStyleBuiltinStyleModel(entry)
		}
	}
	result.Hidden = inlineStyleBuiltinHiddenModel(value.Hidden)
	return result
}

func inlineStyleOrderModel(value *apicontract.InlineStyleOrder) *model.InlineStyleOrder {
	if value == nil {
		return nil
	}
	result := &model.InlineStyleOrder{}
	result.Color = value.Color
	result.BackgroundColor = value.BackgroundColor
	result.Style1 = value.Style1
	return result
}

func inlineStyleAVModel(value *apicontract.InlineStyleAV) *model.InlineStyleAV {
	if value == nil {
		return nil
	}
	result := &model.InlineStyleAV{}
	if value.Colors != nil {
		result.Colors = make([]*av.AttributeViewCustomColor, len(value.Colors))
		for i, entry := range value.Colors {
			result.Colors[i] = attributeViewCustomColorModel(entry)
		}
	}
	result.Order = value.Order
	return result
}

func workspaceAVBuiltinColorUpdateModel(value *apicontract.WorkspaceAVBuiltinColorUpdate) *model.WorkspaceAVBuiltinColorUpdate {
	if value == nil {
		return nil
	}
	result := &model.WorkspaceAVBuiltinColorUpdate{}
	result.Index = value.Index
	result.Customized = value.Customized
	result.Light = inlineStyleThemeModel(value.Light)
	result.Dark = inlineStyleThemeModel(value.Dark)
	result.Hidden = value.Hidden
	return result
}

func workspaceAVPaletteUpdateModel(value *apicontract.WorkspaceAVPaletteUpdate) *model.WorkspaceAVPaletteUpdate {
	if value == nil {
		return nil
	}
	result := &model.WorkspaceAVPaletteUpdate{}
	if value.Colors != nil {
		result.Colors = make([]*av.AttributeViewCustomColor, len(value.Colors))
		for i, entry := range value.Colors {
			result.Colors[i] = attributeViewCustomColorModel(entry)
		}
	}
	result.Order = value.Order
	if value.BuiltinColors != nil {
		result.BuiltinColors = make([]*model.WorkspaceAVBuiltinColorUpdate, len(value.BuiltinColors))
		for i, entry := range value.BuiltinColors {
			result.BuiltinColors[i] = workspaceAVBuiltinColorUpdateModel(entry)
		}
	}
	return result
}

func inlineStylesModel(value *apicontract.InlineStyles) *model.InlineStyles {
	if value == nil {
		return nil
	}
	result := &model.InlineStyles{}
	result.Version = value.Version
	if value.Styles != nil {
		result.Styles = make([]*model.InlineStyle, len(value.Styles))
		for i, entry := range value.Styles {
			result.Styles[i] = inlineStyleModel(entry)
		}
	}
	result.Builtin = inlineStyleBuiltinModel(value.Builtin)
	result.Order = inlineStyleOrderModel(value.Order)
	result.AV = inlineStyleAVModel(value.AV)
	return result
}

func attributeViewColorThemeModel(value *apicontract.AttributeViewColorTheme) *av.AttributeViewColorTheme {
	if value == nil {
		return nil
	}
	result := &av.AttributeViewColorTheme{}
	result.Color = value.Color
	result.BackgroundColor = value.BackgroundColor
	return result
}

func attributeViewColorModel(value *apicontract.AttributeViewColor) *av.AttributeViewColor {
	if value == nil {
		return nil
	}
	result := &av.AttributeViewColor{}
	result.Light = *attributeViewColorThemeModel(&value.Light)
	result.Dark = *attributeViewColorThemeModel(&value.Dark)
	return result
}

func attributeViewCustomColorModel(value *apicontract.AttributeViewCustomColor) *av.AttributeViewCustomColor {
	if value == nil {
		return nil
	}
	result := &av.AttributeViewCustomColor{}
	result.Index = value.Index
	result.Hidden = value.Hidden
	result.AttributeViewColor = *attributeViewColorModel(&value.AttributeViewColor)
	return result
}
