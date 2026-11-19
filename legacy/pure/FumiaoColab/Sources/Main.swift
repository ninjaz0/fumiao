// THESIS: FumiaoColab is an account-owned, single-runtime MiniMax H3 controller.
// OWN-WORLD: The user's EasyColab reference: cool gray-blue canvas, white rounded cards,
// blue SF Symbols, subtle edges, SF/PingFang type and quiet gray secondary controls.
// STORY: Sign in to Fumiao, bind Google, deploy H3, see truthful usage, release the runtime.
// FIRST VIEWPORT: A compact macOS window with account identity above two stacked cards;
// deployment above quota and idle controls. One blue deployment button.
// FORM: User-pinned two-card reference, code-led native SwiftUI, no unrelated workbench.
// FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
// the verdict, DESIGN.md, and every shipping raster carrying its provenance.
import SwiftUI
import AppKit

enum Palette {
    static let background = Color(red: 0.906, green: 0.925, blue: 0.954)
    static let card = Color(red: 0.985, green: 0.990, blue: 1)
    static let border = Color(red: 0.810, green: 0.846, blue: 0.898)
    static let text = Color(red: 0.16, green: 0.17, blue: 0.18)
    static let secondary = Color(red: 0.38, green: 0.40, blue: 0.43)
    static let control = Color(red: 0.91, green: 0.915, blue: 0.925)
    static let blue = Color(red: 0, green: 0.42, blue: 0.98)
}

struct SoftButton: ButtonStyle {
    var primary = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 14, weight: .medium))
            .padding(.horizontal, 15).frame(minHeight: 34)
            .foregroundStyle(primary && enabled ? .white : Palette.text.opacity(enabled ? 1 : 0.38))
            .background(primary && enabled ? Palette.blue : Palette.control)
            .clipShape(RoundedRectangle(cornerRadius: 9))
            .opacity(configuration.isPressed ? 0.72 : 1)
            .contentShape(RoundedRectangle(cornerRadius: 9))
    }
}

struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 20) { content }
            .padding(22).frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.card)
            .clipShape(RoundedRectangle(cornerRadius: 17))
            .overlay(RoundedRectangle(cornerRadius: 17).stroke(Palette.border, lineWidth: 1))
            .shadow(color: Color(red: 0.29, green: 0.36, blue: 0.46).opacity(0.055), radius: 8, x: 0, y: 4)
    }
}

