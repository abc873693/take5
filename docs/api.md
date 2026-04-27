# Take5 Portal — 後端 API 盤點

從 `take5.apk` v2.0.2 還原。**共 65 個 `/api/` endpoint**（不含 `/Token` 與 Push 服務）。
所有路徑除了 `/Token` 外都在 `/api/` 之下。

> **打卡核心 API 共 7 支**（已確認沒有遺漏）：3 支 ATS + 4 支 ClockInOut2。
> 其他與打卡有關的（補打卡 / 異常更正 / 請假計算）走 WorkflowForm 與 leavecalc 等通用流程。

---

## 後端 Base URL 流程

App 不寫死 API 主機。每家公司一台 API 主機，由 `T5PCompanyAPI` 動態派發：

```
GET https://take5people.net/T5PCompanyAPI/api/GetCompany?cid={companyCode}
  → { ApiUrl, CompanyCode, Logo1, Logo2 }
```

`ApiUrl` 是該公司專屬 API base URL（例如 `https://cloud.take5people.net/ACMETest_API`）。
之後所有 `/api/...` 都接在這之後。

App 把結果存進 Capacitor `Preferences`（key: `SERVER_KEY`），登出 / 重綁公司會清掉。

---

## 打卡相關 API（核心 7 支）

### 站內打卡 — `AtsService`

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/ATS/clockInOut` | **送出打卡**（GPS / Wi-Fi / 藍牙皆走這支） |
| GET | `/api/ATS/BeforeClockInOut` | 打卡前狀態檢查（顯示班別、是否需打卡） |
| GET | `/api/ATS/GetAttendanceList` | 出勤紀錄；月曆頁、打卡記錄列表都用這支 |

#### `POST /api/ATS/clockInOut` Request

```jsonc
{
  "sourceType": "android",        // utilsService.getDeviceType()
  "InOut": false,                 // true=上班, false=下班；非 trustIO 機器永遠 false
  "EmpId": 12345,                 // EmpInfo.empid
  "Latitude": 25.0330,
  "Longitude": 121.5654,
  "MachineCode": "...",           // 從 MachineGroup.machineList 選一台
  "MachineGroupCode": "...",      // MachineGroup.code
  "TimeZoneMinutesOffset": 0,     // App 寫死 0（程式註解 //to do），由後端決定
  "ValidType": 1                  // 0=None, 1=GPS, 2=WiFi, 3=Bluetooth
}
```

Headers：`Authorization: bearer <access_token>` + `Content-Type: application/json`

Response：`{ "Time": "yyyy/MM/dd HH:mm:ss", ... }`

> ⚠️ **GPS 範圍**：後端會根據座標與 machine 中心點 `latitude/longitude` 計算距離；
> 超過 `range`（公尺）仍會 200 OK，但會被歸成越界紀錄，不出現在「今日打卡」。

### 外勤打卡 — `ClockInOut2`

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/ClockInOut2/SetOutSideClockInOut` | 外勤打卡送出（不限制公司 GPS 範圍） |
| GET | `/api/ClockInOut2/GetOutsideInOutState` | 外勤打卡目前狀態 |
| GET | `/api/ClockInOut2/GetOutSideClockInOutListByEmpId` | 個人外勤紀錄列表 |
| GET | `/api/ClockInOut2/GetOutSideLocationList` | 建議外勤地點列表 |

`/api/Employee` 回傳的 `MobileCanOffsiteClock=true` 時 App 才會啟用這套。

### 三種打卡驗證模式

| 模式 | 觸發條件 | App 端額外動作 | `ValidType` |
|---|---|---|---|
| **GPS** | machine 沒設 wifiOnly/bluetoothOnly | 比對距離 ≤ `range` | `1` |
| **Wi-Fi** | `machine.wifiOnly` 或 `networkSegment` 有值 | 檢查當前 SSID/網段 | `2` |
| **Bluetooth** | `machine.bluetoothOnly` 或 `bluetoothUuid` 有值 | 掃 iBeacon `Take5PortalIBeacons` 並比對 UUID | `3` |

