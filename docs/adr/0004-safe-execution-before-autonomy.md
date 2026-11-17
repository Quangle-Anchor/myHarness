# ADR 0004: Khởi đầu read-only và enforce policy tại executor

Trạng thái: đã chấp nhận

## Bối cảnh

Upstream mặc định cho ghi vào workspace, bật các web tool bỏ qua approval, và upload session log. Dịch vụ retrieval có một tool dựng lại index. Bảo model đừng làm điều gì đó không phải là một cơ chế kiểm soát.

## Quyết định

Session mới dùng preset `read-only`. Web tool, tool delegation, tool goal và upload log đều tắt. `sync_documents` bị từ chối bằng execution guard và đồng thời bị ẩn. Văn bản retrieve được bị giới hạn kích thước và bọc như dữ liệu không tin cậy. Mỗi kiểm soát có một test kiểm tra workspace hoặc bản ghi call của dịch vụ, không dựa vào câu trả lời của model.

## Hệ quả

- Demo mặc định không thay đổi được file; muốn ghi phải chủ động đổi preset.
- Các task cần web hoặc sub-agent nằm ngoài phạm vi V1.
- Các yêu cầu ở mức prompt (bỏ qua chỉ dẫn bị inject, không bịa citation) vẫn phụ thuộc model. Chúng được evaluation đo và được liệt kê riêng trong ma trận an toàn.
- Sandbox chỉ giới hạn việc ghi; đọc file và truy cập mạng từ lệnh shell không bị giới hạn.
