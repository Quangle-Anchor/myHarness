# Hướng dẫn sử dụng và ví dụ áp dụng trong công việc

Tài liệu này dành cho người muốn **dùng** agent hằng ngày, không phải người muốn hiểu cách nó được xây. Phần kiến trúc nằm ở [architecture-v1.md](architecture-v1.md) và [giai-thich-toan-bo.md](giai-thich-toan-bo.md); phần cài đặt chi tiết nằm ở [deployment-local.md](deployment-local.md).

Mục lục:

1. [Agent này là gì, dùng vào việc gì](#1-agent-này-là-gì-dùng-vào-việc-gì)
2. [Chuẩn bị một lần](#2-chuẩn-bị-một-lần)
3. [Chọn profile](#3-chọn-profile)
4. [Các thao tác cơ bản](#4-các-thao-tác-cơ-bản)
5. [Ví dụ áp dụng trong công việc](#5-ví-dụ-áp-dụng-trong-công-việc)
6. [Mẹo viết yêu cầu](#6-mẹo-viết-yêu-cầu)
7. [Xử lý sự cố thường gặp](#7-xử-lý-sự-cố-thường-gặp)
8. [Những điều không nên làm](#8-những-điều-không-nên-làm)

---

## 1. Agent này là gì, dùng vào việc gì

Đây là một agent đơn (single agent) chạy trên máy bạn, dùng Gemini làm model. Bạn đứng trong một thư mục dự án, giao một nhiệm vụ bằng ngôn ngữ tự nhiên, agent tự đọc file, tìm kiếm, chạy lệnh shell, rồi trả lời kèm căn cứ. Mọi bước nó làm đều được ghi vào session log để xem lại.

Ba đặc điểm quyết định cách dùng:

| Đặc điểm | Ý nghĩa thực tế |
|---|---|
| **Mặc định read-only** | Session mới chỉ đọc được. Muốn agent sửa file phải bật `workspace-write` một cách chủ động. |
| **Workspace = thư mục hiện tại** | Agent làm việc trong thư mục nơi bạn gọi `dsh.sh`. Luôn `cd` vào đúng dự án trước khi chạy. |
| **Retrieval (RAG) là tùy chọn** | Không có dịch vụ tài liệu thì agent vẫn làm việc với code. Có dịch vụ thì agent tra cứu thêm tài liệu nội bộ và phải nêu nguồn. |

Phù hợp với: tìm hiểu codebase lạ, truy vết lỗi, review thay đổi, sửa nhỏ có giám sát, hỏi đáp tài liệu nội bộ kèm nguồn, chạy tác vụ lặp lại bằng script.

Chưa phù hợp với: tác vụ cần nhiều agent phối hợp, tác vụ cần truy cập web (`web_fetch`/`web_search` đã bị tắt), tác vụ chạy tự động không người giám sát trên dữ liệu quan trọng (xem [ma trận an toàn](safety-matrix.md)).

## 2. Chuẩn bị một lần

```sh
cd /path/to/agent-platform
cp .env.example .env              # điền GEMINI_API_KEY
./scripts/setup-profiles.sh       # tạo 4 profile trong .dsh-home/
node scripts/doctor.ts            # mọi dòng phải báo ok
```

Để gõ ngắn hơn, thêm vào `~/.zshrc`:

```sh
export MAP=/path/to/agent-platform
alias ask='$MAP/scripts/dsh.sh --profile map-core-headless'
alias askdoc='$MAP/scripts/dsh.sh --profile map-rag-headless'
alias mapui='$MAP/scripts/dsh.sh --profile map-core'
alias maptrace='node $MAP/scripts/trace.mjs $MAP/.dsh-home'
```

Các ví dụ bên dưới dùng những alias này. Không có alias thì thay `ask` bằng `$MAP/scripts/dsh.sh --profile map-core-headless`.

> `setup-profiles.sh` dựng lại profile từ đầu, nên thiết lập bạn lưu trong Web UI sẽ mất. Chỉ chạy lại khi cần.

## 3. Chọn profile

| Profile | Giao diện | Retrieval | Khi nào dùng |
|---|---|---|---|
| `map-core-headless` | dòng lệnh, một câu hỏi rồi thoát | không | hỏi nhanh về code, script, CI |
| `map-rag-headless` | dòng lệnh | có | câu hỏi cần tài liệu nội bộ |
| `map-core` | Web UI | không | phiên làm việc dài, hội thoại nhiều lượt, cần duyệt (approve) thao tác |
| `map-rag` | Web UI | có | như trên, kèm tài liệu nội bộ |

Quy tắc chọn nhanh: câu hỏi một lần → headless; cần trao đổi qua lại hoặc cần duyệt từng lệnh ghi → Web UI. Chỉ chọn profile `rag` khi dịch vụ retrieval đang chạy hoặc bạn chấp nhận agent báo "không có evidence".

## 4. Các thao tác cơ bản

### Hỏi một câu (headless)

```sh
cd ~/work/my-service
ask "Service này lắng nghe ở port nào và giá trị đó được cấu hình ở đâu?"
```

Câu trả lời in ra stdout, chẩn đoán in ra stderr. Mã thoát 0 là thành công, 1 là lỗi (thiếu key, quota, lỗi model).

Đọc nhiệm vụ từ file hoặc pipe:

```sh
cat task.md | ask -
```

### Xem agent đã làm gì

```sh
maptrace          # in các tool call và kết quả của session mới nhất
```

Đây là cách kiểm chứng câu trả lời: agent nói "định nghĩa ở `src/config.js`" thì trace phải có lệnh `read`/`grep` chạm tới file đó. Session log đầy đủ nằm ở `.dsh-home/sessions-plain/<workspace>/<session-id>/`.

### Hỏi tiếp trong cùng session

Tên thư mục session (dạng `session-7eb5…`) chính là session id:

```sh
ask --session-id session-7eb57e59-88ec-4c66-85f0-81b012105184 "Giải thích kỹ hơn hàm verifyToken"
```

Session được resume giữ nguyên lịch sử; các tool call cũ không bị chạy lại.

### Cho phép ghi file

```sh
ask --permission-mode workspace-write "Thêm unit test cho hàm createOrder trong src/orders/store.js"
```

Ở chế độ này agent ghi được trong workspace nhưng không ghi được ra ngoài. Trên Web UI, đổi bằng bộ chọn **Permissions**; mỗi thao tác cần nâng quyền sẽ hiện hộp thoại để bạn duyệt. Ở headless không có ai duyệt, nên yêu cầu nâng quyền bị từ chối (`SANDBOX_ESCALATION_UNAVAILABLE`).

### Lấy kết quả dạng máy đọc

```sh
ask --json "Liệt kê các endpoint HTTP" > events.ndjson
```

Mỗi dòng là một event JSON, dùng cho script hoặc pipeline.

### Mở Web UI

```sh
cd ~/work/my-service
mapui             # in ra URL kèm access token, mở trong trình duyệt
```

## 5. Ví dụ áp dụng trong công việc

Các ví dụ dùng repo mẫu `evaluation/fixtures/sample-repo` (một API theo dõi parcel nhỏ) để bạn chạy thử và thấy đáp án biết trước. Khi áp dụng thật, `cd` vào dự án của bạn và đổi câu hỏi.

```sh
cd $MAP/evaluation/fixtures/sample-repo
```

Fixture này được test và evaluation dùng, nên đừng để agent sửa nó. Với các ví dụ có ghi file (Ví dụ 4), chép ra một bản riêng không nằm dưới thư mục temp:

```sh
cp -r $MAP/evaluation/fixtures/sample-repo ~/scratch/sample-repo && cd ~/scratch/sample-repo && git init -q && git add -A && git commit -qm base
```

### Ví dụ 1: Onboarding vào một codebase lạ

**Tình huống.** Ngày đầu nhận một service chưa từng đọc, cần nắm cấu trúc trong 15 phút.

```sh
ask "Tóm tắt kiến trúc repo này: entry point, các module chính, luồng xử lý một request. Nêu đường dẫn file cho từng ý."
ask "Phiên đăng nhập (session) được tạo và kiểm tra như thế nào? Trích tên hàm và file."
ask "Liệt kê mọi hằng số giới hạn nghiệp vụ (trọng lượng, thời hạn, số lần thử) và nơi định nghĩa."
```

**Kết quả mong đợi.** Câu trả lời trỏ tới `src/server.js` (port 4317, đổi được qua biến `PORT`), `src/auth/session.js` (`issueToken`, `verifyToken`, `requireSession`) và `src/orders/store.js`. Với câu cuối, agent phải nêu `MAX_PARCEL_WEIGHT_KG = 31.5` trong `src/orders/store.js` và `SESSION_TTL_SECONDS` (45 phút) trong `src/auth/session.js`.

**Cách kiểm chứng.** `maptrace` sau mỗi câu; mọi file được nêu phải xuất hiện trong trace. File nào được nêu mà không có trong trace là dấu hiệu model đoán.

### Ví dụ 2: Truy vết lỗi từ một báo cáo bug

**Tình huống.** Ticket báo: "Đơn hàng 32 kg bị từ chối với lỗi khó hiểu".

```sh
ask "Một đơn hàng 32 kg bị từ chối. Tìm đoạn code từ chối, giải thích điều kiện, và chỉ ra thông báo lỗi trả về cho người dùng. Không sửa gì."
```

**Kết quả mong đợi.** `createOrder` trong `src/orders/store.js` trả HTTP 422 với nội dung `parcel too heavy` khi `weightKg > MAX_PARCEL_WEIGHT_KG`; thông báo không nói giới hạn là bao nhiêu, nên người dùng khó hiểu.

Vì mặc định read-only, bạn có thể giao việc điều tra mà không lo agent sửa code. Khi đã hiểu nguyên nhân và muốn sửa, chuyển sang Ví dụ 4.

### Ví dụ 3: Review một thay đổi trước khi merge

**Tình huống.** Đồng nghiệp gửi một nhánh, bạn muốn có góc nhìn thứ hai.

```sh
git diff main...feature/refund-limit > /tmp/change.diff
ask "Đọc file /tmp/change.diff. Review thay đổi này: lỗi logic, trường hợp biên bị bỏ sót, chỗ thiếu test. Đối chiếu với code hiện tại trong repo. Trả lời dạng danh sách, mỗi ý kèm file và dòng."
```

Agent đọc được file ngoài workspace (sandbox chỉ giới hạn việc ghi), nên đưa diff qua đường dẫn tuyệt đối là đủ. Cũng có thể cho agent tự chạy `git diff` vì lệnh đó chỉ đọc.

### Ví dụ 4: Sửa nhỏ có giám sát

**Tình huống.** Đã biết cần thêm validate và test, muốn agent làm phần gõ.

Cách an toàn nhất là dùng Web UI:

1. `mapui`, mở URL.
2. Giữ preset `read-only`, yêu cầu: "Đề xuất thay đổi để trả về thông báo lỗi rõ ràng khi parcel vượt 31.5 kg, kèm test. Chỉ mô tả, chưa sửa."
3. Đọc đề xuất. Đồng ý thì đổi Permissions sang `workspace-write` và yêu cầu: "Áp dụng đề xuất trên."
4. Duyệt từng thao tác trong hộp thoại approval.
5. Xem lại bằng `git diff` trước khi commit. Agent không commit thay bạn.

Bản headless tương đương, khi bạn đã tin vào phạm vi thay đổi:

```sh
ask --permission-mode workspace-write \
  "Trong src/orders/store.js, khi trọng lượng vượt giới hạn hãy trả lỗi 422 có nội dung 'Parcel exceeds 31.5 kg'. Thêm test bằng node:test và chạy nó sau khi sửa."
git diff
```

Luôn làm việc trên nhánh git sạch để `git diff` và `git checkout .` là lưới an toàn.

### Ví dụ 5: Hỏi đáp tài liệu nội bộ kèm nguồn (RAG)

**Tình huống.** Bộ phận CSKH hỏi chính sách hoàn tiền; câu trả lời nằm trong handbook, không nằm trong code.

```sh
node $MAP/mock-rag/server.ts &      # dịch vụ retrieval mẫu ở 127.0.0.1:8001
askdoc "Theo handbook: sau bao nhiêu ngày làm việc thì parcel bị coi là thất lạc, và mức hoàn tiền tối đa là bao nhiêu? Nêu nguồn."
```

**Kết quả mong đợi.** 9 ngày làm việc, tối đa 750 EUR, nguồn `handbook/refunds.md`. Trace có lệnh `mcp__rag__retrieve_context`, kết quả được bọc trong `<retrieved_context trust="untrusted">`.

Kết hợp code và tài liệu trong một câu hỏi:

```sh
askdoc "Code hiện tại giới hạn trọng lượng bao nhiêu kg? Handbook nói gì về parcel vượt mức đó? Phân biệt rõ ý nào từ code, ý nào từ handbook."
```

Agent lấy 31.5 kg từ `src/orders/store.js` và quy trình freight desk từ `handbook/carriers.md`.

**Khi dịch vụ tài liệu sập.** Agent vẫn chạy, nói rõ không truy xuất được và không bịa nguồn:

```sh
kill %1
askdoc "Gọi capability_status, rồi trả lời từ handbook: carrier tiêu chuẩn là hãng nào? Nếu không truy xuất được thì nói rõ."
```

Để dùng tài liệu thật của công ty thay cho mock, xem mục *Kết nối dịch vụ retrieval thật* trong [deployment-local.md](deployment-local.md). Mock chỉ có sáu đoạn văn trong `mock-rag/corpus.json`; bạn có thể sửa file này để thử với nội dung của mình, nhưng nó xếp hạng bằng số từ trùng nên không phản ánh chất lượng của một hệ retrieval thật.

### Ví dụ 6: Tác vụ lặp lại bằng script

**Tình huống.** Mỗi sáng muốn có bản tóm tắt TODO/FIXME mới trong repo.

```sh
#!/usr/bin/env bash
# daily-todo.sh
set -euo pipefail
cd ~/work/my-service
$MAP/scripts/dsh.sh --profile map-core-headless \
  "Tìm mọi TODO và FIXME trong src/. Nhóm theo file, mỗi mục một dòng kèm số dòng. Chỉ liệt kê, không đề xuất." \
  > ~/reports/todo-$(date +%F).md
```

Headless thoát bằng mã 0/1 nên script biết khi nào thất bại. Dùng `--json` nếu cần xử lý tiếp các event. Lưu ý giới hạn 15 request/phút của Gemini free tier: đừng chạy nhiều tác vụ song song.

### Ví dụ 7: Kiểm tra lại chất lượng trước khi đổi cấu hình

**Tình huống.** Bạn định đổi model (`MAP_MODEL`) hoặc chỉnh policy RAG và muốn biết có làm hỏng gì không.

```sh
cd $MAP
npm test                                        # không cần key, kiểm tra hành vi được enforce
npm run eval -- --engine scripted               # khoảng 10 giây, không cần key
MAP_MODEL=<model-muốn-thử> npm run eval -- --engine live --resume
```

So sánh `evaluation/reports/live-latest/report.md` với baseline ở `evaluation/reports/live-baseline/`. Chỉ số cần nhìn: tỷ lệ thành công theo mode, `fabricatedCitations` (phải bằng 0), và mục failures. `--resume` cho phép chạy tiếp khi bị ngắt do quota.

## 6. Mẹo viết yêu cầu

- **Đòi căn cứ.** Thêm "nêu đường dẫn file" hoặc "nêu nguồn" để câu trả lời kiểm chứng được qua trace.
- **Nói rõ phạm vi.** "Chỉ trong `src/auth/`", "không sửa gì", "chỉ liệt kê" giúp agent dừng đúng lúc và tốn ít request hơn.
- **Tách điều tra và sửa.** Hỏi ở read-only trước, sửa sau. Rẻ hơn và an toàn hơn.
- **Phân biệt nguồn.** Với profile `rag`, yêu cầu tách ý từ code và ý từ tài liệu.
- **Cho phép nói "không biết".** Thêm "nếu không tìm thấy thì nói rõ" giảm khả năng model đoán.
- **Một mục tiêu mỗi câu hỏi.** Câu hỏi gộp nhiều việc dễ vượt rate limit và khó kiểm chứng.

## 7. Xử lý sự cố thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Thoát mã 1, lỗi nêu thiếu key | `GEMINI_API_KEY` chưa có trong `.env` | Điền key, chạy `node scripts/doctor.ts` |
| Turn kết thúc với mã `QUOTA` | Vượt 15 request/phút của free tier | Đợi một phút; giảm số câu hỏi song song; dùng gói trả phí |
| Agent báo không ghi được file | Session đang read-only | Thêm `--permission-mode workspace-write` hoặc đổi Permissions trên Web UI |
| `SANDBOX_ESCALATION_UNAVAILABLE` | Headless không có người duyệt nâng quyền | Dùng Web UI để duyệt, hoặc chọn preset phù hợp ngay từ đầu |
| `capability_status` báo `rag` unavailable | Dịch vụ retrieval không chạy hoặc sai `MAP_RAG_URL` | Khởi động dịch vụ; kiểm tra bằng `doctor.ts` |
| Agent không thấy session cũ | Session do profile upstream trần tạo nằm ở `sessions/`, không ở `sessions-plain/` | Dùng các profile `map-*` cho mọi phiên |
| Profile `web` lỗi khi khởi động | Bản build upstream cũ | `corepack pnpm run build` trong checkout upstream |
| Treo lâu rồi `stream idle timeout` | Stream từ model bị treo | Ngắt và chạy lại; trace không mất |

## 8. Những điều không nên làm

- **Không dùng `danger-full-access`** trừ khi bạn hiểu rõ: preset này tắt cả sandbox lẫn approval.
- **Không đặt workspace dưới thư mục temp** khi dùng `workspace-write`; vùng temp ghi được, nên các thư mục ngang hàng cũng ghi được.
- **Không coi read-only là cách ly hoàn toàn.** Sandbox chỉ chặn ghi. Agent vẫn đọc được file ngoài workspace và lệnh shell vẫn ra mạng được. Đừng chạy agent trong thư mục có bí mật bạn không muốn gửi tới model.
- **Không tin câu trả lời chỉ vì có trích dẫn.** Đối chiếu với trace; một nguồn handbook chưa từng được retrieve là citation bịa.
- **Không cài plugin lạ** bằng `dsh plugin add`: plugin chạy với quyền của bạn.
- **Không để dịch vụ retrieval bind ra ngoài loopback** khi chưa có xác thực.

Chi tiết về những gì được enforce bằng code và những gì chỉ phụ thuộc model: [safety-matrix.md](safety-matrix.md).