`isTrustIO` 機器：分開兩顆 ClockIn / ClockOut 按鈕；其他只有單一 Clock。

---

## 與打卡記錄相關的周邊 API

> 這些**不是打卡 API**，但在出勤流程中常會用到。

### 補打卡 / 異常更正 — 走 `WorkflowForm`

App 沒有獨立「補打卡」endpoint。**補打卡實際上是用 `WorkflowForm` 通用流程提交特定 form code**（formCode 由後端設定，常見如 `ATS_FIX`、`OT_APPLY` 等）。

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/WorkflowForm/Apply` | 提交申請（補打卡、加班、請假、調班…） |
| GET | `/api/WorkflowForm/GetFormInfo` | 取單一表單詳情 |
| GET | `/api/WorkflowForm/GetAllRefLookup` | 表單參考資料（下拉選單來源） |
| POST | `/api/WorkflowForm/Approve` | 核准 |
| POST | `/api/WorkflowForm/Refuse` | 退回 |
| POST | `/api/WorkflowForm/Cancel` | 取消 |
| POST | `/api/WorkflowForm/Delete` | 刪除 |
| GET | `/api/WorkflowForm/GetMyApplications` | 我的申請（總覽） |
| GET | `/api/WorkflowForm/GetMyPendingApplicationsList` | 我的待審申請 |
| GET | `/api/WorkflowForm/GetMyClosedApplicationsList` | 我的已結案申請 |
| GET | `/api/WorkflowForm/GetMyPendingLeaveApplicationsList` | 我的待審請假 |
| GET | `/api/WorkflowForm/GetMyClosedLeaveApplicationsList` | 我的已結案請假 |
| GET | `/api/WorkflowForm/GetPendingApprovalList` | 待我審核 |
| GET | `/api/WorkflowForm/GetClosedApprovalList` | 已結案審核 |
| GET | `/api/WorkflowForm/GetPendingLeaveApprovalList` | 待我審核請假 |
| GET | `/api/WorkflowForm/GetClosedLeaveApprovalList` | 已結案審核請假 |
| GET | `/api/WorkflowForm/GetPendingMonitorList` | 待監看（管理） |
| GET | `/api/WorkflowForm/GetPendingLeaveMonitorList` | 待監看請假 |

### 請假 / 加班計算

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/LeaveCalc` | 請假計算（時數試算） |
| POST | `/api/leavecalc` | 同上的另一個大小寫變體（IIS 通常 case-insensitive） |
| POST | `/api/leavecheck` | 請假驗證（是否符合規則） |
| GET | `/api/EmpOT/GetOTCodeByDateType` | 加班碼查詢（依日期類型） |

### 影響打卡頁顯示

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/Employee/GetBulletins` | 公告 |
| GET | `/api/weather` | 天氣（首頁打卡按鈕旁顯示） |
| GET | `/api/Report/GetMyReport` | 個人報表 |
| GET | `/api/Report/GetFormInfo` | 報表表單資訊 |
| GET | `/api/Report/GetAllFormArgumentsLookUp` | 報表參數參考資料 |

---

## 打卡前置依賴

| Method | URL | 用途 |
|---|---|---|
| GET | `https://take5people.net/T5PCompanyAPI/api/GetCompany?cid=...` | 解析公司 → 取 `ApiUrl` 與正規 `CompanyCode` |
| POST | `{ApiUrl}/Token` | OAuth password grant（form-urlencoded） |
| GET | `{ApiUrl}/api/InitPortal/APIConfig?companyCode=...` | API 版本與後端設定（App 啟動時呼叫） |
| GET | `{ApiUrl}/api/Employee?id=0` | 取 `EmpInfo.empid` 與 `MachineGroup.machineList` |
| GET | `{ApiUrl}/api/User` | 使用者資訊 |

