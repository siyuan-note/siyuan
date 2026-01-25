function Span(el)
  -- 辅助：解析颜色字符串为 6 位大写十六进制（不带 #），支持颜色名、#hex、#rgb、rgb()/rgba()
  local function parse_color(s)
    if not s then return nil end
    s = s:gsub("%s+", "")
    local lower = s:lower()

    local named = {
      red = "FF0000", blue = "0000FF", green = "008000",
      yellow = "FFFF00", orange = "FFA500", purple = "800080",
      black = "000000", white = "FFFFFF", gray = "808080", grey = "808080"
    }
    if named[lower] then return named[lower] end

    -- 6-digit hex
    local hex6 = s:match("#?(%x%x%x%x%x%x)")
    if hex6 then return hex6:upper() end

    -- 3-digit hex (#rgb -> rrggbb)
    local hex3 = s:match("#?(%x%x%x)")
    if hex3 then
      local r = hex3:sub(1,1)
      local g = hex3:sub(2,2)
      local b = hex3:sub(3,3)
      return (r..r..g..g..b..b):upper()
    end

    -- rgb(r,g,b) with integer components
    local r,g,b = s:match("rgb%((%d+),(%d+),(%d+)%)")
    if r and g and b then
      local function h(n)
        local nv = tonumber(n) or 0
        if nv < 0 then nv = 0 end
        if nv > 255 then nv = 255 end
        return string.format("%02X", nv)
      end
      return h(r)..h(g)..h(b)
    end

    -- rgba(r,g,b,a) -> 与白（或背景）合成，返回合成后的 hex
    local ra,ga,ba,aa = s:match("rgba%((%d+),(%d+),(%d+),([%d%.]+)%)")
    if ra and ga and ba and aa then
      local R = tonumber(ra) or 0
      local G = tonumber(ga) or 0
      local B = tonumber(ba) or 0
      local A = tonumber(aa) or 1
      if A < 0 then A = 0 end
      if A > 1 then A = 1 end
      local function comp(c)
        local v = math.floor((A * c + (1 - A) * 255) + 0.5)
        if v < 0 then v = 0 end
        if v > 255 then v = 255 end
        return string.format("%02X", v)
      end
      return comp(R)..comp(G)..comp(B)
    end

    return nil
  end

  if el.attributes.style then
    local style = el.attributes.style

    local props = {}
    for k, v in style:gmatch("([%w%-]+)%s*:%s*([^;]+)") do
      local key = string.lower(k:gsub("^%s*(.-)%s*$", "%1"))
      local val = v:gsub("^%s*(.-)%s*$", "%1")
      props[key] = val
    end

    local text_color_raw = props["color"]
    local bg_color_raw = props["background-color"] or props["background"]

    local text_hex = parse_color(text_color_raw)
    local bg_hex = parse_color(bg_color_raw)

    if text_hex or bg_hex then
      -- 将 Span 的内容 stringify 为纯文本并做 XML 转义
      local text = pandoc.utils.stringify(el)

      local function xml_escape(s)
        s = s:gsub("&", "&amp;")
        s = s:gsub("<", "&lt;")
        s = s:gsub(">", "&gt;")
        s = s:gsub('\r\n', '\n')
        s = s:gsub('\r', '\n')
        s = s:gsub('"', "&quot;")
        s = s:gsub("'", "&apos;")
        return s
      end

      local need_preserve = text:match("^%s") or text:match("%s$") or text:match("  ")
      local t_attr = need_preserve and ' xml:space="preserve"' or ''

      local run = '<w:r><w:rPr>'
      if text_hex then
        run = run .. '<w:color w:val="' .. text_hex .. '"/>'
      end
      if bg_hex then
        run = run .. '<w:shd w:val="clear" w:color="auto" w:fill="' .. bg_hex .. '"/>'
      end
      run = run .. '</w:rPr><w:t' .. t_attr .. '>' .. xml_escape(text) .. '</w:t></w:r>'

      return { pandoc.RawInline('openxml', run) }
    end
  end

  return el
end
