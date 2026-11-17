# Triển khai local

## Điều kiện cần

- Node 24.9 trở lên.
- Checkout upstream đã build, ở commit pin: xem [UPSTREAM.md](../UPSTREAM.md).
- Gemini API key để chạy với model thật. Test không cần key thì không cần gì thêm.

## Cài đặt

```sh
cp .env.example .env                 # rồi điền GEMINI_API_KEY
./scripts/setup-profiles.sh          # tạo bốn profile trong .dsh-home/
node scripts/doctor.ts               # kiểm tra node, checkout, build, key, profile, retrieval endpoint
```

`scripts/dsh.sh` là launcher duy nhất. Nó chạy CLI của upstream với `DSH_HOME=.dsh-home` (không bao giờ dùng `~/.dsh`), nạp `.env` mà không ghi đè biến đã có, tắt upload telemetry, và cung cấp pnpm qua corepack khi máy chưa cài. Thư mục nơi nó được gọi chính là workspace của agent.

`setup-profiles.sh` dựng lại các profile từ template upstream mỗi lần chạy; `cordis.patch.yml` riêng của profile (thiết lập lưu từ Web UI) sẽ mất khi chạy script này.

## Chạy

```sh
cd /path/to/a/project

# Một task, không retrieval
/path/to/agent-platform/scripts/dsh.sh --profile map-core-headless "Explain how sessions are verified."

# Web UI, không retrieval
/path/to/agent-platform/scripts/dsh.sh --profile map-core            # in ra URL kèm access token

# Với mock retrieval service
node /path/to/agent-platform/mock-rag/server.ts &                    # 127.0.0.1:8001
/path/to/agent-platform/scripts/dsh.sh --profile map-rag-headless "What is the refund ceiling for a lost parcel?"
```

Ghi file cần permission preset rộng hơn: `--permission-mode workspace-write` với headless, hoặc bộ chọn Permissions trên Web UI.

## Kết nối dịch vụ retrieval thật

Row `mcp-rag` trong `bundles/rag/cordis.patch.yml` đọc endpoint từ `MAP_RAG_URL` và dùng Streamable HTTP. Với FastMCP server chỉ hỗ trợ stdio, thay các trường transport của row trong `cordis.patch.yml` của profile:

```yaml
- id: mcp-rag
  config:
    serverName: rag
    transport: stdio
    command: /path/to/rag/.venv/bin/python
    args: ['-m', 'rag_server']
    cwd: /path/to/rag
    failOnStartupError: false
    toolCallTimeoutMs: 20000
```

Giữ `serverName: rag`: plugin policy và `capability_status` suy ra tên tool từ giá trị này. Nếu định dạng kết quả của dịch vụ khác contract đề xuất, `bundles/rag/src/evidence.ts` đã chấp nhận `text`/`content`/`page_content`, `chunk_id`/`id`, `location`/`section`, mảng trần và văn xuôi thuần; với dạng khác thì mở rộng hàm `normalize` ở đó. Dịch vụ thật chưa được kết nối hay test.

## Tham chiếu cấu hình

| Biến | Mặc định | Tác dụng |
|---|---|---|
| `GEMINI_API_KEY` | không có | Credential của provider |
| `MAP_MODEL` | `gemini-3.1-flash-lite` | Model mặc định của session mới |
| `MAP_RAG_URL` | `http://127.0.0.1:8001/mcp` | Retrieval endpoint |
| `MAP_RAG_TIMEOUT_MS` | `20000` | Deadline của một lệnh gọi retrieval |
| `MAP_RAG_STARTUP_TIMEOUT_MS` | `5000` | Deadline của kết nối lúc khởi động |
| `DSH_BASE` | `../deepseekHarness/deepseek-harness` | Checkout upstream |
| `DSH_HOME` | `.dsh-home` | Profile, session, storage |

Các giới hạn của policy (`maxEvidence`, `maxEvidenceChars`, `maxTotalChars`, `deniedTools`) là trường `config` của row `map-rag-policy`.

## Ràng buộc đã biết

- **Gemini free tier cho phép 15 request mỗi phút** với model này. Request bị từ chối kết thúc turn với mã `QUOTA`. Evaluation runner tự giãn tốc độ (`--rpm`); dùng tương tác vượt mức đó cần gói trả phí hoặc model khác.
- **Bản build upstream cũ làm hỏng profile `web`.** Build lại sau khi pull.
- **Một session root chỉ chứa một kiểu mã hóa log.** Bản phân phối này ghi log thường vào `sessions-plain/`; session do profile upstream trần ghi nằm ở `sessions/` và các profile này không thấy chúng.