### `POST {ApiUrl}/Token`

`Content-Type: application/x-www-form-urlencoded`

```
grant_type=password
username={email}
password={password}
ccode={CompanyCode}        ← 必須用 GetCompany 回的 CompanyCode，不是用戶輸入的 cid
deviceId={fcm_device_id}    ← 留空可
deviceType=android          ← android | ios | androidchina | wecomios | wecomandroid | other
```

Response（標準 OAuth）：

```json
{
  "access_token": "...",
  "token_type": "bearer",
  "expires_in": 86399,
  "refresh_token": "..."
}
```

之後所有 `/api/...` 帶 `Authorization: bearer {access_token}`。

### `GET {ApiUrl}/api/Employee?id=0` Response（節錄）

> ⚠️ 後端 ASP.NET DTO 欄位大小寫不一致：外層 PascalCase，`MachineGroup` 內欄位
> camelCase，`EmpInfo` 內欄位全小寫。

```jsonc
{
  "EmpInfo": {
    "empid": 12345,
    "empname": "...",
    "userid": 0,
    "usercode": "...",
    "defaultmachinegroupcode": "...",
    "countrycode": "TW",
    "atslocation": "..."
  },
  "MachineGroup": {
    "code": "...",
    "ioTimes": 2,
    "isTrustIO": false,
    "useMobileClockInOut": true,
    "latitude": 25.033,
    "longitude": 121.564,
    "range": 100,
    "wifiOnly": false,
    "networkSegment": "...",
    "bluetoothOnly": false,
    "bluetoothUuid": "...",
    "machineList": [
      {
        "machineCode": "...",
        "machineName": "...",
        "address": "...",
        "latitude": 25.033,
        "longitude": 121.564,
        "range": 100,
        "wifiOnly": false,
        "bluetoothOnly": false,
        "bluetoothUuid": "...",
        "bluetoothMajor": 1,
        "bluetoothMinor": 1
      }
    ]
  },
  "MobileCanOffsiteClock": true,
  "Position": { "positioncode": "...", "positionname": "..." },
  "RosterList": [{ "workdate": "..." }],
  "Subordinates": [],
  "EmployeeUpdates": [],
  "Bulletins": []
}
```

---

## 全部 65 個 `/api/` Endpoint（依模組）

