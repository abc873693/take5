# Take5 Portal — 後端 API 盤點

從 `take5.apk` v2.0.2 還原。**共 68 個 `/api/` endpoint**（不含 `/Token` 與 Push 服務）。
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
| GET | `/api/WorkflowForm/GetApplicationTypes` | **可申請的表單清單（formcode 權威來源）** |
| GET | `/api/WorkflowForm/GetFormInfo` | 取單一表單詳情 |
| GET | `/api/WorkflowForm/GetAllRefLookup` | 表單參考資料（下拉選單來源） |
| POST | `/api/WorkflowForm/Approve` | 核准 |
| POST | `/api/WorkflowForm/Refuse` | 退回 |
| POST | `/api/WorkflowForm/BatchApprove` | 批次核准 |
| POST | `/api/WorkflowForm/BatchRefuse` | 批次退回 |
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

#### 動態表單機制（請假 / 加班 / 補打卡共用）

請假、加班、補打卡、調班**沒有各自的 endpoint**，全部走 `WorkflowForm` 這套
metadata-driven 動態表單引擎，靠 `formcode` 區分類型。`formcode` 由後端設定，
App 端不寫死，所以整合前必須先「發現」公司有哪些 formcode、再取其欄位定義。

送出流程固定四步：

0. **`GET /api/WorkflowForm/GetApplicationTypes`** — **formcode 的權威來源**。
   App 新增申請頁（`dynamic.new_form`）用這支拉「可申請的表單清單」。回傳
   `{ ApplicationTypes: [...], DelegateApplicationTypes: { applications, applicants } }`，
   每個 item 帶 `folder` / `folderOrder`（分類）與完整 requestInfo 欄位（含
   `formcode` / `formtype` / `typename`）。App 點某張卡就是把**整個 item** 當
   `tablekey` 丟進下一步。舊後端若回 404，fallback 打 `?isDelegate=false` /
   `?isDelegate=true`（回傳直接是陣列）。
1. **`GET /api/WorkflowForm/GetFormInfo`** — 帶 `requestInfo`（即上一步的 item，
   對應 `RequestInfo` model），回傳該表單欄位定義 `forms[]`（每欄有 `allowEdit` /
   `readOnly` / `formType` / `allowAdd`）。**這步決定要填哪些欄位**。
2. （請假/加班專屬試算）請假呼叫 `leavecheck` / `leavecalc`；加班呼叫
   `EmpOT/GetOTCodeByDateType`（見下節）。
3. **`POST /api/WorkflowForm/Apply`** — `multipart/form-data`，兩個關鍵欄位：

```jsonc
// formData 欄位 1: requestInfo (= RequestInfo(tablekeyobj) 的 JSON 字串)
// formData 欄位 2: applyInfo   (JSON.stringify 後)
{
  "isDraft": false,            // true=存草稿（不進簽核）；false=正式送出
  "applyInfo": [               // rowdatasselect：依 GetFormInfo 欄位定義填的列資料
    {
      "RowFlag": "+",          // ⚠️ 每列必帶：+=新增, *=編輯。缺了會 500 {"error":"RowFlag is null"}
      "empotdata_otcode": "TWOT02"  // 其餘 key 用 columnName…
    }
  ],
  "deleteAttachments": [],
  "addAttachments": [ { "Name": "...", "Description": "" } ], // 對應 Attachment_0、Attachment_1...
  "runTimeApproverGroups": [],
  "mustAllApprove": [],
  "notes": ""
}
// 附件另外用 formData.append("Attachment_" + i, blob, filename)
```

`operation` 切換動作：`post`→`Apply`、`approve`→`PUT Approve`、`refuse`→`PUT Refuse`、`delete`→`DELETE Delete`。

> ⚠️ **`RowFlag`**：`applyInfo[]` 每筆列物件都要帶（App 在送出前對每列塞
> `rowdata['RowFlag'] = this.RowFlag`）。新增申請＝`"+"`、編輯既有列＝`"*"`。
> 漏帶後端回 `500 {"error":"RowFlag is null"}`（實測 cf_wf_OvertimeApp）。
> `isDraft=false` 每次都是**新建一張**申請，不會把既有草稿轉正——要轉正得在
> `requestInfo` 帶該草稿的 `forminstanceid`。

`requestInfo` 經 `RequestInfo` model 過濾，只保留白名單欄位（`main.js` model
`RequestInfo.ts`）；建立新申請最少要 `formcode`，多數表單還需 `formtype`。完整欄位：

