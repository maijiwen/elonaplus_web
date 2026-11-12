import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * ElonaPlus Web 重制版 —— Java 后端（零依赖，仅用 JDK 内置 HttpServer）
 *
 * 职责：
 *   1. 静态资源托管：把 web/ 目录作为站点根目录（含 HTML/JS/CSS/data/assets）
 *   2. 存档服务：GET/POST /api/save/{slot}，存档以 JSON 文件形式存于 saves/ 目录
 *
 * 启动：java -cp server/out ElonaServer [端口] [web目录] [存档目录]
 * 默认：端口 8080，web 目录 ../web，存档目录 ../saves
 */
public class ElonaServer {

    private static Path webRoot;
    private static Path saveDir;

    public static void main(String[] args) throws IOException {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 8080;
        webRoot = Paths.get(args.length > 1 ? args[1] : "../web").toAbsolutePath().normalize();
        saveDir = Paths.get(args.length > 2 ? args[2] : "../saves").toAbsolutePath().normalize();
        Files.createDirectories(saveDir);

        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/api/", ElonaServer::handleApi);
        server.createContext("/", ElonaServer::handleStatic);
        server.setExecutor(null);
        server.start();

        System.out.println("ElonaPlus Web 服务已启动: http://localhost:" + port + "/");
        System.out.println("  站点根目录: " + webRoot);
        System.out.println("  存档目录  : " + saveDir);
    }

    // ---------------- API ----------------

    private static void handleApi(HttpExchange ex) throws IOException {
        String path = ex.getRequestURI().getPath();
        String method = ex.getRequestMethod();
        // 允许页面由其它静态服务器（IDE 预览 / Live Server）打开时跨域调用本机存档服务
        ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        ex.getResponseHeaders().set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
        ex.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
        try {
            if (method.equals("OPTIONS")) {
                ex.sendResponseHeaders(204, -1);
                return;
            }
            if (path.equals("/api/ping")) {
                sendText(ex, 200, "{\"ok\":true,\"server\":\"elona-web\",\"version\":1}");
                return;
            }
            if (path.equals("/api/saves") && method.equals("GET")) {
                List<String> files = new ArrayList<>();
                try (Stream<Path> s = Files.list(saveDir)) {
                    files = s.filter(p -> p.getFileName().toString().endsWith(".json"))
                             .map(p -> p.getFileName().toString().replace(".json", ""))
                             .sorted()
                             .collect(Collectors.toList());
                }
                StringBuilder sb = new StringBuilder("[");
                for (int i = 0; i < files.size(); i++) {
                    if (i > 0) sb.append(',');
                    String slot = files.get(i);
                    Path f = saveDir.resolve(slot + ".json");
                    long t = Files.getLastModifiedTime(f).toMillis();
                    sb.append("{\"slot\":\"").append(escape(slot)).append("\",\"time\":").append(t).append("}");
                }
                sb.append(']');
                sendText(ex, 200, sb.toString());
                return;
            }
            if (path.startsWith("/api/save/")) {
                String slot = sanitize(path.substring("/api/save/".length()));
                if (slot.isEmpty()) { sendText(ex, 400, "{\"error\":\"bad slot\"}"); return; }
                Path f = saveDir.resolve(slot + ".json");
                if (method.equals("GET")) {
                    if (!Files.exists(f)) { sendText(ex, 404, "{\"error\":\"not found\"}"); return; }
                    sendText(ex, 200, new String(Files.readAllBytes(f), StandardCharsets.UTF_8));
                    return;
                }
                if (method.equals("POST")) {
                    byte[] body = readAll(ex);
                    Files.write(f, body);   // 覆盖写入
                    sendText(ex, 200, "{\"ok\":true}");
                    return;
                }
                if (method.equals("DELETE")) {
                    Files.deleteIfExists(f);
                    sendText(ex, 200, "{\"ok\":true}");
                    return;
                }
            }
            sendText(ex, 404, "{\"error\":\"unknown api\"}");
        } catch (Exception e) {
            sendText(ex, 500, "{\"error\":\"" + escape(String.valueOf(e.getMessage())) + "\"}");
        }
    }

    // ---------------- 静态文件 ----------------

    private static void handleStatic(HttpExchange ex) throws IOException {
        String path = ex.getRequestURI().getPath();
        if (path.equals("/")) path = "/index.html";
        Path target = webRoot.resolve(path.substring(1)).normalize();
        if (!target.startsWith(webRoot) || !Files.exists(target) || Files.isDirectory(target)) {
            sendText(ex, 404, "404 Not Found");
            return;
        }
        byte[] data = Files.readAllBytes(target);
        ex.getResponseHeaders().set("Content-Type", contentType(target));
        ex.getResponseHeaders().set("Cache-Control", "no-cache");
        ex.sendResponseHeaders(200, data.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(data); }
    }

    private static String contentType(Path p) {
        String n = p.getFileName().toString().toLowerCase();
        if (n.endsWith(".html")) return "text/html; charset=utf-8";
        if (n.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (n.endsWith(".css")) return "text/css; charset=utf-8";
        if (n.endsWith(".json")) return "application/json; charset=utf-8";
        if (n.endsWith(".bmp")) return "image/bmp";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".wav")) return "audio/wav";
        if (n.endsWith(".mid") || n.endsWith(".midi")) return "audio/midi";
        if (n.endsWith(".mp3")) return "audio/mpeg";
        return "application/octet-stream";
    }

    // ---------------- 工具 ----------------

    private static byte[] readAll(HttpExchange ex) throws IOException {
        return ex.getRequestBody().readAllBytes();
    }

    private static void sendText(HttpExchange ex, int code, String body) throws IOException {
        byte[] data = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(code, data.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(data); }
    }

    /** 只允许字母数字与 _ - 作为槽位名，避免路径穿越 */
    private static String sanitize(String s) {
        return s.replaceAll("[^A-Za-z0-9_\\-]", "");
    }

    private static String escape(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
