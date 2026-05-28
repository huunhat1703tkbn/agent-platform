# Script trình bày — Seta Agent Platform (2–3 slide)

> **Đối tượng:** Ban Tổ Chức & Thí Sinh  
> **Mục tiêu:** Giới thiệu hệ thống, tài nguyên được cấp phát và demo nhanh 2 use case để thí sinh nắm được phạm vi triển khai POC.

---

## Slide 1 — Nền tảng kỹ thuật & Tài nguyên được cung cấp

### Script người trình bày

> "Trước tiên, mình muốn nói qua về hệ thống mà Ban Tổ Chức đã chuẩn bị sẵn cho các đội."

**[Repo & Data]**

> "Ban Tổ Chức đã **public repo này** — mọi người có thể truy cập ngay bây giờ. Phần data mô phỏng thực tế sẽ được **public vào lúc các đội vào phòng thi**, để đảm bảo tính công bằng."

**[Kiến trúc Monorepo]**

> "Repo được tổ chức theo mô hình **monorepo** — chia làm 4 phần chính:"
>
> - **Foundation – Backend:** Hono framework, REST/GraphQL, auth với better-auth, RBAC.  
> - **Foundation – Database:** Postgres + pgvector, Drizzle ORM, migration đã có sẵn schema mẫu.  
> - **Foundation – Frontend:** React 19, TanStack Router, shadcn/ui, Tailwind 4.  
> - **Agent Runtime:** Mastra — orchestration, tool calling, workflow, memory, vector search.

> "Nói cách khác: **BE, FE, DB và AI runtime đã được dựng sẵn.** Các đội chỉ cần tập trung vào **viết module nghiệp vụ** của bài toán mình được bốc, không cần setup từ đầu."

**[Tài nguyên khác]**

> "Ngoài code, BTC còn cung cấp:"
>
> - Tài liệu kiến trúc và hướng dẫn tạo module: `docs/architecture.md`, `docs/creating-modules.md`.  
> - Data mô phỏng theo từng phòng ban — được thiết kế sát với dữ liệu thực tế của các hệ thống tại Seta.  
> - Bộ script bootstrap để chạy môi trường dev trong vòng 5 phút: `clone → install → db:up → db:migrate → dev`.

---

## Slide 2 — Module mẫu: Planner & Các use case AI Agent

### Script người trình bày

> "Để giúp các bạn hình dung **hệ thống trông như thế nào khi hoàn thiện**, BTC đã xây dựng sẵn một module mẫu — đó là **Planner**."

**[Planner là gì?]**

> "Planner là module quản lý task theo mô hình **kanban** — tương tự Trello hay Microsoft 365 Planner. Nó có đầy đủ board, task, member, skill tag, timesheet."

> "Và dựa trên data đó, chúng tôi xây dựng một **AI Agent** để giải quyết 2 vấn đề mà người dùng gặp thường xuyên nhất:"

---

### Use Case 1 — Góc độ Quản lý: Assign đúng người cho đúng task

> "Một manager thường phải quản lý nhiều team cùng lúc. Khi có task mới, câu hỏi đầu tiên là: *ai phù hợp nhất để làm việc này?* Họ không có thời gian lướt từng profile, hỏi từng người, hay mở excel lên tra."
>
> "Với Agent, manager chỉ cần nhắn: *'List Infrastructure tasks that need to work on, then suggest a suitable assignee for each'* — Agent sẽ tự tìm task, match skill, check workload, rồi đề xuất người phù hợp. Và **trước khi assign, Agent sẽ hỏi lại** — không bao giờ tự ghi mà không có người xác nhận."

---

### Use Case 2 — Góc độ PM/SM: Tránh tạo task trùng lặp

> "Vấn đề thứ hai rất quen thuộc với PM hay Scrum Master: *tạo xong task mới thì mới nhớ ra là task này đã có rồi*, hoặc không biết nó liên quan đến phần nào, gây ra trùng lắp, mất context cho dev."
>
> "Agent giải quyết bằng cách: ngay khi user tạo task mới, hệ thống tự **vector search** các task tương tự đã có, phân loại mức độ trùng — *likely-dup / maybe-dup / no-match* — rồi hiện thông báo để user quyết định: link vào ticket cũ, xóa task mới, hay bỏ qua. **Agent không block người dùng — chỉ cảnh báo và để họ quyết định.**"

---

## Slide 3 — Demo Flows: Chatflow vs Workflow

