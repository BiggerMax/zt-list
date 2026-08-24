import AppKit

let projectDir = "/Users/yuanjie/Documents/work/ZTList/zt-app"
let port = "5188"
let urlString = "http://localhost:\(port)"
let logPath = (NSTemporaryDirectory() as NSString).appendingPathComponent("ztlist-launcher.log")

func appendLog(_ message: String) {
    let line = "[ZTList] \(Date()) \(message)\n"
    if let handle = FileHandle(forWritingAtPath: logPath) {
        handle.seekToEndOfFile()
        handle.write(line.data(using: .utf8)!)
        try? handle.close()
    } else {
        try? line.write(toFile: logPath, atomically: true, encoding: .utf8)
    }
}

@discardableResult
func shell(_ command: String, wait: Bool = true) -> Process {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/bash")
    process.arguments = ["-c", command]
    do {
        try process.run()
    } catch {
        appendLog("命令执行失败: \(command) — \(error.localizedDescription)")
        return process
    }
    if wait { process.waitUntilExit() }
    return process
}

func serverRunning() -> Bool {
    let process = shell(
        "curl -s -o /dev/null -w '%{http_code}' \(urlString) --max-time 2 | grep -q 200",
        wait: true
    )
    return process.terminationStatus == 0
}

func openBrowser() {
    if let url = URL(string: urlString) {
        NSWorkspace.shared.open(url)
        appendLog("已打开浏览器 \(urlString)")
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.global(qos: .userInitiated).async {
            if serverRunning() {
                appendLog("dev server 已在运行 (\(urlString))")
            } else {
                appendLog("启动 dev server...")
                let pathEnv = "export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH"
                shell("\(pathEnv) && cd '\(projectDir)' && nohup npm run dev >> '\(logPath)' 2>&1 &", wait: false)
                var ready = false
                for _ in 0..<60 {
                    if serverRunning() { ready = true; break }
                    Thread.sleep(forTimeInterval: 1)
                }
                if !ready {
                    appendLog("错误: dev server 启动超时")
                    DispatchQueue.main.async {
                        let alert = NSAlert()
                        alert.messageText = "ZTList 启动失败"
                        alert.informativeText = "请检查日志: \(logPath)"
                        alert.runModal()
                        NSApp.terminate(nil)
                    }
                    return
                }
                appendLog("dev server 就绪")
            }
            DispatchQueue.main.async { openBrowser() }
        }
    }

    // 运行中再次点击 Dock 图标：重新打开页面
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openBrowser()
        return true
    }

    // 退出应用时停止 dev server、释放端口
    func applicationWillTerminate(_ notification: Notification) {
        appendLog("退出，停止 dev server 并释放端口 \(port)...")
        shell("lsof -ti tcp:\(port) | xargs kill 2>/dev/null; pkill -f 'next dev -p \(port)' 2>/dev/null", wait: true)
        appendLog("已释放端口 \(port)")
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
