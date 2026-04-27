# take5-clock

從命令列完成 Take5 Portal 一次打卡的 TypeScript 腳本。
無依賴，靠 Node 18+ 內建 `fetch` 實作公司解析 → 登入 → 取員工資訊 → 送出打卡。

## Quick Start

```bash
# 1. 設定環境變數
cp .env.example .env
$EDITOR .env             # 填 COMPANY_CODE / EMAIL / PASSWORD / LATITUDE / LONGITUDE

# 2. 跑（需要 Node 18+）
npx tsx take5-clock.ts            # 走 .env，預設下班打卡
npx tsx take5-clock.ts in         # 上班
npx tsx take5-clock.ts out        # 下班
DEBUG=1 npx tsx take5-clock.ts    # 印詳細 debug 訊息
```

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

## 已知限制

- **不處理 2FA**：帳號若 `GetVerifyConfig.UseVerifyCodeForLogon=true` 不適用
- **只示範 GPS 模式**：Wi-Fi / Bluetooth 模式 App 端會驗證 SSID 或掃 iBeacon UUID，腳本沒做
- **不會 refresh token**：拿到的 token 一小時就過期；單次打卡夠用
- **單一 machine**：自動挑第一台支援 GPS 的 machine

## 進階文件

- [`docs/api.md`](docs/api.md) — Take5 Portal 後端 API 完整盤點（含打卡 request/response）
- [`docs/decompile-notes.md`](docs/decompile-notes.md) — APK 反編譯流程與產物路徑速查
