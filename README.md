# take5-clock

從命令列完成 Take5 Portal 一次打卡的 TypeScript 腳本。
無依賴，靠 Node 18+ 內建 `fetch` 實作公司解析 → 登入 → 取員工資訊 → 送出打卡。

## Quick Start

```bash
# 1. 設定環境變數
cp .env.example .env
$EDITOR .env             # 填 COMPANY_CODE / EMAIL / PASSWORD / LATITUDE / LONGITUDE

# 2. 跑（需要 Node 18+）
npx tsx take5-clock.ts            # 走 .env，預設下班打卡（免打卡日自動跳過）
npx tsx take5-clock.ts in         # 上班
npx tsx take5-clock.ts out        # 下班
npx tsx take5-clock.ts in --dry-run  # 只印 payload 不送出（檢查座標）
npx tsx take5-clock.ts in --force # 無視班表強制打卡（或 CLOCK_FORCE=1）
DEBUG=1 npx tsx take5-clock.ts    # 印詳細 debug 訊息

# 查今天要不要打卡（班表上班日 或 該日有加班申請）
npx tsx take5-clock.ts workday          # 只看今天
npx tsx take5-clock.ts workday --list   # 列出班表內各天（含加班日）

# 半天假交界打卡（14:00 cron 用；只在今天有半天假時動作）
npx tsx take5-clock.ts halfday

# 探測請假 / 加班等簽核表單（WorkflowForm 動態表單）
npx tsx take5-clock.ts applytypes                # 列可申請表單，找 formcode（首選）
npx tsx take5-clock.ts forminfo <formcode> 1     # dump 表單欄位 schema

# 加班申請（預設 dry-run 只印 payload 不寫入；--send 才正式送並自動查狀態）
npx tsx take5-clock.ts apply-ot 2026/06/20 11:00 18:00 "加班事由"
npx tsx take5-clock.ts apply-ot 2026/06/20 11:00 18:00 "加班事由" --send

# 查我的申請單狀態（審核中 + 已結案）
npx tsx take5-clock.ts status                    # 全部
npx tsx take5-clock.ts status cf_wf_OvertimeApp  # 只看加班
npx tsx take5-clock.ts status --detail           # 連同表單填寫內容（日期/時數/事由…）

# 查假別餘額（特休、生日假…）
npx tsx take5-clock.ts leave

# 查出勤紀錄（打卡時間、遲到早退曠職）
npx tsx take5-clock.ts attendance                      # 最近 30 天
npx tsx take5-clock.ts attendance 7                    # 最近 7 天
npx tsx take5-clock.ts attendance 2026/09/01 2026/09/30 # 指定區間
npx tsx take5-clock.ts attendance 7 --json             # 後端原始回應
```

`forms` / `forminfo` 子指令說明見 [`docs/api.md`](docs/api.md) 的「動態表單機制」一節。

## `.env` 變數

| 變數 | 必填 | 說明 |
|---|:---:|---|
| `COMPANY_CODE` | ✓ | 公司代碼（cid，App 綁定公司頁的代碼） |
| `EMAIL` | ✓ | 登入 email |
| `PASSWORD` | ✓ | 登入密碼（明文） |
| `LATITUDE` | ✓ | 打卡座標（緯度） |
| `LONGITUDE` | ✓ | 打卡座標（經度） |
| `IN_OUT` |  | `in`=上班, 其他=下班；可被 argv 覆寫 |
| `DEVICE_TYPE` |  | 預設 `android` |
| `DEVICE_ID` |  | App 端用的 FCM device id；留空不影響打卡 |
| `USE_MACHINE_LOCATION` |  | `1` = 直接用 machine 後端設定的中心座標（保證在 range 內） |
| `CLOCK_JITTER_METERS` |  | 每次打卡在基準座標周圍隨機飄移的半徑（公尺），預設 `20`；`0` = 關閉 |
| `CLOCK_DRY_RUN` |  | `1` = 只印 payload 不送出（等同 `--dry-run`） |
| `DEBUG` |  | `1` = 多印除錯訊息 |

## 流程

```
.env ── cid ──▶ GetCompany ── ApiUrl, CompanyCode ─┐
                                                   ▼
              ccode/email/pw ──▶ POST /Token ──▶ access_token
                                                       │ Bearer
                                                       ▼
                                          GET /api/Employee?id=0
                                                       │
                                       EmpInfo.empid    │
                                       MachineGroup.code, machineList
                                                       ▼
                                         Haversine 距離檢查
                                         決定 sendLat/sendLng
                                                       │ Bearer + JSON
                                                       ▼
                                       POST /api/ATS/clockInOut
                                                       │
                                                       ▼ Time ✓
```

## 注意 — 越界紀錄

GPS 模式下，超出 machine `range`（公尺）仍會 200 OK，但**不會出現在「今日打卡」**，
只進入越界紀錄。腳本會印 `✗ 超出範圍` 警告，必要時把 `USE_MACHINE_LOCATION=1`
直接用後端 machine 中心點。

## 自動打卡的上班日判斷

打卡前會依 `RosterList`（班表）＋加班申請＋請假申請判斷今天要不要打卡：

- **班表上班日 / 該日有加班申請（核准或審核中）** → 打卡
- **全天請假、多日請假、休息日(RO)、國定假日、未排班** → 跳過（exit 0，cron 不報錯）
- **半天請假** → 仍打卡，但落在請假時段的那張固定卡跳過，交界卡由 **14:00 cron（`halfday`）** 補：
  - 下午請假（如 14:00–18:00）→ 09:00 上班卡照打、18:30 下班卡跳過、**14:00 補打下班卡（離開）**
  - 上午請假（如 09:00–13:00）→ 09:00 上班卡跳過、18:30 下班卡照打、**14:00 補打上班卡（到班）**
- 加 `--force` 或 `CLOCK_FORCE=1` 可無視以上強制打卡

> GitHub Actions 三個 cron 都**每天**觸發（09:00 上班、18:30 下班、14:00 半天交界），
> 實際打不打由腳本判斷，所以假日加班、半天假都能正確處理。請假若仍在審核中也會被視為要請（避免誤打），
> 若申請被退回該日仍要上班，請手動 `--force`。
>
> ⚠️ **排程會延遲**：GitHub 排程 cron 實測固定偏晚（上班約 +50 分、下班約 +80 分，偶爾破 2 小時）。
> 已把 cron **提早**補償：上班排 08:00 TPE（落在 ~09:00）、下班排 17:30 TPE（落在 ~18:30-19:00，不早於 18:00）。
> 延遲是浮動的，若仍偶有遲到再微調 cron。

## 已知限制

- **不處理 2FA**：帳號若 `GetVerifyConfig.UseVerifyCodeForLogon=true` 不適用
- **只示範 GPS 模式**：Wi-Fi / Bluetooth 模式 App 端會驗證 SSID 或掃 iBeacon UUID，腳本沒做
- **不會 refresh token**：拿到的 token 一小時就過期；單次打卡夠用
- **單一 machine**：自動挑第一台支援 GPS 的 machine

## 進階文件

- [`docs/api.md`](docs/api.md) — Take5 Portal 後端 API 完整盤點（含打卡 request/response）
- [`docs/decompile-notes.md`](docs/decompile-notes.md) — APK 反編譯流程與產物路徑速查
