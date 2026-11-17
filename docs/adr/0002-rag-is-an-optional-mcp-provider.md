# ADR 0002: Chỉ tiếp cận retrieval qua MCP, như một provider tùy chọn

Trạng thái: đã chấp nhận

## Bối cảnh

Một dịch vụ retrieval viết bằng Python tồn tại riêng và chưa hoàn thiện. Import stack của nó vào Node runtime, hoặc bắt agent phụ thuộc vào nó lúc khởi động, sẽ khiến lỗi của retrieval chặn cả những task không hề cần retrieval.

## Quyết định

Dịch vụ retrieval là một row MCP client trong bundle riêng, `map-rag`. Gỡ bundle, dừng dịch vụ, hay một lệnh gọi lỗi đều để lại một agent vẫn hoạt động. Phát triển và test dùng mock MCP server có cùng hai tool; V1 không yêu cầu dịch vụ thật.

## Hệ quả

- Agent có ba trạng thái trình diễn được: không retrieval, retrieval sẵn sàng, retrieval lỗi.
- MCP client ở commit pin không có bộ lọc theo từng tool, nên việc ẩn và từ chối `sync_documents` cần một plugin policy.
- Mock xếp hạng một corpus sáu đoạn theo số từ trùng. Kết quả không nói gì về recall hay chất lượng metadata của dịch vụ thật.
- Contract evidence đề xuất chưa được đối chiếu với dịch vụ thật; vì vậy `evidence.ts` chấp nhận nhiều tên trường và cả văn bản không cấu trúc.
