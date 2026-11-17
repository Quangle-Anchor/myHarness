# ADR 0001: Dựng trên DeepSeek Harness thay vì tự viết agent runtime

Trạng thái: đã chấp nhận

## Bối cảnh

Dự án cần một agent gọi tool qua nhiều bước, hỏi trước khi làm việc rủi ro, ghi lại những gì đã làm, và mở rộng được. Tự viết loop, tool pipeline, sandbox, session store và UI sẽ ngốn hết thời gian và cho ra một bản sao yếu hơn của thứ đã có.

## Quyết định

Dùng một checkout DeepSeek Harness không sửa, pin ở một commit, làm runtime. Mọi thứ dự án thêm vào là bundle (một file patch cùng các module plugin) cài vào profile bằng `dsh plugin add`. Không file nào trong checkout bị chỉnh; có một test khẳng định `git status` sạch.

## Hệ quả

- Công sức dồn vào policy, tích hợp và evaluation, nơi dự án thể hiện được quyết định của riêng mình.
- Upstream là developer preview và đã báo trước sẽ có breaking change. Commit pin, các config dump trong `docs/evidence/` và bộ test không cần key chính là quy trình nâng cấp.
- Patch thay nguyên `config` của một row. Mỗi row bị override phải khai báo lại các key của upstream và phải được kiểm tra lại khi nâng cấp.
- Repo này resolve CLI, MCP server SDK và scripted model server từ checkout, nên không chạy được nếu thiếu nó.
