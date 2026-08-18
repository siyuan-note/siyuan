package heic

import "image"

type raw struct {
	pix    []byte
	stride int
	w, h   int
	psize  int
}

func toRaw(img image.Image) (*raw, bool) {
	switch m := img.(type) {
	case *image.NRGBA:
		return &raw{m.Pix, m.Stride, m.Rect.Dx(), m.Rect.Dy(), 4}, true
	case *image.NRGBA64:
		return &raw{m.Pix, m.Stride, m.Rect.Dx(), m.Rect.Dy(), 8}, true
	}

	return nil, false
}

func (r *raw) toImage() image.Image {
	rect := image.Rect(0, 0, r.w, r.h)
	if r.psize == 4 {
		return &image.NRGBA{Pix: r.pix, Stride: r.stride, Rect: rect}
	}

	return &image.NRGBA64{Pix: r.pix, Stride: r.stride, Rect: rect}
}

func (r *raw) alloc(w, h int) *raw {
	return &raw{pix: make([]byte, w*h*r.psize), stride: w * r.psize, w: w, h: h, psize: r.psize}
}

func (r *raw) at(x, y int) []byte {
	o := y*r.stride + x*r.psize

	return r.pix[o : o+r.psize]
}

func (r *raw) crop(x, y, w, h int) *raw {
	out := r.alloc(w, h)
	for j := range h {
		copy(out.pix[j*out.stride:][:w*r.psize], r.at(x, y+j)[:w*r.psize])
	}

	return out
}

// rotate turns the image anti-clockwise by angle quarter turns.
func (r *raw) rotate(angle int) *raw {
	if angle == 0 {
		return r
	}
	w, h := r.w, r.h
	if angle&1 != 0 {
		w, h = h, w
	}
	out := r.alloc(w, h)

	for j := range r.h {
		for i := range r.w {
			var dx, dy int
			switch angle {
			case 1:
				dx, dy = j, r.w-1-i
			case 2:
				dx, dy = r.w-1-i, r.h-1-j
			default:
				dx, dy = r.h-1-j, i
			}
			copy(out.at(dx, dy), r.at(i, j))
		}
	}

	return out
}

func (r *raw) mirror(axis int) *raw {
	if axis == 0 {
		for y := range r.h / 2 {
			a := r.pix[y*r.stride:][:r.w*r.psize]
			b := r.pix[(r.h-1-y)*r.stride:][:r.w*r.psize]
			for i := range a {
				a[i], b[i] = b[i], a[i]
			}
		}

		return r
	}

	for y := range r.h {
		for x := range r.w / 2 {
			a, b := r.at(x, y), r.at(r.w-1-x, y)
			for i := range a {
				a[i], b[i] = b[i], a[i]
			}
		}
	}

	return r
}

// cropRect derives the clean aperture rectangle, in fractions throughout.
func cropRect(clap *[8]uint32, w, h int) (int, int, int, int, bool) {
	widthN, widthD := int64(int32(clap[0])), int64(int32(clap[1]))
	heightN, heightD := int64(int32(clap[2])), int64(int32(clap[3]))
	horizN, horizD := int64(int32(clap[4])), int64(int32(clap[5]))
	vertN, vertD := int64(int32(clap[6])), int64(int32(clap[7]))

	if widthD <= 0 || heightD <= 0 || horizD <= 0 || vertD <= 0 ||
		widthN < 0 || heightN < 0 {
		return 0, 0, 0, 0, false
	}
	if widthN%widthD != 0 || heightN%heightD != 0 {
		return 0, 0, 0, 0, false
	}
	clapW, clapH := widthN/widthD, heightN/heightD

	numX := int64(w)*horizD + 2*horizN - clapW*horizD
	denX := 2 * horizD
	numY := int64(h)*vertD + 2*vertN - clapH*vertD
	denY := 2 * vertD
	if numX%denX != 0 || numY%denY != 0 {
		return 0, 0, 0, 0, false
	}
	x, y := numX/denX, numY/denY

	if x < 0 || y < 0 || clapW <= 0 || clapH <= 0 ||
		x+clapW > int64(w) || y+clapH > int64(h) {
		return 0, 0, 0, 0, false
	}

	return int(x), int(y), int(clapW), int(clapH), true
}

// applyTransforms runs clean aperture, then rotation, then mirroring, per MIAF 7.3.6.7.
// hasTransform reports whether AutoRotate would have to touch the pixels.
func (f *file) hasTransform(it *item) bool {
	return f.meta.prop(it, "clap") != nil || f.meta.prop(it, "irot") != nil ||
		f.meta.prop(it, "imir") != nil
}

func (f *file) applyTransforms(img image.Image, it *item) (image.Image, error) {
	clap := f.meta.prop(it, "clap")
	irot := f.meta.prop(it, "irot")
	imir := f.meta.prop(it, "imir")
	if clap == nil && irot == nil && imir == nil {
		return img, nil
	}

	r, ok := toRaw(img)
	if !ok {
		return nil, ErrUnsupported
	}

	x, y, w, h := 0, 0, r.w, r.h
	if clap != nil {
		x, y, w, h, ok = cropRect(&clap.clap, r.w, r.h)
		if !ok {
			return nil, ErrInvalid
		}
	}
	angle := 0
	if irot != nil {
		angle = int(irot.angle)
	}
	if x == 0 && y == 0 && w == r.w && h == r.h && angle == 0 {
		if imir != nil {
			r = r.mirror(int(imir.axis))
		}
		return r.toImage(), nil
	}

	outW, outH := w, h
	if angle&1 != 0 {
		outW, outH = h, w
	}
	out := r.alloc(outW, outH)
	for sourceY := range h {
		for sourceX := range w {
			destX, destY := sourceX, sourceY
			switch angle {
			case 1:
				destX, destY = sourceY, w-1-sourceX
			case 2:
				destX, destY = w-1-sourceX, h-1-sourceY
			case 3:
				destX, destY = h-1-sourceY, sourceX
			}
			if imir != nil {
				if imir.axis == 0 {
					destY = outH - 1 - destY
				} else {
					destX = outW - 1 - destX
				}
			}
			copy(out.at(destX, destY), r.at(x+sourceX, y+sourceY))
		}
	}

	return out.toImage(), nil
}

// transform applies the clap, irot and imir properties. The planar images the
// ToYCbCr path returns alias the decoded planes, so they are converted first.
func (f *file) transform(it *item, img image.Image) (image.Image, error) {
	if !f.hasTransform(it) {
		return img, nil
	}

	if aliasesPicture(img) {
		return nil, ErrUnsupported
	}

	return f.applyTransforms(img, it)
}
