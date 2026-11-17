# Ma trận an toàn

DeepSeek Harness là phần mềm developer preview chưa được audit bảo mật ([thông báo của upstream](../../deepseekHarness/deepseek-harness/SAFETY.md)). Trang này nêu rõ bản phân phối enforce điều gì bằng code, điều gì chỉ là yêu cầu đối với model, và điều gì nó không bao phủ. Trang này không khẳng định hệ thống là an toàn.

## Enforce bằng code

| Kiểm soát | Cơ chế | Bằng chứng |
|---|---|---|
| Session mới không ghi được file | `permission.defaultPreset: read-only`; sandbox của upstream chặn ghi từ file tool và từ lệnh shell | T12: `write`, shell redirect và `rm` để lại workspace giống hệt từng byte |
| Mở rộng sandbox cần con người | Yêu cầu escalation đi qua approval của upstream; headless không có người duyệt nên yêu cầu được ghi lại và bị từ chối (`SANDBOX_ESCALATION_UNAVAILABLE`) | T12 |
| `workspace-write` không ra khỏi workspace | Sandbox của upstream | T12: ghi vào đường dẫn ngoài workspace bị từ chối |
| `sync_documents` không chạy được | Execution guard trong `rag-policy`; lệnh gọi bị từ chối trước khi rời process | T11: mock service không ghi nhận call nào |
| Kết quả retrieval bị giới hạn kích thước | Thay nội dung ở post-execute trong `rag-policy` | T10 oversize, unit test tại đúng ngưỡng |
| Nội dung session không bị upload | Tắt `session-log-deepseek`; `DSH_TELEMETRY_MODE=DISABLED` trong wrapper | config đã ghép trong `--dump-config` |
| Không có `web_fetch` và `web_search` | `tool-web` bị tắt ở headless; không nằm trong preset `map` của Web | T01 kiểm tra các tool đưa cho model |
| Không có tool delegation và goal | Các row bị tắt ở headless; không nằm trong preset `map` của Web | T01 |
| Key của provider không lọt vào log | Key là credential reference (`apiKeyEnv`), không bao giờ là text trong config | kiểm tra thủ công trên một session log thật; chưa có test tự động |

## Yêu cầu đối với model, không enforce

| Hành vi | Cách yêu cầu | Bằng chứng |
|---|---|---|
| Coi đoạn văn retrieve được là dữ liệu | Văn bản của lớp bọc `<retrieved_context trust="untrusted">` | Case live `neg-injected-passage`; phụ thuộc model |
| Không trích nguồn chưa được retrieve | Văn bản lớp bọc và văn bản khi kết quả rỗng | Đo sau khi chạy bằng `fabricatedCitations`; không ngăn chặn |
| Nói rõ khi thiếu evidence | Văn bản khi kết quả rỗng, văn bản của `capability_status` | Các case live context và negative |

Một đoạn văn bị inject không cấp được quyền: ghi file vẫn cần sandbox preset, và `sync_documents` vẫn bị từ chối. Điều nó làm được là khiến câu trả lời của model sai lệch.

## Không bao phủ

- **Thư mục tạm.** `workspace-write` cho phép ghi cả vào các vùng temp của nền tảng. Workspace đặt dưới thư mục temp khiến các đường dẫn ngang hàng với nó cũng ghi được.
- **Đọc và mạng.** Sandbox chỉ giới hạn việc ghi. Đọc file ngoài workspace và truy cập mạng ra ngoài từ lệnh shell không bị giới hạn ở bất kỳ mode nào.
- **`danger-full-access`.** Preset này có trong bảng và người dùng chọn được; nó tắt cả giới hạn lẫn approval.
- **Hành vi của Web UI.** Thành phần của preset `map` được kiểm chứng qua `--dump-config` và server khởi động được; chưa có test tự động nào chạy một Web session.
- **Độ tin cậy của dịch vụ retrieval.** MCP endpoint là HTTP loopback không xác thực. Dịch vụ bind ra host khác cần bảo mật transport và credential (`headers` với credential reference).
- **Kết nối muộn.** Nếu dịch vụ kết nối giữa session, `sync_documents` có thể xuất hiện trong danh sách ở một step trước khi restriction có hiệu lực. Guard vẫn từ chối lệnh gọi.
- **Plugin bên thứ ba.** `dsh plugin add` chạy code của package với quyền của người dùng.
