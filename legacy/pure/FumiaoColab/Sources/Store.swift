import SwiftUI
import AppKit

@MainActor final class AppStore: ObservableObject {
    @Published var user: [String: Any]?
    @Published var username = ""
    @Published var password = ""
    @Published var working = false
    @Published var refreshing = false
    @Published var error = ""
    @Published var notice = "先登录弗淼 AIGC，确认接入身份"
    @Published var googleEmail = ""
    @Published var googleBound = false
    @Published var balance: Double?
    @Published var burn: Double?
    @Published var gpu = "G4"
    @Published var idle = 30
    @Published var hidePrivate = true
    @Published var authSheet = false
    @Published var authCode = ""
    @Published var authURL: URL?
    @Published var nodeName = ""
    @Published var nodeStage = "offline"
    @Published var deployed = false
    @Published var startedAt: Date?
    @Published var now = Date()
    @Published var logs: [String] = []
    @Published var showLogs = false
    @Published var confirmRelease = false
    @Published var preview = false
    var sessionToken: String?
    var timer: Timer?
    private let delegate = NoRedirect()
    private lazy var apiSession = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
    let site = "https://nvmes.com"

    var userLabel: String { user?["nickname"] as? String ?? user?["name"] as? String ?? "" }
    var ownerID: Int { user?["id"] as? Int ?? 0 }
    var deploymentLabel: String {
        if working { return "正在处理…" }
        guard deployed else { return "一键部署并接入弗淼" }
        switch nodeStage {
        case "ready", "busy": return "已部署并接入弗淼"
        case "preparing": return "正在部署 MiniMax H3"
        case "error": return "部署异常，请查看状态"
        default: return "实例未连接，请刷新状态"
        }
    }
    var status: String {
        if working { return "处理中" }
        switch nodeStage { case "ready": return "已就绪"; case "busy": return "运行中"
        case "preparing": return "部署中"; case "error": return "异常"; default: return "离线" }
    }
    var elapsed: String {
        guard let start = startedAt, deployed else { return "00:00:00" }
        let total = max(0, Int(now.timeIntervalSince(start)))
        return String(format: "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }

    func request(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        guard !preview else { throw AppFailure.message("界面预览不会连接真实账号。") }
        var req = URLRequest(url: URL(string: site + path)!)
        req.timeoutInterval = 35
        req.setValue("FumiaoColab/1.0", forHTTPHeaderField: "User-Agent")
        if let sessionToken { req.setValue("fm_session=" + sessionToken, forHTTPHeaderField: "Cookie") }
        if let body {
            req.httpMethod = "POST"
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await apiSession.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw AppFailure.message("无法连接弗淼 AIGC。") }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 { user = nil; sessionToken = nil; try? SecureStore.save(nil, key: "session") }
            throw AppFailure.message(json["detail"] as? String ?? "连接失败（\(http.statusCode)），请稍后重试。")
        }
        if path == "/api/login" {
            let headers = http.allHeaderFields.reduce(into: [String: String]()) { result, entry in
                result[String(describing: entry.key)] = String(describing: entry.value)
            }
            guard let cookie = HTTPCookie.cookies(withResponseHeaderFields: headers, for: req.url!)
                .first(where: { $0.name == "fm_session" }) else { throw AppFailure.message("未收到登录凭据，请重试。") }
            try SecureStore.save(cookie.value, key: "session"); sessionToken = cookie.value
        }
        return json
    }

    func bridge(_ command: String, _ input: [String: Any] = [:]) async throws -> [String: Any] {
        try await Task.detached(priority: .userInitiated) { [weak self] in
            try LocalBridge.run(command, input: input) { [weak self] line in
                guard line.hasPrefix("PROGRESS:") else { return }
                let message = String(line.dropFirst(9)).trimmingCharacters(in: .whitespaces)
                Task { @MainActor in self?.notice = message; self?.logs.append(message) }
            }
        }.value
    }

    func perform(_ action: @escaping () async throws -> Void) {
        guard !working, !preview else { return }
        working = true; error = ""
        Task {
            defer { working = false; Task { await self.refresh() } }
            do { try await action() } catch { self.error = error.localizedDescription }
        }
    }

    func start() {
        if ProcessInfo.processInfo.arguments.contains("--preview") {
            preview = true; user = ["id": -1, "nickname": "示例用户", "name": "preview"]
            googleBound = true; googleEmail = "preview@example.com"; notice = "界面预览 · 未连接真实实例"
            return
        }
        sessionToken = SecureStore.read("session")
        Task { if sessionToken != nil { await refresh() } }
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }; self.now = Date()
                if Int(self.now.timeIntervalSince1970) % 30 == 0 { await self.refresh() }
            }
        }
    }

    func login() {
        perform {
            _ = try await self.request("/api/login", body: ["name": self.username.trimmingCharacters(in: .whitespaces), "password": self.password])
            self.password = ""
            let state = try await self.request("/api/state")
            self.user = state["me"] as? [String: Any]
            self.notice = "已确认接入身份，请绑定 Google 账号"
            if FileManager.default.isExecutableFile(atPath: LocalBridge.python) { try await self.syncGoogle() }
        }
    }

    func logout() {
        perform {
            _ = try await self.request("/api/logout", body: [:])
            try SecureStore.save(nil, key: "session")
            self.sessionToken = nil; self.user = nil; self.username = ""; self.password = ""
            self.notice = self.deployed ? "实例仍归原账号管理，重新登录后可继续查看" : "先登录弗淼 AIGC，确认接入身份"
        }
    }

    func syncGoogle() async throws {
        let requestedOwner = ownerID
        let result = try await bridge("status", ["owner_id": requestedOwner])
        guard ownerID == requestedOwner else { return }
        googleBound = result["logged_in"] as? Bool ?? false
        googleEmail = result["email"] as? String ?? ""
        balance = result["paid_balance"] as? Double; burn = result["burn_rate_hourly"] as? Double
        deployed = result["managed_active"] as? Bool ?? false
        if let name = result["node_name"] as? String { nodeName = name }
        if let stamp = result["started_at"] as? Double { startedAt = Date(timeIntervalSince1970: stamp) }
        if let minutes = result["idle_minutes"] as? Int { idle = minutes }
        if !deployed { nodeStage = "offline"; startedAt = nil }
    }

    func refresh() async {
        guard !refreshing, !working, !preview, sessionToken != nil else { return }
        refreshing = true; defer { refreshing = false }
        do {
            let expectedSession = sessionToken
            let data = try await request("/api/state")
            guard sessionToken == expectedSession else { return }
            user = data["me"] as? [String: Any]
            if FileManager.default.isExecutableFile(atPath: LocalBridge.python) { try await syncGoogle() }
            guard sessionToken == expectedSession else { return }
            if let node = (data["nodes"] as? [[String: Any]])?.first(where: {
                ($0["name"] as? String) == nodeName && ($0["owner"] as? Int) == ownerID
            }) {
                let seen = node["lastseen"] as? Double ?? 0
                nodeStage = deployed && Date().timeIntervalSince1970 - seen < 90 ? (node["stage"] as? String ?? "offline") : "offline"
                notice = node["detail"] as? String ?? ""
                if nodeStage == "ready" { notice = "\(nodeName) 已接入弗淼 AIGC，等待任务" }
                if nodeStage == "offline" {
                    if node["stage"] as? String == "error" { error = node["detail"] as? String ?? "部署未完成" }
                    notice = deployed ? "实例暂无心跳，请查看部署日志" : "Colab 实例已释放"
                }
                if let detail = node["detail"] as? String, !detail.isEmpty, logs.last != detail {
                    logs.append(detail); if logs.count > 200 { logs.removeFirst() }
                }
            } else if user != nil && !deployed {
                notice = googleBound ? "准备就绪，可以部署 MiniMax H3" : "已确认接入身份，请绑定 Google 账号"
            }
        } catch { self.error = error.localizedDescription }
    }

    func bindGoogle() {
        guard user != nil, !deployed else { return }
        perform {
            let result = try await self.bridge("auth_url")
            guard let raw = result["auth_url"] as? String, let url = URL(string: raw),
                  url.scheme == "https", url.host == "accounts.google.com" else {
                throw AppFailure.message("无法打开 Google 授权页面，请重试。")
            }
            self.authURL = url; self.authCode = ""; self.authSheet = true
            NSWorkspace.shared.open(url)
        }
    }

    func finishGoogle() {
        perform {
            _ = try await self.bridge("auth_code", ["code": self.authCode.trimmingCharacters(in: .whitespacesAndNewlines)])
            self.authCode = ""; self.authSheet = false
            try await self.syncGoogle()
            self.notice = "Google 账号已绑定，可以部署 MiniMax H3"
        }
    }

    func deploy() {
        guard user != nil, googleBound, !deployed else { return }
        perform {
            self.notice = "正在创建弗淼接入凭据…"
            let pair = try await self.request("/api/pairs", body: ["name": "", "models": ["MiniMax H3"]])
            guard let command = pair["command"] as? String, let name = pair["name"] as? String,
                  let code = command.split(separator: " ").last, code.count >= 30,
                  code.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }) else {
                throw AppFailure.message("接入凭据无效，请重试。")
            }
            self.nodeName = name
            let result = try await self.bridge("deploy", ["site": self.site, "code": String(code), "node_name": name,
                "owner_id": self.ownerID, "gpu": self.gpu, "idle_minutes": self.idle])
            self.deployed = result["managed_active"] as? Bool ?? false
            self.startedAt = Date(); self.nodeStage = "preparing"
            self.notice = "\(name) 正在下载并加载 MiniMax H3"
        }
    }

    func setIdle(_ minutes: Int) {
        let old = idle; idle = minutes
        if !deployed { return }
        perform {
            do { _ = try await self.bridge("idle", ["owner_id": self.ownerID, "minutes": minutes]) }
            catch { self.idle = old; throw error }
        }
    }

    func release() {
        perform {
            _ = try await self.bridge("stop", ["owner_id": self.ownerID])
            self.deployed = false; self.nodeStage = "offline"; self.startedAt = nil
            self.notice = "本应用的 Colab 实例已释放"
            try await self.syncGoogle()
        }
    }
}
