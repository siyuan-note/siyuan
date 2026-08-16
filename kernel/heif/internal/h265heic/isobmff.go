package heic

import (
	"errors"
	"io"
	"slices"
)

const (
	maxContainerBytes = 32 << 20
	maxMetadataBytes  = 16 << 20
	maxItems          = 4096
	maxProperties     = 4096
	maxItemExtents    = 16384
	maxItemReferences = 16384
	maxItemProperties = 16384
	maxItemDataBytes  = 32 << 20
	maxParameterSets  = 64
	maxParameterBytes = 1 << 20
	maxNALUnits       = 65536
	maxNALBytes       = 32 << 20
	maxMetadataBoxes  = 65536
	maxTopLevelBoxes  = 4096
)

// ErrInvalid is returned when a file is not a HEIF, or is malformed past the
// point where anything can be decoded from it.
var ErrInvalid = errors.New("heic: invalid file")

type reader struct {
	b   []byte
	i   int
	err bool
}

func (r *reader) remaining() int {
	if r.err {
		return 0
	}

	return len(r.b) - r.i
}

func (r *reader) fail() {
	r.err = true
	r.i = len(r.b)
}

func (r *reader) bytes(n int) []byte {
	if n < 0 || r.remaining() < n {
		r.fail()

		return nil
	}
	v := r.b[r.i : r.i+n]
	r.i += n

	return v
}

func (r *reader) skip(n int) {
	r.bytes(n)
}

func (r *reader) u8() uint8 {
	b := r.bytes(1)
	if b == nil {
		return 0
	}

	return b[0]
}

func (r *reader) uint(n int) uint64 {
	b := r.bytes(n)
	var v uint64
	for _, c := range b {
		v = v<<8 | uint64(c)
	}

	return v
}

func (r *reader) u16() uint16 { return uint16(r.uint(2)) }
func (r *reader) u32() uint32 { return uint32(r.uint(4)) }
func (r *reader) u64() uint64 { return r.uint(8) }

// boxNames interns the four-character codes the parser compares against, so
// reading a header allocates nothing. An unknown box is skipped on its size
// alone, and its name never leaves this function.
var boxNames = func() map[[4]byte]string {
	m := make(map[[4]byte]string)

	for _, s := range []string{
		"ftyp", "meta", "hdlr", "pitm", "iinf", "infe", "iloc", "iref", "iprp",
		"ipco", "ipma", "hvcC", "ispe", "colr", "pixi", "irot", "imir", "clap",
		"auxC", "idat", "mdat", "moov", "trak", "mdia", "minf", "stbl", "stsd",
		"stts", "stsc", "stsz", "stco", "co64", "tkhd", "mvhd", "hvc1", "hvc2",
		"grid", "Exif", "mime", "iprd", "free", "skip", "url ", "dinf", "dref",
	} {
		m[[4]byte([]byte(s))] = s
	}

	return m
}()

func (r *reader) str4() string {
	b := r.bytes(4)
	if b == nil {
		return ""
	}

	if s, ok := boxNames[[4]byte(b)]; ok {
		return s
	}

	return string(b)
}

func (r *reader) cstr() string {
	for j := r.i; j < len(r.b); j++ {
		if r.b[j] == 0 {
			s := string(r.b[r.i:j])
			r.i = j + 1

			return s
		}
	}
	r.fail()

	return ""
}

func (r *reader) fullBox() (uint8, uint32) {
	v := r.u32()

	return uint8(v >> 24), v & 0xffffff
}

// eachBox calls fn for every box in b.
func eachBox(b []byte, fn func(typ string, payload []byte) error) error {
	r := &reader{b: b}
	count := 0

	for r.remaining() >= 8 {
		count++
		if count > maxMetadataBoxes {
			return ErrUnsupported
		}
		start := r.i
		size := uint64(r.u32())
		typ := r.str4()
		hdr := 8

		switch size {
		case 1:
			size = r.u64()
			hdr = 16
		case 0:
			size = uint64(len(b) - start)
		}
		if r.err || size < uint64(hdr) || size > uint64(len(b)-start) {
			return ErrInvalid
		}

		payload := b[start+hdr : start+int(size)]
		if typ == "uuid" {
			r.i = start + int(size)

			continue
		}
		if err := fn(typ, payload); err != nil {
			return err
		}
		r.i = start + int(size)
	}

	if r.err {
		return ErrInvalid
	}

	return nil
}