```
# ── 打卡核心（7）───────────────────────────────────
POST /api/ATS/clockInOut
GET  /api/ATS/BeforeClockInOut
GET  /api/ATS/GetAttendanceList
POST /api/ClockInOut2/SetOutSideClockInOut
GET  /api/ClockInOut2/GetOutsideInOutState
GET  /api/ClockInOut2/GetOutSideClockInOutListByEmpId
GET  /api/ClockInOut2/GetOutSideLocationList

# ── 補打卡 / 簽核（WorkflowForm，18）────────────────
POST /api/WorkflowForm/Apply
GET  /api/WorkflowForm/GetFormInfo
GET  /api/WorkflowForm/GetAllRefLookup
POST /api/WorkflowForm/Approve
POST /api/WorkflowForm/Refuse
POST /api/WorkflowForm/Cancel
POST /api/WorkflowForm/Delete
GET  /api/WorkflowForm/GetMyApplications
GET  /api/WorkflowForm/GetMyPendingApplicationsList
GET  /api/WorkflowForm/GetMyClosedApplicationsList
GET  /api/WorkflowForm/GetMyPendingLeaveApplicationsList
GET  /api/WorkflowForm/GetMyClosedLeaveApplicationsList
GET  /api/WorkflowForm/GetPendingApprovalList
GET  /api/WorkflowForm/GetClosedApprovalList
GET  /api/WorkflowForm/GetPendingLeaveApprovalList
GET  /api/WorkflowForm/GetClosedLeaveApprovalList
GET  /api/WorkflowForm/GetPendingMonitorList
GET  /api/WorkflowForm/GetPendingLeaveMonitorList

# ── 請假 / 加班計算（4）────────────────────────────
POST /api/LeaveCalc
POST /api/leavecalc
POST /api/leavecheck
GET  /api/EmpOT/GetOTCodeByDateType

# ── 帳號 / 認證 / 2FA（9）──────────────────────────
POST /Token                             ← 注意不在 /api/ 之下
GET  /api/User
POST /api/Logon/SendResetPasswordEmail
POST /api/Account/ChangePassword        (也用於改語言)
POST /api/Account/ForceChangePassword
GET  /api/user/GetVerifyConfig          ← 2FA 設定
POST /api/user/SendVerifyCode           ← 2FA 寄碼
POST /api/user/ValidVerifyCode          ← 2FA 驗證
POST /api/employee/VerifyEmployeePasswordZip

# ── 員工 / 主管（5）───────────────────────────────
GET  /api/Employee
GET  /api/Employee/GetBulletins
GET  /api/Subordinates
GET  /api/Subordinates/GetMyTeamUpdates
GET  /api/Payslip

# ── 報表（3）─────────────────────────────────────
GET  /api/Report/GetMyReport
GET  /api/Report/GetFormInfo
GET  /api/Report/GetAllFormArgumentsLookUp

# ── 訊息 / 推播（8）───────────────────────────────
GET    /api/MessageAll/GetMyMessageList
GET    /api/MessageAll/GetMyWorkflowCount
GET    /api/messages
DELETE /api/messages
POST   /api/messages/markAllAsRead
POST   /api/pushNotification/addPushNotification
GET    /api/pushNotification/getUserNotification
GET    /api/pushNotification/getIPInfo

# ── 檔案（4）─────────────────────────────────────
GET  /api/Files/GetDocuments
POST /api/Files/UploadPersonalFile
POST /api/Files/DeleteDocuments
POST /api/Files/DeleteAllDocuments

# ── WeCom（企業微信，6）───────────────────────────
GET  /api/WeCom/GetWeComCorpJsapiTicketInfo
GET  /api/WeCom/GetUserWeComID
GET  /api/WeCom/GetWeComUserID
POST /api/WeCom/UpdateUserWeComID
GET  /api/WeCom/GetHRMSFileSize
POST /api/WeCom/SendTextCardMessage

# ── 系統 / 公司（3）───────────────────────────────
GET  /api/InitPortal/APIConfig
GET  /api/GetCompany                    ← 也對應 https://take5people.net/T5PCompanyAPI/api/GetCompany
GET  /api/weather

# ── Push（不在 /api/ 之下，獨立網域 https://take5people.net/Push）──
GET /AppInfo/AppGetInfo?key=appnews         ← App 公告
GET /AppInfo/AppGetInfo?key=appversion      ← 版本資訊
GET /AppInfo/AppGetInfo?key=appversion2     ← 版本資訊 v2
GET /AppInfo/AppGetInfo?key=appmaintenance  ← 維護中通知
GET /AppInfo/AppGetInfo?key=appforceupdate  ← 強制更新
```

---

## 沒有的功能（避免猜測誤用）

從 65 個 endpoint 可以反推 **App 沒有以下功能**：

- ❌ **打卡照片 / Selfie 打卡**：`clockInOut` payload 沒有 `Photo`、`ImageBase64` 等欄位
- ❌ **臉部辨識打卡**：沒有 face/biometric 相關 endpoint（生物辨識 plugin 只用於本地解鎖）
- ❌ **獨立的補打卡 API**：補打卡走 `WorkflowForm/Apply`（formCode 後端設定）
- ❌ **NFC / QR Code 打卡**：沒有對應 endpoint
- ❌ **打卡照片上傳**：`Files/UploadPersonalFile` 是個人文件上傳，與打卡無關
