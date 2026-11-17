# Upstream

Bản phân phối này chạy trên [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) và không sửa nó.

- Commit pin: `e8f7b93a344964de3dca1ace9e72b6e4d6de87cb`
- Phiên bản: `0.2.2-rc.2` (developer preview; upstream báo trước sẽ có thay đổi phá vỡ tương thích)
- License: MIT
- Vị trí mặc định: `../deepseekHarness/deepseek-harness`, hoặc đường dẫn trong `DSH_BASE`
- Node: `>= 24.9` (đã kiểm chứng với 24.16.0)
- pnpm: `11.28.5`, phiên bản upstream pin; dùng qua `corepack pnpm` khi `PATH` không có `pnpm`

`scripts/doctor.ts` đọc commit pin từ dòng đầu tiên ở trên; giữ nguyên dạng 40 ký tự hex trong dấu backtick.

## Chuẩn bị checkout

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout e8f7b93a344964de3dca1ace9e72b6e4d6de87cb
corepack pnpm install --frozen-lockfile
corepack pnpm run build:artifacts
```

Bản build phải khớp với source đang checkout. Bản build sót lại từ commit cũ vẫn khởi động được profile `headless` nhưng lỗi ở `web`; build lại sau mỗi lần pull.

## Repo này lấy gì từ checkout

| Mục đích | Đường dẫn trong checkout |
|---|---|
| CLI `dsh` boot mọi profile | `apps/cli/lib/bin.js` |
| Các bundle base, headless và web | `packages/bundle/*` |
| Plugin MCP client cho dịch vụ retrieval | `packages/mcp/mcp-client` |
| MCP server SDK và zod, cho mock retrieval service | resolve từ `packages/mcp/mcp-client` |
| Scripted Messages server, cho test không cần key | `packages/test-support/llm-mock-server/lib/index.js` |

`scripts/base.ts` phụ trách các lookup này. Repo này không cài dependency riêng nào.

## Nâng cấp

1. Pull và build lại checkout.
2. Chạy `./scripts/setup-profiles.sh`, rồi `node scripts/doctor.ts`.
3. So sánh `./scripts/dsh.sh --profile headless --dump-config` và bản tương ứng của `web` với `docs/evidence/`. Mọi row id mà bundle patch nhắc tới phải còn tồn tại; patch thay nguyên `config` của một row, nên key mới của upstream trên row đã patch phải được khai báo lại.
4. Chạy `npm test`. Lane scripted không cần key và phủ T01 đến T14.
5. Cập nhật commit pin ở trên và các dump trong `docs/evidence/`.