type extent struct {
	off, len uint64
}

type item struct {
	id          uint32
	typ         string
	contentType string
	extents     []extent

	method     uint8
	baseOffset uint64

	props []itemProp

	unsupported bool
}

type itemProp struct {
	idx       int
	essential bool
}

type itemRef struct {
	typ  string
	from uint32
	to   []uint32
}

type property struct {
	typ string

	w, h  uint32
	hvcC  *hevcConfig
	pixi  []uint8
	auxC  string
	angle uint8
	axis  uint8
	clap  [8]uint32
	colr  *colorInfo
}

// hevcConfig is the HEVCDecoderConfigurationRecord of ISO/IEC 14496-15. The
// parameter sets travel in it rather than in the item data.
type hevcConfig struct {
	chromaFormat   uint8
	bitDepthLuma   uint8
	bitDepthChroma uint8
	lengthSize     int
	paramSets      [][]byte
}

type colorInfo struct {
	icc       []byte
	primaries uint16
	transfer  uint16
	matrix    uint16
	fullRange bool
	hasNCLX   bool
}

type metaBox struct {
	primary uint32
	items   map[uint32]*item
	order   []uint32
	props   []property
	refs    []itemRef
	idat    []byte

	extentCount    int
	referenceCount int
	propertyCount  int
}

// source is the file, addressed by range. b carries it when it is buffered,
// and r reads it a range at a time when it is not.
type source struct {
	b    []byte
	r    io.ReaderAt
	size uint64
}

func memSource(b []byte) *source {
	return &source{b: b, size: uint64(len(b))}
}

// at returns n bytes at off. It aliases a buffered file, so the result must
// not be written to.
func (s *source) at(off, n uint64) ([]byte, error) {
	if off > s.size || n > s.size-off {
		return nil, ErrInvalid
	}

	if s.r == nil {
		return s.b[off : off+n], nil
	}

	buf := make([]byte, n)

	_, err := io.ReadFull(io.NewSectionReader(s.r, int64(off), int64(n)), buf)

	switch {
	case err == nil:
		return buf, nil
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		return nil, ErrInvalid
	}

	return nil, err
}

// eachBox reports where each top level payload lives without reading it.
func (s *source) eachBox(fn func(typ string, off, n uint64) error) error {
	count := 0
	for off := uint64(0); off+8 <= s.size; {
		count++
		if count > maxTopLevelBoxes {
			return ErrUnsupported
		}
		b, err := s.at(off, 8)
		if err != nil {
			return err
		}

		r := &reader{b: b}
		size := uint64(r.u32())
		typ := r.str4()
		head := uint64(8)

		switch size {
		case 1:
			if off+16 > s.size {
				return ErrInvalid
			}

			b, err = s.at(off+8, 8)
			if err != nil {
				return err
			}

			rr := &reader{b: b}
			size = rr.u64()
			head = 16
			r.err = r.err || rr.err

		case 0:
			size = s.size - off
		}

		if r.err || size < head || size > s.size-off {
			return ErrInvalid
		}

		if typ != "uuid" {
			if err := fn(typ, off+head, size-head); err != nil {
				return err
			}
		}

		off += size
	}

	return nil
}

// maxHeaderBox bounds a box eachBoxReader buffers, since its size comes from
// the file being read.
const maxHeaderBox = maxMetadataBytes

// errStop ends a walk from inside the callback.
var errStop = errors.New("heic: stop")

// eachBoxReader walks the top-level boxes of a stream. fn reads as much of a
// box as it wants from body, whose length is n, or -1 when the box runs to the
// end of the file; the rest is discarded before the next box. Boxes fn does
// not read are never buffered, so a caller after the header alone does not pay
// for the media data behind it.
func eachBoxReader(r io.Reader, fn func(typ string, n int64, body io.Reader) error) error {
	var hdr [16]byte
	count := 0

	for {
		count++
		if count > maxTopLevelBoxes {
			return ErrUnsupported
		}
		// A short read at a box boundary is the end of the walk, which is
		// what the in-memory form does with a trailing partial header.
		if _, err := io.ReadFull(r, hdr[:8]); err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				return nil
			}

			return ErrInvalid
		}

		size := uint64(hdr[0])<<24 | uint64(hdr[1])<<16 | uint64(hdr[2])<<8 | uint64(hdr[3])
		typ := string(hdr[4:8])
		head := uint64(8)

		if size == 1 {
			if _, err := io.ReadFull(r, hdr[8:16]); err != nil {
				return ErrInvalid
			}

			size = 0
			for _, b := range hdr[8:16] {
				size = size<<8 | uint64(b)
			}

			head = 16
		}

		n := int64(-1)
		if size != 0 {
			if size < head {
				return ErrInvalid
			}

			n = int64(size - head)
		}

		body := &io.LimitedReader{R: r, N: maxHeaderBox}
		if n >= 0 {
			body.N = n
		}

		err := fn(typ, n, body)

		if _, derr := io.Copy(io.Discard, body); derr != nil {
			return ErrInvalid
		}

		if err != nil {
			return err
		}

		if n < 0 {
			return nil
		}
	}
}

