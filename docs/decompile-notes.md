# Take5 Portal — APK 反編譯筆記

`take5.apk` v2.0.2 的反編譯結果與分析筆記。原始 APK 與反編譯產物
（`take5-decompiled/`）皆被 `.gitignore` 排除，不入版控。

## App 基本資訊

| | |
|---|---|
| Package | `com.take5people.portal` |
| 版本 | 2.0.2 (versionCode 129) |
| Min / Target SDK | 26 / 35 |
| 框架 | Capacitor + Ionic + Angular（Hybrid Web App） |
| 主要 Activity | `com.take5people.portal.MainActivity`（薄殼，僅注入 safe-area） |
| 真正邏輯位置 | `take5-decompiled/resources/assets/public/*.js`（Angular bundle） |
| Deep Link | `https://take5people.com` |
| Source map | release 包含完整 `.js.map`（可還原近乎原始 TS） |

## 反編譯指令

```bash
# 用 android-reverse-engineering Claude Code skill 提供的腳本
bash <skill-cache>/skills/android-reverse-engineering/scripts/decompile.sh take5.apk

# 或直接用 jadx
jadx -d take5-decompiled --show-bad-code take5.apk
```

產物大致結構：

```
take5-decompiled/
├── resources/
│   ├── AndroidManifest.xml
│   └── assets/
│       ├── capacitor.config.json
│       └── public/                     ← 主要邏輯都在這
│           ├── main.js                 (786KB)
│           ├── common.js               (124KB) ← service 層
│           ├── src_app_pages_clockinout_clockinout_module_ts.js
│           ├── src_app_pages_site-clock_*.js
│           └── ...
└── sources/
    └── com/take5people/portal/
        └── MainActivity.java           ← 145 行薄殼
```

## 反編譯產物路徑速查

> 路徑相對於 `take5-decompiled/resources/assets/public/`

| 內容 | 檔案 / 行號 |
|---|---|
| 環境設定（domain, googleMapKey, version） | `main.js` module `92340` |
| Token 與 ApiUrl 儲存（Capacitor Preferences） | `main.js:8265` `setServer` / `:8274` `getServer` |
| 公司解析 | `main.js:4264` `CompanyService.getCompanyInfo` |
| 登入（OAuth password grant） | `main.js:7926` `HttpUtilsService.ajaxLoginPost` |
| AuthService.login（含 2FA 流程） | `main.js:3599` |
| Authorization header 組裝 | `main.js:9729` `getAuthedHeader` |
| Employee DTO 解析 | `main.js:4809` `convertToEmployeeInfo` |
| **AtsService（打卡核心）** | `common.js:162` |
| 打卡頁 ClockinoutPage UI 邏輯 | `src_app_pages_clockinout_clockinout_module_ts.js` |
| `clockInOutClick()` payload 組裝 | `clockinout_module:1058-1163` |
| `ValidType` enum 定義 | `clockinout_module:23-29` |
| iBeacon 掃描 (`Take5PortalIBeacons`) | `clockinout_module:457-520` |
| `checkCanClock()` GPS 距離檢查 | `clockinout_module:1232-1240` |

## 安全 / 資安觀察

- **開發者路徑外洩** — bundle 內含 `/Users/danieltang/Documents/Git/T5P/src/T5P_APP_Ionic/...` 路徑（webpack 沒清掉 babel-runtime 的絕對路徑 import）
- **Source map 一起打包進 release apk** — 可用來還原近乎原始的 TypeScript
- **多支金鑰直接內嵌**：
  - Google Maps API key `AIzaSyCSzSb2-qkQblfcOK_lKPDPBGsplrfc5J0`
  - aMap key `4337e91789a4731e5c65e6e9475aba07`
- **Manifest 設定**：
  - `usesCleartextTraffic="true"`
  - `allowBackup="true"`
- **後端錯誤頁開了 verbose mode**（`customErrors mode="Off"`，會洩露 stack trace 與 server 路徑 `E:\_TFS\src\Take5API\...`）
- **後端在錯誤訊息夾 `(empid=...)`**，前端用 `error.message.split('(empid=')[0]` 切掉再顯示
