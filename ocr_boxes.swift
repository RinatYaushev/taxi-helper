import Foundation
import Vision
import AppKit

// OCR з координатами. Вивід: файл \t текст \t x \t y \t w \t h (норм., origin низ-ліво)
let args = CommandLine.arguments
guard args.count > 1 else { exit(1) }
let dir = args[1]
let fm = FileManager.default
let files = (try? fm.contentsOfDirectory(atPath: dir))?
    .filter { $0.lowercased().hasSuffix(".png") }.sorted() ?? []

for f in files {
    let full = (dir as NSString).appendingPathComponent(f)
    guard let img = NSImage(contentsOfFile: full),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["uk-UA", "en-US"]
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
    for obs in req.results ?? [] {
        guard let top = obs.topCandidates(1).first else { continue }
        let b = obs.boundingBox
        print("\(f)\t\(top.string)\t\(b.origin.x)\t\(b.origin.y)\t\(b.size.width)\t\(b.size.height)")
    }
}

