// Lanzador nativo. Solo termina el servidor que él mismo ha creado.
import AppKit
import CryptoKit
import Darwin

// Foundation puede abreviar /private/tmp a /tmp; Node usa realpath de POSIX.
// Compartimos la misma ruta física para el identificador y el aislamiento de QA.
func physicalPath(_ path: String) -> String {
    if let resolved = Darwin.realpath(path, nil) {
        defer { free(resolved) }
        return String(cString: resolved)
    }
    return path
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var child: Process?
    var output = ""
    var outputBytes = Data()
    var qaWindow: NSWindow?
    var appURL: URL?
    var statusItem: NSStatusItem?
    var quitting = false
    var lockFD: Int32 = -1
    // --qa-data-dir solo acepta una carpeta temporal y fuerza los ajustes de prueba.
    var environment: [String: String] = {
        var env = ProcessInfo.processInfo.environment
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--qa-data-dir"), i + 1 < args.count {
            let path = physicalPath(args[i + 1])
            let temp = physicalPath(NSTemporaryDirectory()).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let tempPrefix = "/" + temp + "/"
            guard path.hasPrefix(tempPrefix) || path.hasPrefix("/private/tmp/pyme1-") else { fatalError("QA necesita una carpeta temporal.") }
            env["PYME1_DATA_DIR"] = path; env["PYME1_SECRETS"] = "memory"; env["PYME1_PORT"] = "4390"
        }
        return env
    }()
    var dataDir: String {
        physicalPath(environment["PYME1_DATA_DIR"] ?? NSHomeDirectory() + "/Library/Application Support/Pyme1")
    }
    var instance: String { SHA256.hash(data: Data(dataDir.utf8)).map { String(format: "%02x", $0) }.joined() }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appMenu = NSMenu()
        let rootItem = NSMenuItem(); rootItem.submenu = appMenu; menu.addItem(rootItem)
        appMenu.addItem(withTitle: "Abrir REM", action: #selector(openApp), keyEquivalent: "o").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Cerrar REM", action: #selector(quit), keyEquivalent: "q").target = self
        NSApp.mainMenu = menu
        if CommandLine.arguments.contains("--qa-data-dir") {
            // Ventana solo para poder verificar Cmd+Q y el Dock mediante accesibilidad.
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 120), styleMask: [.titled, .closable], backing: .buffered, defer: false)
            window.title = "REM · Prueba aislada"
            let label = NSTextField(labelWithString: "Prueba local con datos temporales.\nEl servidor usa el puerto 4390 o el siguiente libre.")
            label.frame = NSRect(x: 20, y: 30, width: 380, height: 60)
            window.contentView?.addSubview(label); window.center(); window.orderFront(nil); qaWindow = window
        }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem?.button?.image = NSImage(systemSymbolName: "seal.fill", accessibilityDescription: "REM")
        statusItem?.button?.toolTip = "REM"
        statusItem?.menu = appMenu.copy() as? NSMenu
        // flock se libera incluso con SIGKILL. Evita dos lanzadores del mismo almacén.
        do { try FileManager.default.createDirectory(atPath: dataDir, withIntermediateDirectories: true) }
        catch { fail("No se puede abrir la carpeta de datos."); return }
        lockFD = Darwin.open(dataDir + "/.launcher.lock", O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
        guard lockFD >= 0 else { fail("No se puede bloquear el arranque."); return }
        let ownsLock = flock(lockFD, LOCK_EX | LOCK_NB) == 0
        DispatchQueue.global(qos: .userInitiated).async {
            if let url = self.findExisting() {
                DispatchQueue.main.async { self.appURL = url; self.openApp(); NSApp.terminate(nil) }
            } else if !ownsLock {
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                    DispatchQueue.global().async {
                        let url = self.findExisting()
                        DispatchQueue.main.async { if let url { self.appURL = url; self.openApp(); NSApp.terminate(nil) } else { self.fail("REM se está iniciando. Vuelve a abrirlo dentro de unos segundos.") } }
                    }
                }
            } else {
                let node = self.findNode()
                DispatchQueue.main.async { if let node { self.startNode(node) } else { self.missingNode() } }
            }
        }
    }
    func findExisting() -> URL? {
        let first = Int(environment["PYME1_PORT"] ?? "4317") ?? 4317
        for port in first...(first + 10) {
            guard let url = URL(string: "http://127.0.0.1:\(port)/") else { continue }
            let done = DispatchSemaphore(value: 0)
            var found = false
            var request = URLRequest(url: url); request.timeoutInterval = 0.3
            URLSession.shared.dataTask(with: request) { _, response, _ in
                if let r = response as? HTTPURLResponse {
                    found = r.statusCode == 200 && r.value(forHTTPHeaderField: "X-Pyme1-Instance") == self.instance
                }
                done.signal()
            }.resume()
            let completed = done.wait(timeout: .now() + 0.5) == .success
            if completed && found { return url }
        }
        return nil
    }
    func findNode() -> String? {
        let shell = Process(); shell.executableURL = URL(fileURLWithPath: "/bin/zsh"); shell.arguments = ["-lc", "command -v node"]
        let pipe = Pipe(); shell.standardOutput = pipe; shell.standardError = FileHandle.nullDevice
        var candidates: [String] = []
        if (try? shell.run()) != nil {
            DispatchQueue.global().asyncAfter(deadline: .now() + 3) { if shell.isRunning { shell.terminate() } }
            let bytes = pipe.fileHandleForReading.readDataToEndOfFile(); shell.waitUntilExit()
            if let path = String(data: bytes, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines), !path.isEmpty { candidates.append(path) }
        }
        candidates += ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/opt/homebrew/opt/node@24/bin/node", "/opt/homebrew/opt/node@22/bin/node"]
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }
    func startNode(_ node: String) {
        guard let resources = Bundle.main.resourceURL else { fail("Faltan los archivos de la app."); return }
        let process = Process(); child = process
        process.executableURL = URL(fileURLWithPath: node)
        process.currentDirectoryURL = resources
        process.arguments = ["--disable-warning=ExperimentalWarning", "src/server.js"]
        var env = environment
        env["PATH"] = URL(fileURLWithPath: node).deletingLastPathComponent().path + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + (environment["PATH"] ?? "")
        process.environment = env
        let pipe = Pipe(); process.standardOutput = pipe; process.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            DispatchQueue.main.async {
                self.outputBytes.append(data)
                self.outputBytes = Data(self.outputBytes.suffix(8192))
                self.output = String(decoding: self.outputBytes, as: UTF8.self)
                if self.appURL == nil, let range = self.output.range(of: "REM está funcionando en ") {
                    let tail = self.output[range.upperBound...]
                    if let end = tail.firstIndex(of: "\n"), let url = URL(string: String(tail[..<end])), url.host == "127.0.0.1" { self.appURL = url; self.openApp() }
                }
            }
        }
        process.terminationHandler = { process in
            pipe.fileHandleForReading.readabilityHandler = nil
            DispatchQueue.main.async {
                if self.quitting { NSApp.reply(toApplicationShouldTerminate: true) }
                else if process.terminationStatus != 0 { self.fail("El servidor no pudo arrancar. Comprueba que Node.js sea 22.13 o superior.") }
                else { NSApp.terminate(nil) }
            }
        }
        do { try process.run() } catch { fail("No se pudo arrancar Node.js.") }
    }
    @objc func openApp() { if let appURL { NSWorkspace.shared.open(appURL) } }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { openApp(); return false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let child, child.isRunning else { return .terminateNow }
        if !quitting {
            quitting = true; child.terminate()
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
                if child.isRunning { Darwin.kill(child.processIdentifier, SIGKILL) }
            }
        }
        return .terminateLater
    }
    func applicationWillTerminate(_ notification: Notification) { if lockFD >= 0 { Darwin.close(lockFD) } }
    func fail(_ message: String) {
        let alert = NSAlert(); alert.messageText = "REM"; alert.informativeText = message; alert.runModal(); NSApp.terminate(nil)
    }
    func missingNode() {
        let alert = NSAlert(); alert.messageText = "Instala Node.js para abrir REM"
        alert.informativeText = "Necesitas Node.js 22.13 o superior. Instálalo y vuelve a abrir REM."
        alert.addButton(withTitle: "Ir a nodejs.org"); alert.addButton(withTitle: "Cerrar")
        if alert.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.open(URL(string: "https://nodejs.org")!) }
        NSApp.terminate(nil)
    }
}
let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
