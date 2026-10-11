import Foundation

/// Hintergrund-Upload (`URLSession` mit App-Group-Container): Anfragekörper liegen als Dateien im gemeinsamen
/// Container, die Übertragung überlebt das Schliessen des Blatts.
final class ShareUploader: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    struct Outcome {
        var status: Int?
        var data: Data
        var error: Error?
    }

    var onProgress: ((_ itemID: String, _ fraction: Double) -> Void)?
    var onFinish: ((_ itemID: String, _ outcome: Outcome) -> Void)?

    private var received: [Int: Data] = [:]
    private let lock = NSLock()

    private lazy var session: URLSession = {
        let id = "\(SharedConfig.keychainService).share.\(UUID().uuidString)"
        let config = URLSessionConfiguration.background(withIdentifier: id)
        config.sharedContainerIdentifier = SharedConfig.appGroup
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = false
        config.waitsForConnectivity = true
        config.timeoutIntervalForResource = 10 * 60
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    func upload(itemID: String, bodyFile: URL, request: URLRequest) {
        let task = session.uploadTask(with: request, fromFile: bodyFile)
        task.taskDescription = itemID
        task.resume()
    }

    func cancelAll() {
        session.getAllTasks { $0.forEach { $0.cancel() } }
    }

    // MARK: Delegate

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard let id = task.taskDescription, totalBytesExpectedToSend > 0 else { return }
        onProgress?(id, Double(totalBytesSent) / Double(totalBytesExpectedToSend))
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock(); received[dataTask.taskIdentifier, default: Data()].append(data); lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = task.taskDescription else { return }
        lock.lock(); let data = received.removeValue(forKey: task.taskIdentifier) ?? Data(); lock.unlock()
        let status = (task.response as? HTTPURLResponse)?.statusCode
        onFinish?(id, Outcome(status: status, data: data, error: error))
    }
}
