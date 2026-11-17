# ADR 0003: Đánh giá từ session log của upstream

Trạng thái: đã chấp nhận

## Bối cảnh

Evaluation cần biết tool nào đã chạy, có lỗi không, đã retrieve được gì, mỗi step mất bao lâu và dùng bao nhiêu token. Upstream đã append từng thông tin này vào một log bền vững cho mỗi session.

## Quyết định

Không thêm event store thứ hai. `map-core` chuyển log sang JSONL thường trong root riêng, và evaluation runner suy ra mọi metric từ `tool/call`, `tool/result`, `assistant/message`, `turn/*`, `step/*` và `permission/preset`. Log của mỗi lần chạy được copy cạnh báo cáo làm trace.

## Hệ quả

- Không có code instrumentation phải bảo trì, và metric mô tả đúng những gì model đã thấy.
- Log thường lớn hơn kiểu nén mặc định của upstream và cần root riêng, vì một root chỉ chứa một kiểu mã hóa.
- Runner phụ thuộc vào tên event và các trường payload của upstream; thay đổi session format sẽ làm hỏng `trace.ts` và bị test evaluation scripted phát hiện.
- Replay một log chỉ dựng lại lịch sử. Nó không chạy lại tool, nên so sánh hành vi giữa các phiên bản cần chạy mới.
