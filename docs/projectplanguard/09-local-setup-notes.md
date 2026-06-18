# 09 — Local Setup Notes (đã verify thực tế)

Bổ sung cho [06-implementation-plan.md](06-implementation-plan.md) P0. Đây là những điều **đã chạy
thật trên máy** (macOS) ngày 2026-06-18, kèm các "gotcha" không có trong `docs/dev-quickstart.md`.

## Trạng thái đã đạt được ✅

| Thành phần | Kết quả |
|---|---|
| Node 24.17.0 + pnpm 11.5.2 | OK |
| `pnpm install` | Already up to date (27 workspace projects) |
| `.env` — 3 secret | BETTER_AUTH_SECRET, CRYPTO_LOCAL_MASTER_KEY, OPENAI_API_KEY đều SET |
| `pnpm db:up` | Postgres (5542) + Redis + Jaeger + Prometheus + Grafana + OTEL |
| `pnpm db:migrate` | migrations applied |
| `pnpm db:seed` | tenant `hackathon`: 300 users, 15 groups, 50 plans, 240 buckets, 615 tasks |
| `pnpm dev` | server `/health/ready` → 200 `{"ok":true,"identity":"wired"}`, web :5173 → 200 |
| Login | `admin@hackathon.com` / `ChangeMe@2026` → 200 + session cookie; `/me` role `org.admin` |

## Gotchas đã gặp & cách xử lý (QUAN TRỌNG)

### 1. Node version — shell mặc định v16, repo cần ≥24
Máy có sẵn Node 24 qua nvm nhưng shell mặc định lại là **v16.20.2** → `pnpm` (corepack) crash
(`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`). Repo có `.nvmrc=24`.
**Fix:** luôn `nvm use 24` (hoặc `nvm use`) trong thư mục repo **trước mọi lệnh `pnpm`**.
Cân nhắc `nvm alias default 24` để khỏi quên.

### 2. `.env.example` có dòng làm vỡ `db:migrate`
`cp .env.example .env` để lại `MAILER_DEFAULT_SMTP_URL=` (rỗng). CLI env schema
(`apps/cli/src/env.ts`) khai báo `z.string().url().optional()` — chuỗi rỗng KHÔNG phải URL hợp lệ
→ `db:migrate` fail với `ZodError: invalid_format url`.
**Fix:** comment dòng đó: `# MAILER_DEFAULT_SMTP_URL=` (để biến thành undefined).

### 3. `OPENAI_API_KEY` là BẮT BUỘC để server boot (không chỉ cho chat)
`registerAgent` gọi `validateModelEnv` (`packages/agent/src/backend/provider-config.ts:100`) lúc
boot → **thiếu key thì API server crash ngay** (`Missing model provider env vars: OPENAI_API_KEY`),
web :5173 vẫn lên nhưng API :3000 chết. (Khác với comment trong `.env.example` rằng "unset chỉ
disable chat".) **Fix:** điền key organizer trước khi `pnpm dev`.
> Worker cũng cần key để chạy job `planner.embed_task` (embed 615 task đã seed); thiếu key chỉ
> làm job embedding fail-retry, không chặn boot — nhưng nên có key để retrieval hoạt động.

### 4. Endpoint đăng nhập đúng
KHÔNG phải `/api/auth/...`. Đúng là **`/api/identity/v1/auth/sign-in/email`** (POST
`{email,password}`) và **`/api/identity/v1/me`**. Tham chiếu: `apps/web/e2e/login.smoke.ts`.

## Lệnh tiện ích

```bash
# Chuẩn Node trước mỗi phiên
cd /Users/kevintruong/Documents/agent-platform && nvm use      # đọc .nvmrc=24

# Chạy app (foreground, xem log trực tiếp)
pnpm dev
# Health
curl -s http://localhost:3000/health/ready
# Đăng nhập thử
curl -s -X POST http://localhost:3000/api/identity/v1/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"admin@hackathon.com","password":"ChangeMe@2026"}' -i | head -1

# Làm lại DB từ đầu
pnpm db:reset            # down -v + up + migrate + seed

# Dừng dev đang chạy nền
pkill -f "turbo run dev"
```

## Lưu ý bảo mật
- `.env` đã `chmod 600`, repo gitignore sẵn — **không commit**, không paste key vào doc/slide/video.
- `OPENAI_API_KEY` lấy từ `~/Downloads/team-1/AWS-CREDENTIALS.txt` (key organizer, project key `sk-proj-…`).