// boxBytes reads a whole box payload, refusing one too large to be a header.
func boxBytes(body io.Reader, n int64) ([]byte, error) {
	if n < 0 {
		return io.ReadAll(body)
	}

	if n > maxHeaderBox {
		return nil, ErrInvalid
	}

	b := make([]byte, n)
	if _, err := io.ReadFull(body, b); err != nil {
		return nil, ErrInvalid
	}

	return b, nil
}

func parseMeta(payload []byte) (*metaBox, error) {
	r := &reader{b: payload}
	r.fullBox()
	if r.err {
		return nil, ErrInvalid
	}

	m := &metaBox{items: map[uint32]*item{}}

	err := eachBox(payload[r.i:], func(typ string, b []byte) error {
		switch typ {
		case "pitm":
			rr := &reader{b: b}
			v, _ := rr.fullBox()
			if v == 0 {
				m.primary = uint32(rr.u16())
			} else {
				m.primary = rr.u32()
			}
			if rr.err {
				return ErrInvalid
			}

		case "iloc":
			return m.parseIloc(b)

		case "iinf":
			return m.parseIinf(b)

		case "iref":
			return m.parseIref(b)

		case "idat":
			m.idat = b

		case "iprp":
			return eachBox(b, func(typ string, b []byte) error {
				switch typ {
				case "ipco":
					return m.parseIpco(b)
				case "ipma":
					return m.parseIpma(b)
				}

				return nil
			})
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	m.markUnsupported()

	return m, nil
}

// knownProps are the property types this reader implements. An item with an
// essential association to anything else must not be processed.
var knownProps = map[string]bool{
	"ispe": true, "hvcC": true, "pixi": true, "auxC": true,
	"irot": true, "imir": true, "clap": true, "colr": true,
}

func (m *metaBox) markUnsupported() {
	for _, it := range m.items {
		for _, ip := range it.props {
			if !ip.essential {
				continue
			}
			if ip.idx >= len(m.props) || !knownProps[m.props[ip.idx].typ] {
				it.unsupported = true

				break
			}
		}
	}
}

func (m *metaBox) item(id uint32) (*item, error) {
	it := m.items[id]
	if it == nil {
		if len(m.items) >= maxItems {
			return nil, ErrUnsupported
		}
		it = &item{id: id}
		m.items[id] = it
		m.order = append(m.order, id)
	}

	return it, nil
}

func (m *metaBox) parseIloc(b []byte) error {
	r := &reader{b: b}
	v, _ := r.fullBox()

	sizes := r.u8()
	offSize, lenSize := int(sizes>>4), int(sizes&0xf)
	sizes = r.u8()
	baseSize, idxSize := int(sizes>>4), int(sizes&0xf)
	if v < 1 {
		idxSize = 0
	}
	for _, n := range []int{offSize, lenSize, baseSize, idxSize} {
		if n != 0 && n != 4 && n != 8 {
			return ErrInvalid
		}
	}

	count := int(r.u16())
	if v == 2 {
		r.i -= 2
		count = int(r.u32())
	}
	if r.err || count > maxItems {
		return ErrUnsupported
	}

	for range count {
		var id uint32
		if v < 2 {
			id = uint32(r.u16())
		} else {
			id = r.u32()
		}
		it, err := m.item(id)
		if err != nil {
			return err
		}
		if v >= 1 {
			it.method = uint8(r.u16() & 0xf)
		}
		r.skip(2)
		it.baseOffset = r.uint(baseSize)

		n := int(r.u16())
		if n > maxItemExtents-m.extentCount {
			return ErrUnsupported
		}
		m.extentCount += n
		for range n {
			r.skip(idxSize)
			off := r.uint(offSize)
			l := r.uint(lenSize)
			if r.err {
				return ErrInvalid
			}
			it.extents = append(it.extents, extent{off: off, len: l})
		}
		if r.err {
			return ErrInvalid
		}
	}

	return nil
}

func (m *metaBox) parseIinf(b []byte) error {
	r := &reader{b: b}
	v, _ := r.fullBox()
	if v == 0 {
		r.u16()
	} else {
		r.u32()
	}
	if r.err {
		return ErrInvalid
	}

	return eachBox(b[r.i:], func(typ string, b []byte) error {
		if typ != "infe" {
			return nil
		}
		rr := &reader{b: b}
		v, _ := rr.fullBox()
		if v < 2 {
			return nil
		}

		var id uint32
		if v == 2 {
			id = uint32(rr.u16())
		} else {
			id = rr.u32()
		}
		rr.skip(2)
		itemType := rr.str4()
		if rr.err {
			return ErrInvalid
		}

		it, err := m.item(id)
		if err != nil {
			return err
		}
		it.typ = itemType

		if itemType == "mime" {
			rr.cstr()
			if ct := rr.cstr(); !rr.err {
				it.contentType = ct
			}
		}

		return nil
	})
}

func (m *metaBox) parseIref(b []byte) error {
	r := &reader{b: b}
	v, _ := r.fullBox()
	if r.err {
		return ErrInvalid
	}

	return eachBox(b[r.i:], func(typ string, b []byte) error {
		rr := &reader{b: b}
		ref := itemRef{typ: typ}
		if v == 0 {
			ref.from = uint32(rr.u16())
		} else {
			ref.from = rr.u32()
		}
		n := int(rr.u16())
		if n > maxItemReferences-m.referenceCount {
			return ErrUnsupported
		}
		m.referenceCount += n
		for range n {
			var to uint32
			if v == 0 {
				to = uint32(rr.u16())
			} else {
				to = rr.u32()
			}
			ref.to = append(ref.to, to)
		}
		if rr.err {
			return ErrInvalid
		}
		if len(m.refs) >= maxItemReferences {
			return ErrUnsupported
		}
		m.refs = append(m.refs, ref)

		return nil
	})
}

func (m *metaBox) parseIpco(b []byte) error {
	return eachBox(b, func(typ string, b []byte) error {
		if len(m.props) >= maxProperties {
			return ErrUnsupported
		}
		p := property{typ: typ}
		r := &reader{b: b}

		switch typ {
		case "ispe":
			r.fullBox()
			p.w = r.u32()
			p.h = r.u32()

		case "hvcC":
			c, err := parseHvcC(r)
			if err != nil {
				return err
			}
			p.hvcC = c

		case "pixi":
			r.fullBox()
			n := int(r.u8())
			for range n {
				p.pixi = append(p.pixi, r.u8())
			}

		case "auxC":
			r.fullBox()
			p.auxC = r.cstr()

		case "irot":
			p.angle = r.u8() & 3

		case "imir":
			p.axis = r.u8() & 1

		case "clap":
			for i := range 8 {
				p.clap[i] = r.u32()
			}

		case "colr":
			switch r.str4() {
			case "nclx":
				p.colr = &colorInfo{hasNCLX: true}
				p.colr.primaries = r.u16()
				p.colr.transfer = r.u16()
				p.colr.matrix = r.u16()
				p.colr.fullRange = r.u8()>>7 != 0
			case "rICC", "prof":
				p.colr = &colorInfo{icc: b[4:]}
			}
		}

		if r.err {
			return ErrInvalid
		}
		m.props = append(m.props, p)

		return nil
	})
}

func (m *metaBox) parseIpma(b []byte) error {
	r := &reader{b: b}
	v, flags := r.fullBox()
	count := int(r.u32())
	if r.err || count > maxItems {
		return ErrInvalid
	}

	for range count {
		var id uint32
		if v < 1 {
			id = uint32(r.u16())
		} else {
			id = r.u32()
		}
		it, err := m.item(id)
		if err != nil {
			return err
		}

		n := int(r.u8())
		if n > maxItemProperties-m.propertyCount {
			return ErrUnsupported
		}
		m.propertyCount += n
		it.props = slices.Grow(it.props, n)

		for range n {
			var idx int
			var essential bool
			if flags&1 != 0 {
				v := r.u16()
				idx, essential = int(v&0x7fff), v&0x8000 != 0
			} else {
				v := r.u8()
				idx, essential = int(v&0x7f), v&0x80 != 0
			}
			if r.err {
				return ErrInvalid
			}
			if idx == 0 {
				continue
			}
			it.props = append(it.props, itemProp{idx: idx - 1, essential: essential})
		}
		if r.err {
			return ErrInvalid
		}
	}

	return nil
}

func (m *metaBox) dataSource(it *item, src *source) (*source, error) {
	if it.method == 1 {
		return memSource(m.idat), nil
	} else if it.method != 0 {
		return nil, ErrInvalid
	}
	return src, nil
}

func dataSpan(it *item, src *source, e extent) (uint64, uint64, error) {
	if e.off > ^uint64(0)-it.baseOffset {
		return 0, 0, ErrInvalid
	}
	off, n := it.baseOffset+e.off, e.len
	if n == 0 {
		if off > src.size {
			return 0, 0, ErrInvalid
		}

		n = src.size - off
	}

	if off > src.size || n > src.size-off {
		return 0, 0, ErrInvalid
	}

	return off, n, nil
}

func (m *metaBox) dataSize(it *item, src *source) (uint64, error) {
	src, err := m.dataSource(it, src)
	if err != nil {
		return 0, err
	}
	total := uint64(0)
	for _, e := range it.extents {
		_, n, err := dataSpan(it, src, e)
		if err != nil {
			return 0, err
		}
		if n > maxItemDataBytes-total {
			return 0, ErrUnsupported
		}
		total += n
	}
	if total == 0 {
		return 0, ErrInvalid
	}
	return total, nil
}

// data gathers an item's extents out of the file or, for construction method 1, out of idat.
func (m *metaBox) data(it *item, src *source) ([]byte, error) {
	src, err := m.dataSource(it, src)
	if err != nil {
		return nil, err
	}
	total, err := m.dataSize(it, src)
	if err != nil {
		return nil, err
	}

	if len(it.extents) == 1 {
		off, n, err := dataSpan(it, src, it.extents[0])
		if err != nil {
			return nil, err
		}

		return src.at(off, n)
	}

	out := make([]byte, 0, int(total))
	for _, e := range it.extents {
		off, n, err := dataSpan(it, src, e)
		if err != nil {
			return nil, err
		}
		b, err := src.at(off, n)
		if err != nil {
			return nil, err
		}

		out = append(out, b...)
	}

	return out, nil
}

func (m *metaBox) prop(it *item, typ string) *property {
	if it == nil {
		return nil
	}
	for _, ip := range it.props {
		if ip.idx < len(m.props) && m.props[ip.idx].typ == typ {
			return &m.props[ip.idx]
		}
	}

	return nil
}

func (m *metaBox) refsTo(typ string, from uint32) []uint32 {
	for _, r := range m.refs {
		if r.typ == typ && r.from == from {
			return r.to
		}
	}

	return nil
}

// parseHvcC reads the HEVCDecoderConfigurationRecord. Everything before the
// arrays is fixed width, and the profile and level fields are not needed once
// the parameter sets themselves are in hand.
func parseHvcC(r *reader) (*hevcConfig, error) {
	if r.u8() != 1 {
		return nil, ErrInvalid
	}

	r.skip(12)

	c := &hevcConfig{}

	r.skip(2)
	r.skip(1)
	c.chromaFormat = r.u8() & 3
	c.bitDepthLuma = r.u8()&7 + 8
	c.bitDepthChroma = r.u8()&7 + 8

	r.skip(2)
	c.lengthSize = int(r.u8()&3) + 1

	arrays := int(r.u8())
	if r.err {
		return nil, ErrInvalid
	}

	totalSets, totalBytes := 0, 0
	for range arrays {
		r.skip(1)

		n := int(r.u16())
		if n > maxParameterSets-totalSets {
			return nil, ErrUnsupported
		}
		totalSets += n
		c.paramSets = slices.Grow(c.paramSets, n)

		for range n {
			nalBytes := int(r.u16())
			if nalBytes > maxParameterBytes-totalBytes {
				return nil, ErrUnsupported
			}
			totalBytes += nalBytes
			nal := r.bytes(nalBytes)
			if r.err {
				return nil, ErrInvalid
			}

			c.paramSets = append(c.paramSets, nal)
		}
	}

	if r.err {
		return nil, ErrInvalid
	}

	return c, nil
}
