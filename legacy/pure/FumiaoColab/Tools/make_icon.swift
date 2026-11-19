// Original geometric app tile using Apple's SF Symbols cpu, matching the native UI.
import AppKit
let directory = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let size = points * scale
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        let context = NSGraphicsContext.current!.cgContext
        context.scaleBy(x: CGFloat(size) / 1024, y: CGFloat(size) / 1024)
        NSColor(red: 0.91, green: 0.94, blue: 0.99, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 70, y: 70, width: 884, height: 884), xRadius: 196, yRadius: 196).fill()
        let config = NSImage.SymbolConfiguration(pointSize: 480, weight: .regular)
            .applying(.init(paletteColors: [NSColor(red: 0, green: 0.42, blue: 0.98, alpha: 1)]))
        if let symbol = NSImage(systemSymbolName: "cpu", accessibilityDescription: nil)?.withSymbolConfiguration(config) {
            symbol.draw(in: NSRect(x: 252, y: 252, width: 520, height: 520))
        }
        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 2 ? "@2x" : ""
        try rep.representation(using: .png, properties: [:])!.write(to: directory.appendingPathComponent("icon_\(points)x\(points)\(suffix).png"))
    }
}