```
applicant, forminstanceid, workflowinstanceid, applicationtype, applicationversion,
workflowcode, positioncode, action, submityype, workflowstatus, step, workflowstep,
stepstatus, payrollgroupid, formcode, formtype, listformtype, arguments, inputarguments,
writable, monitor, monitorapp, inconsult, consultempId, enquirername, noreply, showreply,
runtimeApprover, allapprove, nextautoapprove, nextstepruntime, approver, delegateApprover,
isnextruntimeapprover, applicationversion_code, workflowstatus_code, stepstatus_code, submittype
```

> ⚠️ `applyInfo[]` **沒有固定 schema**，內容完全由 `GetFormInfo` 回的欄位定義驅動，
> 每家公司、每種表單都可能不同。整合前一定要先對目標表單實打一次 `GetFormInfo`。

#### 用 `take5-clock.ts` 探測表單

`take5-clock.ts` 內建三支探測子指令，沿用既有的「解析公司 → 登入」流程：

```bash
# 1) 發現 formcode：列出「可申請的表單」(權威來源，新人沒歷史單也查得到)
npx tsx take5-clock.ts applytypes

# 2) dump 表單欄位 schema
npx tsx take5-clock.ts forminfo <formcode> [formtype]
npx tsx take5-clock.ts forminfo '{"formcode":"...","formtype":1,"applicationtype":"..."}'

# (備案) 從既有申請單反查 formcode
npx tsx take5-clock.ts forms my-leave-pendings   # 請假類
npx tsx take5-clock.ts forms my-closed           # 已結案（含加班等其他類）
```

- `applytypes` 打 `GetApplicationTypes`，每筆輸出
  `{folder, formcode, formtype, typename, applicationtype}`。**這是找 formcode 的首選**。
- `forms` 打 `GetMy*ApplicationsList`，從歷史申請反查；alias：`my-pendings`（預設）、
  `my-leave-pendings`、`my-closed`、`my-leave-closed`，也可直接給 `/api/...` 路徑。
- 兩者輸出的每筆都可**整包丟給 `forminfo`** 最保險（欄位齊全）。

