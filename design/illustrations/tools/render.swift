// SVG -> Rohpixel (RGBX) mit CoreSVG (NSImage). Die PNG-Datei entsteht in Node (tools/png8.js).
// Aufruf: render <jobs.tsv>; Zeilen: in<TAB>out<TAB>breite<TAB>hoehe
import AppKit

func render(_ input: String, _ output: String, _ w: Int, _ h: Int) -> Bool {
    guard let img = NSImage(contentsOf: URL(fileURLWithPath: input)) else { return false }
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.interpolationQuality = .high
    let g = NSGraphicsContext(cgContext: ctx, flipped: false)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = g
    img.draw(in: NSRect(x: 0, y: 0, width: w, height: h))
    NSGraphicsContext.restoreGraphicsState()
    // Rohdaten (RGBX, 4 Byte je Pixel) für die Palettenquantisierung in Node
    guard let data = ctx.data else { return false }
    let n = w * h * 4
    let buf = Data(bytes: data, count: n)
    do { try buf.write(to: URL(fileURLWithPath: output)) } catch { return false }
    return true
}

let args = CommandLine.arguments
guard args.count >= 2, let text = try? String(contentsOfFile: args[1], encoding: .utf8) else {
    print("Aufruf: render <jobs.tsv>"); exit(2)
}
var failed = 0
for line in text.split(separator: "\n") {
    let p = line.split(separator: "\t").map(String.init)
    if p.count < 4 { continue }
    if !render(p[0], p[1], Int(p[2]) ?? 0, Int(p[3]) ?? 0) { print("FEHLER: \(p[0])"); failed += 1 }
}
exit(failed == 0 ? 0 : 1)
