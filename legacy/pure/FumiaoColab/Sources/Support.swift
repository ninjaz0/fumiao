import AppKit
import Foundation
import Security

enum AppFailure: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

enum SecureStore {
    static let service = "com.nvmes.FumiaoColab"
    static func read(_ key: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: key,
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var data: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &data) == errSecSuccess,
              let bytes = data as? Data else { return nil }
        return String(data: bytes, encoding: .utf8)
    }
    static func save(_ value: String?, key: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: key]
        SecItemDelete(query as CFDictionary)
        guard let value else { return }
        var entry = query
        entry[kSecValueData as String] = Data(value.utf8)
        entry[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(entry as CFDictionary, nil) == errSecSuccess else {
            throw AppFailure.message("无法保存登录状态，请检查钥匙串权限。")
        }
    }
}

enum LocalBridge {
    static let root = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/FumiaoColab", isDirectory: true)
    static let python = root.appendingPathComponent("venv/bin/python").path
    static let resource = Bundle.main.resourceURL!

    static func process(_ executable: String, _ args: [String], input: [String: Any] = [:],
                        timeout: Double = 900, line: @escaping @Sendable (String) -> Void = { _ in }) throws -> String {
        let process = Process(), output = Pipe(), stdin = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = args
        var env = ProcessInfo.processInfo.environment
        env["PYTHONUNBUFFERED"] = "1"
        env["FUMIAOCOLAB_HOME"] = root.path
        process.environment = env
        process.standardOutput = output; process.standardError = output; process.standardInput = stdin
        try process.run()
        let deadline = DispatchWorkItem { if process.isRunning { process.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: deadline)
        defer { deadline.cancel() }
        try stdin.fileHandleForWriting.write(contentsOf: JSONSerialization.data(withJSONObject: input))
        try stdin.fileHandleForWriting.close()
        var all = Data(), pending = Data()
        while true {
            let chunk = output.fileHandleForReading.availableData
            if chunk.isEmpty { break }
            all.append(chunk); pending.append(chunk)
            while let newline = pending.firstIndex(of: 10) {
                let bytes = pending.prefix(upTo: newline)
                line(String(decoding: bytes, as: UTF8.self))
                pending.removeSubrange(...newline)
            }
        }
        process.waitUntilExit()
        let text = String(decoding: all, as: UTF8.self)
        guard process.terminationStatus == 0 else {
            let safe = text.split(separator: "\n").last(where: { $0.hasPrefix("ERROR:") })
            throw AppFailure.message(safe.map { String($0.dropFirst(6)) } ?? "连接组件未完成操作，请重试。")
        }
        return text
    }

    static func prepare(line: @escaping @Sendable (String) -> Void) throws {
        if FileManager.default.isExecutableFile(atPath: python) {
            if (try? process(python, ["-c", "import colab_cli, google_auth_oauthlib, requests"])) != nil { return }
        }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        let candidates = ["/opt/homebrew/bin/python3.13", "/opt/homebrew/bin/python3.12", "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3", "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"]
        guard let base = candidates.first(where: { candidate in
            FileManager.default.isExecutableFile(atPath: candidate) &&
            (try? process(candidate, ["-c", "import sys; assert sys.version_info >= (3,12)"])) != nil
        }) else { throw AppFailure.message("需要 Python 3.12 或更高版本。请从 python.org 安装后重试。") }
        line("正在准备 Google 连接组件…")
        if !FileManager.default.isExecutableFile(atPath: python) {
            _ = try process(base, ["-m", "venv", root.appendingPathComponent("venv").path])
        }
        _ = try process(python, ["-m", "pip", "install", "--disable-pip-version-check", "-r",
            resource.appendingPathComponent("requirements.txt").path], timeout: 600)
    }

    static func run(_ command: String, input: [String: Any] = [:],
                    line: @escaping @Sendable (String) -> Void = { _ in }) throws -> [String: Any] {
        try prepare(line: line)
        let output = try process(python, [resource.appendingPathComponent("bridge.py").path, command],
            input: input, timeout: command == "deploy" ? 1200 : 180, line: line)
        for raw in output.split(separator: "\n").reversed() {
            if let object = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any] {
                if object["ok"] as? Bool == false { throw AppFailure.message(object["error"] as? String ?? "操作失败，请重试。") }
                return object
            }
        }
        throw AppFailure.message("连接组件未返回有效结果，请重试。")
    }
}

final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