### 請假 / 加班計算

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/LeaveCalc` | 請假計算（時數試算） |
| POST | `/api/leavecalc` | 同上的另一個大小寫變體（IIS 通常 case-insensitive） |
| POST | `/api/leavecheck` | 請假驗證（是否符合規則） |
| GET | `/api/EmpOT/GetOTCodeByDateType` | 加班碼查詢（依日期類型） |

### 請假 / 加班表單欄位（GetFormInfo 實測）

> 以下為 ACME（`applicationtype` 後綴 `TW`）實際 `GetFormInfo` 回傳結果。
> `applyInfo[]` 內每筆物件的 key 用 **`columnName`**；下拉值直接內嵌在回傳的
> `lookups`（key 格式 `<table>.<column>`），**不必另外打 `GetAllRefLookup`**。
> `fieldType`：`0=NVARCHAR 1=DATETIME 2=Integer 3=Boolean 4=NText 5=Float 6=TextInfo 7=File`。

#### 休假申請 `cf_wf_LeaveApp`（table `empleavedata`，23 欄）

實際要填（required 且非 readOnly/hide）：

| columnName | 欄位 | type | 必填 | 備註 |
|---|---|---|:---:|---|
| `empleavedata_empid` | 員工 | Integer | ✓ | KEY/RO，帶自己的 empid |
| `empleavedata_leavecode` | 休假類型 | NVARCHAR | ✓ | lookup（見下） |
| `empleavedata_specifyfromdate` | 休假開始日 | DATETIME | ✓ | |
| `empleavedata_specifytodate` | 休假結束日 | DATETIME | ✓ | |
| `empleavedata_leavefromtime` | 開始時間 | DATETIME | ✓ | |
| `empleavedata_leavetotime` | 結束時間 | DATETIME | ✓ | |
| `empleavedata_substitute` | 職務代理人 | NVARCHAR | ✓ | lookup `uvw_TW_emphr`，送 **empcode**（見下） |

計算 / 條件欄位（不主動填，或依 leavecode 由 `formEvent` JS 動態顯隱）：
`leavehours` / `leavedays` / `applyleavehours`（由 `leavecalc`/`leavecheck` 回填）、
`relation`（喪假等才出現）、`leavesubcode`（產假才出現）、`prebirthdate`（婚/喪/產事件日）、
`notes`（備註，選填）。

**休假類型 `leavecode`（lookup `uvw_tw_leavetype.leavecode`）：**

```
TW_AL 法定及非法定特休   TW_PL 事假     TW_SL 病假      TW_ML 生理假
TW_FL 喪假             TW_WL 婚假     TW_MTL 產假     TW_PEL 產檢假
TW_PTL 陪產檢及陪產假    TW_OL 公假     TW_OSL 公傷病假  TW_FCL 家庭照顧假
TW_CL 加班補休         TW_RL 安胎假    TW_JHL 謀職假   TW_BDL 生日假
TW_TH 颱風假           TW_WFH 在家工作
```

產假子類型 `leavesubcode`：`01`=8個月以上 / `02`=3個月以上 / `03`=2個月以上 / `04`=2個月以下。
親屬關係 `relation`：`01`~`31` 代碼表（`01`父 `02`母 `03`配偶 … 喪假才需要）。

#### 加班申請 `cf_wf_OvertimeApp`（table `empotdata`，15 欄）

| columnName | 欄位 | type | 必填 | 備註 |
|---|---|---|:---:|---|
| `empotdata_empid` | 申請人 | Integer | ✓ | KEY/RO，帶自己的 empid |
| `empotdata_otdate` | 加班日期 | DATETIME | ✓ | |
| `empotdata_otcode` | 加班類型 | NVARCHAR | ✓ | lookup（見下） |
| `empotdata_otfrom` | 開始時間 | DATETIME | ✓ | |
| `empotdata_otto` | 結束時間 | DATETIME | ✓ | |
| `empotdata_notes` | 事由 | NText | ✓ | |

選填 / 計算 / 旗標：`nextdayfrom` / `nextdayto`（跨次日 Boolean）、`othours`（由起訖算出）、
`mealhour`（用餐時數 RO，後端帶）、`expectcl`（轉補休；未勾＝發加班費 Boolean）、
`priorapp`（事先申請 Boolean，**default `1`**）。

**加班類型 `otcode`（lookup `ottype.otcode`）——台灣用 `TWOT*`：**

```
TWOT01 工作日加班   TWOT02 休息日加班   TWOT03 國定假日加班   TWOT04 例假日加班
```

> `OT01`~`OT03` 是中國版代碼（`applicationtype` 非 TW 時），台灣別用。

#### 職務代理人 `empleavedata_substitute`

- `fieldType=0`（NVARCHAR，長度 50）、`lookup=true`、`multiSelected=false`（單選）。
- lookup 來源 `uvw_TW_emphr`（key `uvw_tw_emphr.empcode`），map 為 `empcode → 員工姓名`，
  ACME 共 69 筆。
- ⚠️ **送出值是 `empcode`（員工代碼字串，如 `1002060`），不是 `empid`、也不是姓名。**
  注意與 `empleavedata_empid` 不同：員工欄位 ref `emphr.empid`（數字 empid），
  代理人欄位 ref `uvw_TW_emphr.empcode`（字串 empcode），兩者來源不同別混用。

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
deviceId={device_id}        ← 必填，空字串會回 400 {"error":"DeviceIdEmpty"}（見下方說明）
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

#### `deviceId` 來源（必填）

App 端在 `FcmService.initPush()`（`main.js:5912`）呼叫 `Capacitor Device.getId()` 取得：

| 平台 | 內容 |
|---|---|
| Android | `ANDROID_ID`（16 字元 hex 字串） |
| iOS | `identifierForVendor`（UUID） |
| Web / 其他 | Capacitor 自行生成的 UUID |

`AuthService.login()`（`main.js:3632`）會把這個值塞進登入表單的 `deviceId`。
後端只檢查非空字串，空字串會回 `400 {"error":"DeviceIdEmpty"}`，
所以從外部 script 呼叫時必須帶任意非空字串（建議固定一組以維持同一裝置身分）。

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

# ── 補打卡 / 簽核（WorkflowForm，21）────────────────
POST /api/WorkflowForm/Apply
GET  /api/WorkflowForm/GetApplicationTypes
GET  /api/WorkflowForm/GetFormInfo
GET  /api/WorkflowForm/GetAllRefLookup
POST /api/WorkflowForm/Approve
POST /api/WorkflowForm/Refuse
POST /api/WorkflowForm/BatchApprove
POST /api/WorkflowForm/BatchRefuse
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
