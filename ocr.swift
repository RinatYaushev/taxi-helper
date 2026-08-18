import Foundation
import Vision
import AppKit

// OCR для скріншотів Uklon. Використання: swift ocr.swift <шлях_до_папки>
let args = CommandLine.arguments
guard args.count > 1 else {
    FileHandle.standardError.write("Usage: swift ocr.swift <dir>\n".data(using: .utf8)!)
    exit(1)
}
let dir = args[1]
let fm = FileManager.default
let files = (try? fm.contentsOfDirectory(atPath: dir))?
    .filter { $0.lowercased().hasSuffix(".png") || $0.lowercased().hasSuffix(".jpg") || $0.lowercased().hasSuffix(".jpeg") }
    .sorted() ?? []

func ocr(_ path: String) -> String {
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        return ""
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["uk-UA", "ru-RU", "en-US"]
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    try? handler.perform([request])
    guard let obs = request.results else { return "" }
    return obs.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

for f in files {
    let full = (dir as NSString).appendingPathComponent(f)
    print("===== \(f) =====")
    print(ocr(full))
    print("")
}

