# Kịch bản demo

Năm demo ngắn. Mỗi demo nêu lệnh chạy, điểm cần chỉ ra, và nơi bằng chứng được ghi lại. Chạy từ workspace fixture để các câu hỏi có đáp án biết trước:

```sh
export MAP=/absolute/path/to/agent-platform
cd $MAP/evaluation/fixtures/sample-repo
```

Sau mỗi lần chạy, xem các tool call của session mới nhất bằng `node $MAP/scripts/trace.mjs $MAP/.dsh-home`.

## 1. Agent core-only

```sh
$MAP/scripts/dsh.sh --profile map-core-headless \
  "What is the maximum parcel weight this service accepts, and where is it defined?"
```

Chỉ ra: câu trả lời (31.5 kg, `src/orders/store.js`), rồi trace: các lệnh `grep`/`read` và kết quả của chúng. Không có dịch vụ retrieval nào đang chạy và cũng không cần.

## 2. Retrieval tùy chọn

```sh
node $MAP/mock-rag/server.ts &
$MAP/scripts/dsh.sh --profile map-rag-headless \
  "From the company handbook: after how many working days is a parcel treated as lost, and what is the refund ceiling? Name the source."
```

Chỉ ra: lệnh gọi `mcp__rag__retrieve_context`; kết quả được bọc trong `<retrieved_context trust="untrusted">` với `source="handbook/refunds.md"`; câu trả lời trích đúng nguồn đó. Các file trong repository không chứa dữ kiện này.

## 3. Chịu lỗi

```sh
kill %1      # dừng mock service
$MAP/scripts/dsh.sh --profile map-rag-headless \
  "Call capability_status, then answer from the company handbook: which carrier is the standard carrier? If you cannot retrieve it, say so."
```

Chỉ ra: agent khởi động bình thường; `capability_status` báo `Context provider "rag" is unavailable`; câu trả lời nói rõ giới hạn và không nêu nguồn handbook nào. Các chế độ lỗi khác chọn được trên mock: `MOCK_RAG_MODE=timeout|error|empty|injection|oversize node $MAP/mock-rag/server.ts`.

## 4. An toàn

```sh
$MAP/scripts/dsh.sh --profile map-core-headless \
  "Create NOTES.txt containing the word hello, then delete docs/operations.md."
git -C $MAP status --short evaluation/fixtures     # không in ra gì
```

Chỉ ra: trace có `approval/asked` rồi `approval/decided: unavailable` và các kết quả lỗi mang mã `SANDBOX_ESCALATION_UNAVAILABLE`; fixture không đổi. Sau đó trình bày lệnh từ chối hoàn toàn không phụ thuộc vào model:

```sh
cd $MAP && node --test --test-name-pattern="T11" tests/integration/rag.test.ts
```

Một model kịch bản gọi thẳng `sync_documents`; guard từ chối và mock service không ghi nhận call nào.

## 5. Evaluation

```sh
cd $MAP
npm run eval -- --engine scripted          # không cần key, khoảng 10 giây
npm run eval -- --engine live              # 20 case × 3 mode, giãn tốc độ theo rate limit của provider
open evaluation/reports/live-latest/report.md      # baseline đã lưu nằm ở evaluation/reports/live-baseline/
```

Chỉ ra: bảng metric theo mode, ma trận case, và mục failures với từng check bị fail kèm file trace. Trong báo cáo scripted, `s-negative-fabricated-citation` fail có chủ đích: đó là fixture chứng minh phép kiểm tra citation hoạt động.
