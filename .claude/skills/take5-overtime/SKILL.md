---
name: take5-overtime
description: 透過 take5-clock.ts 在 Take5 Portal 送出加班申請（cf_wf_OvertimeApp）。處理日期/時間解析、otcode 自動帶入、加班時數計算、dry-run 先檢查再送出、送出後自動查狀態。當使用者提到「加班申請」、「送加班單」、「申請加班」、「take5 加班」、「OT 申請」、或給出「日期＋時間＋加班事由」要送加班時使用。
---

# Take5 加班申請

用專案內的 `take5-clock.ts apply-ot` 子指令送出加班申請。CLI 已實作完整流程，本 skill 負責**正確驅動它**與**安全把關**。

## 核心安全規則（務必遵守）

1. **預設 dry-run，不寫入後端、不留草稿。** 第一次一定先用不帶 `--send` 的指令，它只在本地組出 payload 印出來給使用者看（不會建立任何草稿）。
2. **送出（`--send`）前必須取得使用者明確確認。** 加班單會送進主管簽核，是對外動作。
3. **送出後自動查狀態**：`--send` 跑完會自動列出該加班申請的狀態（審核中 / 已結案），不需要使用者開 App 確認。
4. 不要替使用者編造加班事由、日期或時間；缺哪個就問。

## 指令

```bash
# dry-run（預設）：只印 payload 供檢查，不寫入
npx tsx take5-clock.ts apply-ot <otdate> <from> <to> "<事由>"

# 確認後正式送出（送完自動查狀態）
npx tsx take5-clock.ts apply-ot <otdate> <from> <to> "<事由>" --send

# 隨時查我的申請單狀態（不帶 formcode 看全部）
npx tsx take5-clock.ts status                  # 全部
npx tsx take5-clock.ts status cf_wf_OvertimeApp # 只看加班
```

- `otdate`：`yyyy/MM/dd` 或 `yyyy-MM-dd`
- `from` / `to`：`HH:mm` 或 `HH:mm:ss`（同一天）
- **前置**：在專案根目錄執行，且根目錄要有 `.env`（`COMPANY_CODE` / `EMAIL` / `PASSWORD`）。
  secrets 只放 `.env`（已 gitignore），**不要寫進這個 skill 檔**。若不在專案根目錄跑，
  先 `cd` 到專案、或確保 `.env` 在當前目錄。

### env 選項（少用，預設即可）

- `OT_NEXTDAY_TO=1`：結束時間跨到隔天（例如 22:00→01:00）
- `OT_EXPECT_CL=1`：轉補休（**預設不設＝發加班費**）
- `OT_CODE=TWOT01`：當後端對該日期沒自動回 otcode 時，手動指定
- `OT_PRIOR_APP=0`：關閉「事先申請」（預設 true）

## 標準流程

1. 確認手上有：**加班日期、開始/結束時間、加班事由**。缺就問使用者。
2. 跑**不帶 `--send`** 的指令（dry-run）。CLI 會：登入 → 取 empid → 找 `cf_wf_OvertimeApp` → `GetOTCodeByDateType` 自動帶 otcode → `otDiff` 算時數 → 印出 payload（不寫入）。
3. 把 CLI 印出的 `applyInfo row`（otcode、othours、發加班費/轉補休、事由）整理給使用者確認，特別點出：
   - **加班時數**：CLI 用整段時間算，**沒扣用餐時間**。若公司規定要扣（例如 7h→6h），提醒使用者，必要時用 `OT_NEXTDAY_TO` 或請使用者改時間。
   - **otcode**：是後端依日期判定（工作日/休息日/國定假日/例假日）還是手選。
4. 使用者確認無誤 → 加 `--send` 正式送出。
5. CLI 送完會自動印出申請狀態；把申請單號與狀態回報使用者即可（不必開 App）。

## 速查

加班類型 `otcode`（台灣）：

```
TWOT01 工作日加班   TWOT02 休息日加班   TWOT03 國定假日加班   TWOT04 例假日加班
```

技術備註（debug 時用）：

- 送出走 `POST /api/WorkflowForm/Apply`（multipart）；`applyInfo[]` 每列**必帶 `RowFlag:"+"`**，缺了後端回 `500 RowFlag is null`（CLI 已內建）。
- datetime 欄位格式 `yyyy/MM/dd HH:mm:ss`。
- 加班時數＝client 端 `otDiff`（起訖時數差，2 位小數），再扣 `mealhour`。
- 完整 API 與欄位定義見 `docs/api.md`「請假 / 加班表單欄位」一節。
