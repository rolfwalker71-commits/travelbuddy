// Kontaktbogen aus PNGs: montage <out.png> <spalten> <zellbreite> <bild1> <bild2> ...
import AppKit

let a = CommandLine.arguments
guard a.count >= 5, let cols = Int(a[2]), let cw = Int(a[3]) else { print("Aufruf: montage out.png spalten zellbreite bilder..."); exit(2) }
let files = Array(a[4...])
let imgs = files.compactMap { NSImage(contentsOfFile: $0) }
let gap = 8
var cells: [(NSImage, Int, Int)] = []
for im in imgs {
    let r = im.size.height / im.size.width
    cells.append((im, cw, Int(Double(cw) * Double(r))))
}
let rows = (cells.count + cols - 1) / cols
var rowH: [Int] = []
for r in 0..<rows { rowH.append(cells[(r * cols)..<min(cells.count, (r + 1) * cols)].map { $0.2 }.max() ?? 0) }
let W = cols * cw + (cols + 1) * gap
let H = rowH.reduce(0, +) + (rows + 1) * gap
guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: W, pixelsHigh: H, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { exit(1) }
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor(calibratedWhite: 0.5, alpha: 1).setFill()
NSRect(x: 0, y: 0, width: W, height: H).fill()
NSGraphicsContext.current?.imageInterpolation = .high
var y = H - gap
for r in 0..<rows {
    y -= rowH[r]
    for c in 0..<cols {
        let i = r * cols + c
        if i >= cells.count { break }
        let (im, w, h) = cells[i]
        im.draw(in: NSRect(x: gap + c * (cw + gap), y: y, width: w, height: h))
    }
    y -= gap
}
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[1]))