struct MainView: View {
    @ObservedObject var store: AppStore
    @FocusState private var focus: String?
    var body: some View {
        VStack(spacing: 17) {
            header
            Card {
                HStack(spacing: 10) {
                    Image(systemName: "cpu").foregroundStyle(Palette.blue).font(.system(size: 19, weight: .medium))
                    Text("Colab 算力实例").font(.system(size: 19, weight: .semibold))
                    Spacer()
                    Text(store.status).font(.system(size: 12, weight: .semibold))
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Palette.control.opacity(0.6)).clipShape(Capsule())
                }
                if store.user == nil { loginForm } else { deploymentControls }
                statusLine
            }
            quota
            if !store.error.isEmpty {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.circle").foregroundStyle(.red)
                    Text(store.error).font(.system(size: 12)).textSelection(.enabled)
                    Spacer(minLength: 0)
                    Button { store.error = "" } label: { Image(systemName: "xmark") }
                        .buttonStyle(.plain).accessibilityLabel("关闭错误提示")
                }.padding(.horizontal, 5)
            }
            HStack {
                Text(store.preview ? "界面预览 · 示例账号" : "MiniMax H3 · BF16").font(.system(size: 11))
                Spacer()
                Button("查看日志") { store.showLogs = true }.buttonStyle(.plain)
                Text("·")
                Button("打开弗淼 AIGC") { NSWorkspace.shared.open(URL(string: store.site)!) }.buttonStyle(.plain)
            }.font(.system(size: 11)).foregroundStyle(Palette.secondary).padding(.horizontal, 5)
        }
        .padding(.horizontal, 22).padding(.top, 15).padding(.bottom, 20)
        .frame(width: 556)
        .foregroundStyle(Palette.text)
        .background(Palette.background)
        .tint(Palette.blue).preferredColorScheme(.light)
        .sheet(isPresented: $store.authSheet) { googleSheet }
        .sheet(isPresented: $store.showLogs) { logSheet }
        .alert("释放 Colab 实例？", isPresented: $store.confirmRelease) {
            Button("取消", role: .cancel) { }
            Button("释放实例", role: .destructive) { store.release() }
        } message: {
            Text("将释放 FumiaoColab 创建的实例。进行中的任务会中断，已保存到弗淼的作品会保留。")
        }
        .onAppear { focus = "username" }
    }

    var header: some View {
        HStack {
            Text("FumiaoColab").font(.system(size: 16, weight: .semibold))
            Spacer()
            if store.user != nil {
                Menu {
                    Text("接入身份：\(store.userLabel)")
                    Button("退出弗淼账号") { store.logout() }.disabled(store.working)
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "person.crop.circle")
                        Text(store.userLabel).lineLimit(1)
                    }.font(.system(size: 12))
                }.menuStyle(.borderlessButton).frame(maxWidth: 180, alignment: .trailing)
            } else {
                Label("弗淼账号未登录", systemImage: "person.crop.circle").font(.system(size: 12)).foregroundStyle(Palette.secondary)
            }
        }.padding(.horizontal, 3).padding(.bottom, 2)
    }

    var loginForm: some View {
        VStack(alignment: .leading, spacing: 13) {
            Text("登录弗淼 AIGC").font(.system(size: 16, weight: .medium))
            Text("算力实例将登记到你的弗淼账号。").font(.system(size: 12)).foregroundStyle(Palette.secondary)
            field {
                TextField("用户名", text: $store.username, prompt: Text("用户名").foregroundColor(Palette.secondary)).textContentType(.username)
                    .focused($focus, equals: "username").onSubmit { focus = "password" }
            }
            field {
                SecureField("密码", text: $store.password, prompt: Text("密码").foregroundColor(Palette.secondary)).textContentType(.password)
                    .focused($focus, equals: "password").onSubmit { if canLogin { store.login() } }
            }
            Button { store.login() } label: {
                HStack(spacing: 8) {
                    if store.working { ProgressView().controlSize(.small) }
                    Text(store.working ? "正在登录…" : "登录")
                }.frame(maxWidth: .infinity)
            }.buttonStyle(SoftButton(primary: true)).disabled(!canLogin)
            Divider().overlay(Palette.border.opacity(0.3)).padding(.vertical, 2)
            HStack {
                Text("Google 账号").font(.system(size: 14)).foregroundStyle(Palette.secondary)
                Spacer()
                Text("登录弗淼后绑定").font(.system(size: 12)).foregroundStyle(Palette.secondary)
                Button("绑定") {}.buttonStyle(SoftButton()).disabled(true)
            }
        }
    }
    var canLogin: Bool { !store.username.trimmingCharacters(in: .whitespaces).isEmpty && !store.password.isEmpty && !store.working }

    var deploymentControls: some View {
        VStack(spacing: 17) {
            HStack(spacing: 10) {
                Text("Google 账号").foregroundStyle(Palette.secondary)
                Spacer(minLength: 4)
                Text(store.googleBound ? (store.hidePrivate ? "已绑定" : store.googleEmail) : "未绑定")
                    .lineLimit(1).truncationMode(.middle).font(.system(size: 13))
                if store.googleBound {
                    Button { store.hidePrivate.toggle() } label: {
                        Image(systemName: store.hidePrivate ? "eye.slash" : "eye")
                    }.buttonStyle(.plain).foregroundStyle(Palette.secondary)
                        .accessibilityLabel(store.hidePrivate ? "显示 Google 账号" : "隐藏 Google 账号")
                }
                Button(store.googleBound ? "更换" : "绑定") { store.bindGoogle() }
                    .buttonStyle(SoftButton()).disabled(store.working || store.deployed)
            }
            HStack {
                Text("部署模型").foregroundStyle(Palette.secondary)
                Spacer()
                Text("MiniMax H3").fontWeight(.medium)
            }
            HStack {
                Text("GPU 实例").foregroundStyle(Palette.secondary)
                Spacer()
                Picker("GPU 实例", selection: $store.gpu) {
                    Text("G4 · 96 GB").tag("G4")
                    Text("H100 · 80 GB").tag("H100")
                    Text("A100 · 高内存").tag("A100")
                }.labelsHidden().frame(width: 173).disabled(store.working || store.deployed)
            }
            if !store.nodeName.isEmpty && store.deployed {
                HStack {
                    Text("弗淼实例").foregroundStyle(Palette.secondary)
                    Spacer()
                    Text(store.nodeName).fontWeight(.medium)
                    Image(systemName: "link").foregroundStyle(Palette.blue)
                }
            }
            Button { store.deploy() } label: {
                HStack(spacing: 8) {
                    if store.working { ProgressView().controlSize(.small) }
                    else { Image(systemName: ["ready", "busy"].contains(store.nodeStage) ? "checkmark.circle" : "power") }
                    Text(store.deploymentLabel)
                }.frame(maxWidth: .infinity)
            }.buttonStyle(SoftButton(primary: true)).disabled(!store.googleBound || store.working || store.deployed || store.preview)
        }.font(.system(size: 14))
    }

    var statusLine: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle().fill(store.nodeStage == "ready" || store.nodeStage == "busy" ? Color.green : Color.orange)
                .frame(width: 8, height: 8).padding(.top, 4)
            Text(store.notice).font(.system(size: 12, weight: .medium)).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if store.user != nil {
                Button { Task { await store.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.plain).foregroundStyle(Palette.secondary).disabled(store.working || store.refreshing)
                    .accessibilityLabel("刷新实例状态")
            }
        }.accessibilityElement(children: .combine)
    }

    var quota: some View {
        Card {
            HStack(spacing: 10) {
                Image(systemName: "gauge.with.dots.needle.50percent").foregroundStyle(Palette.blue).font(.system(size: 19))
                Text("算力额度与自动休眠").font(.system(size: 19, weight: .semibold))
            }
            HStack(spacing: 0) {
                metric("剩余额度", store.balance.map { String(format: "%.2f", $0) } ?? "—", "CU")
                Divider().frame(height: 39)
                metric("扣费速率", store.burn.map { String(format: "%.2f", $0) } ?? "—", "CU/h")
                Divider().frame(height: 39)
                metric("本次运行", store.elapsed, "")
            }.padding(.vertical, 5)
            HStack {
                Text("闲置自动释放").foregroundStyle(Palette.secondary).font(.system(size: 14))
                Spacer()
                Picker("闲置自动释放", selection: Binding(get: { store.idle }, set: { store.setIdle($0) })) {
                    Text("15 分钟").tag(15); Text("30 分钟").tag(30)
                    Text("60 分钟").tag(60); Text("不自动释放").tag(0)
                }.labelsHidden().frame(width: 140).disabled(store.user == nil || store.working)
            }
            Button { store.confirmRelease = true } label: {
                Label("释放实例", systemImage: "power").frame(maxWidth: .infinity)
            }.buttonStyle(SoftButton()).disabled(!store.deployed || store.working || store.preview)
        }
    }

    func metric(_ title: String, _ value: String, _ unit: String) -> some View {
        VStack(spacing: 7) {
            Text(title).font(.system(size: 12)).foregroundStyle(Palette.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(.system(size: 19, weight: .semibold)).monospacedDigit()
                if !unit.isEmpty { Text(unit).font(.system(size: 11, weight: .medium)) }
            }.lineLimit(1).minimumScaleFactor(0.8)
        }.frame(maxWidth: .infinity)
    }
    func field<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content().textFieldStyle(.plain).font(.system(size: 14)).padding(.horizontal, 11).frame(height: 39)
            .background(Color.white).clipShape(RoundedRectangle(cornerRadius: 9))
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Palette.border.opacity(0.65)))
    }

    var googleSheet: some View {
        VStack(alignment: .leading, spacing: 17) {
            Text("绑定 Google 账号").font(.system(size: 20, weight: .semibold))
            Text("在浏览器中完成 Google 授权，再将授权码粘贴到这里。").font(.system(size: 13)).foregroundStyle(Palette.secondary)
            field { SecureField("Google 授权码", text: $store.authCode, prompt: Text("Google 授权码").foregroundColor(Palette.secondary)).onSubmit { if !store.authCode.isEmpty { store.finishGoogle() } } }
            if !store.error.isEmpty { Text(store.error).font(.system(size: 12)).foregroundStyle(.red) }
            HStack {
                Button("重新打开授权页") { if let url = store.authURL { NSWorkspace.shared.open(url) } }.buttonStyle(.plain).foregroundStyle(Palette.blue)
                Spacer()
                Button("取消") { store.authSheet = false }.buttonStyle(SoftButton()).disabled(store.working)
                Button(store.working ? "验证中…" : "完成绑定") { store.finishGoogle() }
                    .buttonStyle(SoftButton(primary: true)).disabled(store.authCode.isEmpty || store.working)
            }
        }.padding(25).frame(width: 460).background(Palette.card)
    }

    var logSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("部署日志").font(.system(size: 19, weight: .semibold))
                Spacer(); Button("完成") { store.showLogs = false }.buttonStyle(SoftButton())
            }
            ScrollView {
                Text(store.logs.isEmpty ? "暂无部署记录" : store.logs.joined(separator: "\n"))
                    .font(.system(size: 12, design: .monospaced)).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }.frame(height: 260)
        }.padding(24).frame(width: 490).background(Palette.card)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    @MainActor var store = AppStore()
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        let view = MainView(store: store)
        let hosting = NSHostingView(rootView: view)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 556, height: 730),
            styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "FumiaoColab"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(red: 0.906, green: 0.925, blue: 0.954, alpha: 1)
        window.contentView = hosting
        window.setContentSize(hosting.fittingSize)
        window.center(); window.makeKeyAndOrderFront(nil)
        let menu = NSMenu(), appMenu = NSMenu(), item = NSMenuItem()
        appMenu.addItem(withTitle: "关于 FumiaoColab", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 FumiaoColab", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = appMenu; menu.addItem(item)
        let edit = NSMenu(title: "编辑"), editItem = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit; menu.addItem(editItem); NSApp.mainMenu = menu
        NSApp.activate(ignoringOtherApps: true)
        store.start()
        if let index = CommandLine.arguments.firstIndex(of: "--capture"), CommandLine.arguments.count > index + 1 {
            let target = CommandLine.arguments[index + 1]
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                hosting.layoutSubtreeIfNeeded()
                if let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) {
                    hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
                    try? bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: target))
                }
                NSApp.terminate(nil)
            }
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main struct FumiaoColab {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate(); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
