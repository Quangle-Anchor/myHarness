# ADR 0005: Phát hành single agent; quyết định orchestration dựa trên số đo

Trạng thái: đã chấp nhận

## Bối cảnh

Upstream có sẵn các tool sub-agent, team và workflow. Chúng làm tăng chi phí, độ trễ và số kiểu lỗi, trong khi V1 chưa có số đo nào cho thấy chúng giúp ích trên các task của mình.

## Quyết định

Tắt các tool delegation, team và workflow ở mọi profile. V1 là một agent với các tool file, search, shell và retrieval tùy chọn. Xem xét lại khi evaluation có những task mà một agent đơn lẻ thất bại vì thiếu khả năng chia nhỏ công việc.

## Hệ quả

- Trace tuyến tính và mọi tool call thuộc về một session, giúp việc chấm điểm đơn giản.
- Task dài nhiều phần dựa vào một context window và cơ chế compaction của upstream.
- Bật lại orchestration chỉ là thay đổi cấu hình, vì các plugin là của upstream và chỉ đang bị tắt.