### Script người trình bày

> "Trước khi vào demo, mình muốn giải thích nhanh **Chatflow và Workflow khác nhau chỗ nào** — vì đây là 2 pattern mà các đội sẽ dùng nhiều nhất."

**[Chatflow]**

> "**Chatflow** là luồng tương tác theo kiểu hội thoại — user nhắn, agent phân tích và trả lời trong một lượt. Phù hợp với các tác vụ **tìm kiếm, truy vấn, khám phá thông tin**. Không có bước chờ phê duyệt giữa chừng."

**[Workflow]**

> "**Workflow** là luồng có **trạng thái** — nó có thể *dừng lại giữa chừng* để chờ con người phê duyệt, rồi tiếp tục sau đó. Trạng thái được lưu trong DB — đóng tab, reload, vẫn không mất. Phù hợp với các tác vụ **có ảnh hưởng thực tế** như assign task, xử lý batch."

---

### Bảng tóm tắt 4 luồng demo

| # | Tên luồng | Kiểu | Trigger | Điểm nổi bật |
|---|-----------|------|---------|--------------|
| **1** | Chat – Tìm task & member theo skill | Chatflow | Tin nhắn của user | Kết hợp exact match (skill tag) + semantic search (vector); không hallucinate |
| **2** | Chat – Full flow: tìm task + đề xuất assignee + HITL | Chatflow | Tin nhắn của user | Hiện confirmation card với top candidate + alternates; user click Assign mới ghi |
| **3** | Workflow – Assign by skill (suspend/resume) | Workflow | Nút "Suggest assignee" trên task card / từ chat | Suspend → card vào inbox → user approve → resume → assign; tự expire sau timeout |
| **4** | Workflow – Dedup on create | Workflow | Agent tạo task mới | No-match → tạo ngay; có khả năng trùng → hiện card 3 lựa chọn (link / xóa / ignore) |

---

### Script chi tiết từng luồng

**Luồng 1 — Chat: tìm task và member theo skill**

> "Kịch bản A — tìm task: User gõ *'Find tasks that require AWS skill'*. Agent kết hợp exact match trên skill tag và semantic search trên vector để trả về danh sách task kèm plan, project, status. Không có task không liên quan lọt vào."
>
> "Kịch bản B — tìm member: User gõ *'Find members who have both K8s and AWS skills'*. Agent truy vấn skill tag, lịch sử task đã làm, rank theo độ overlap. Không tự chế thêm skill ngoài data."

**Luồng 2 — Full flow với HITL**

> "User gõ lệnh tổng: Agent tự động tìm task open → match skill → build danh sách đề xuất. UI hiện **confirmation card** với người được đề xuất và các lựa chọn thay thế. User click *Assign* → ghi DB, Planner UI cập nhật ngay. User click *Skip* → bỏ qua, đề xuất người tiếp theo. **Agent không bao giờ tự assign mà không có human click.**"

**Luồng 3 — Workflow: Assign by skill**

> "Khác với chatflow — luồng này có **trạng thái persistent**. Quy trình gồm 5 bước chạy song song: load task → tìm candidate pool → enrich với workload/capacity/timezone → rank có trọng số → suspend chờ user. Card xuất hiện trong inbox, không mất khi đóng tab. User approve → resume → assign. Approval tự expire sau timeout."

**Luồng 4 — Workflow: Dedup on create**

> "Ngay khi user tạo task: vector search tìm task tương tự → phân loại *likely-dup / maybe-dup / no-match*. Nếu *no-match* → tạo ngay, không hỏi gì thêm. Nếu có khả năng trùng → card hiện 3 lựa chọn: link ticket trùng vào task mới, xóa task mới, hoặc bỏ qua. Người dùng quyết định — agent không block."

---

## Ghi chú cho BTC

- **Thời lượng trình bày dự kiến:** Slide 1 (~2 phút), Slide 2 (~3 phút), Slide 3 (~4 phút + thời gian demo thực tế).  
- **Demo thứ tự đề xuất:** Luồng 1 → Luồng 2 → Luồng 4 (dễ hình dung nhất cho thí sinh). Luồng 3 demo nếu còn thời gian.  
- **Điểm nhấn cần lặp lại:** (1) Tập trung vào nghiệp vụ, không cần lo infrastructure; (2) Data đã có sẵn, thiết kế theo data thực tế; (3) HITL — AI đề xuất, người quyết định.
