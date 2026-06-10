/**
 * take5-clock.ts — Take5 Portal 登入到打卡的最小範例
 *
 * 用法（Node 18+，內建 fetch）：
 *   1. 複製 .env.example 為 .env，填入 COMPANY_CODE/EMAIL/PASSWORD/LATITUDE/LONGITUDE
 *   2. npx tsx take5-clock.ts          # 走 .env
 *      npx tsx take5-clock.ts in       # 也可以額外傳 in|out 覆寫 IN_OUT
 *
 * 對應 App 內部流程（從反編譯結果還原）：
 *   1. GET  https://take5people.net/T5PCompanyAPI/api/GetCompany?cid=<code>
 *      → 取得該公司的 ApiUrl
 *   2. POST {ApiUrl}/Token            (form-urlencoded, OAuth password grant)
 *      → 取得 access_token
 *   3. GET  {ApiUrl}/api/Employee     (Bearer token)
 *      → 拿 empId / machineGroup.code / machineList
 *   4. POST {ApiUrl}/api/ATS/clockInOut (Bearer token, JSON)
 *      → 打卡
 *
 * 注意：本檔僅示範 GPS 模式。Wi-Fi / Bluetooth 模式 App 端會先驗證 SSID
 * 或掃 iBeacon UUID，後端只看 ValidType 與座標。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

// ─── 常數 ─────────────────────────────────────────────────────
const GROUP_BASE_URL = "https://take5people.net/T5PCompanyAPI";

// 對應 src/app/model/clockInOut/clockInOut.ts 的 enum clockValidType
enum ClockValidType {
  None = 0,
  GPS = 1,
  WiFi = 2,
  Bluetooth = 3,
}

// App 用的 deviceType 字串（HttpUtilsService.ajaxLoginPost 裡的 mapping）
type DeviceType =
  | "android"
  | "ios"
  | "androidchina"
  | "wecomios"
  | "wecomandroid"
  | "other";

// ─── Types ────────────────────────────────────────────────────
interface CompanyInfo {
  ApiUrl: string;
  CompanyCode: string;
  [k: string]: unknown;
}

interface OAuthToken {
  access_token: string;
  token_type: string; // 通常 "bearer"
  expires_in: number;
  refresh_token?: string;
  [k: string]: unknown;
}

// /api/Employee 回的是 ASP.NET 後端 DTO，外層 PascalCase；MachineGroup 內欄位 camelCase；EmpInfo 內欄位 lowercase
interface ApiMachine {
  machineCode: string;
  machineName?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  range?: number;
  wifiOnly?: boolean;
  networkSegment?: string;
  bluetoothOnly?: boolean;
  bluetoothUuid?: string;
  bluetoothMajor?: number;
  bluetoothMinor?: number;
  [k: string]: unknown;
}

interface ApiMachineGroup {
  code: string;
  ioTimes?: number;
  isTrustIO?: boolean;
  useMobileClockInOut?: boolean;
  latitude?: number;
  longitude?: number;
  range?: number;
  wifiOnly?: boolean;
  networkSegment?: string;
  bluetoothOnly?: boolean;
  bluetoothUuid?: string;
  machineList?: ApiMachine[];
  [k: string]: unknown;
}

interface ApiEmpInfo {
  empid: string | number;
  empname?: string;
  userid?: string | number;
  usercode?: string;
  defaultmachinegroupcode?: string;
  countrycode?: string;
  atslocation?: string;
  [k: string]: unknown;
}

interface EmployeeResponse {
  EmpInfo: ApiEmpInfo;
  MachineGroup?: ApiMachineGroup;
  MobileCanOffsiteClock?: boolean;
  [k: string]: unknown;
}

interface ClockInOutPayload {
  sourceType: string;
  InOut: boolean; // true=上班, false=下班(非 trustIO 機器永遠 false，後端決定)
  EmpId: string | number;
  Latitude: number;
  Longitude: number;
  MachineCode: string;
  MachineGroupCode: string;
  TimeZoneMinutesOffset: number;
  ValidType: ClockValidType;
}

interface ClockInOutResponse {
  Time: string; // "yyyy/MM/dd HH:mm:ss"
  [k: string]: unknown;
}

// ─── Client ───────────────────────────────────────────────────
class Take5Client {
  private apiUrl?: string;
  private token?: OAuthToken;
  private companyCode?: string;

  /** 1. 用公司代碼換該公司的 ApiUrl（不需 token） */
  async resolveCompany(companyCode: string): Promise<CompanyInfo> {
    const url = `${GROUP_BASE_URL}/api/GetCompany?cid=${encodeURIComponent(companyCode)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`GetCompany failed: ${res.status} ${await res.text()}`);
    }
    const info = (await res.json()) as CompanyInfo;
    if (!info.ApiUrl) {
      throw new Error("GetCompany 回傳沒有 ApiUrl，請確認 companyCode");
    }
    this.apiUrl = info.ApiUrl;
    // 重要：登入時用的 ccode 必須來自 server 回傳的 CompanyCode，不是用戶輸入的 cid
    // (App 行為，見 login_module:303 / main.js:4075)
    this.companyCode = info.CompanyCode || companyCode;
    return info;
  }

  /** 2. OAuth password grant 換 access_token */
  async login(opts: {
    email: string;
    password: string;
    deviceId: string; // 後端會驗證非空，空字串會回 400 {"error":"DeviceIdEmpty"}
    deviceType?: DeviceType;
  }): Promise<OAuthToken> {
    if (!this.apiUrl || !this.companyCode) {
      throw new Error("請先呼叫 resolveCompany()");
    }
    if (!opts.deviceId) {
      throw new Error("deviceId 不可為空（後端會回 DeviceIdEmpty）");
    }
    const body = new URLSearchParams({
      grant_type: "password",
      username: opts.email,
      password: opts.password,
      ccode: this.companyCode,
      deviceId: opts.deviceId,
      deviceType: opts.deviceType ?? "android",
    });
    const res = await fetch(`${this.apiUrl}/Token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new Error(`Login failed: ${res.status} ${await res.text()}`);
    }
    this.token = (await res.json()) as OAuthToken;
    return this.token;
  }

  private authHeaders(extra: Record<string, string> = {}): HeadersInit {
    if (!this.token) throw new Error("尚未登入");
    return {
      "Content-Type": "application/json",
      Authorization: `${this.token.token_type} ${this.token.access_token}`,
      ...extra,
    };
  }

  /** 3. 拿員工資訊（含 MachineGroup.machineList）。id=0 表示自己（App 預設） */
  async getEmployee(id = 0): Promise<EmployeeResponse> {
    const res = await fetch(`${this.apiUrl}/api/Employee?id=${id}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`GetEmployee failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as EmployeeResponse;
  }

  /** 4. 送出打卡 */
  async clockInOut(payload: ClockInOutPayload): Promise<ClockInOutResponse> {
    const res = await fetch(`${this.apiUrl}/api/ATS/clockInOut`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`ClockInOut failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as ClockInOutResponse;
  }

  /**
   * 取簽核清單。回傳是陣列，每個 item 本身就是可餵回 getFormInfo() 的
   * requestInfo（App 內的 tablekeyobj）。常用來「發現」公司有哪些 formcode。
   * @param path 例如 /api/WorkflowForm/GetMyPendingApplicationsList
   */
  async getWorkflowList(path: string): Promise<unknown> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`GetWorkflowList failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  /**
   * GET /api/WorkflowForm/GetApplicationTypes — 取「可申請的表單清單」。
   * 這是 formcode 的權威來源（App 新增申請頁用的）。回傳每個 item 本身就是
   * 可餵回 getFormInfo() / Apply 的 tablekey(requestInfo)。
   * 新後端回 { ApplicationTypes, DelegateApplicationTypes }；舊後端回陣列。
   */
  async getApplicationTypes(isDelegate = false): Promise<unknown> {
    const qs = new URLSearchParams({ isDelegate: String(isDelegate) });
    const res = await fetch(
      `${this.apiUrl}/api/WorkflowForm/GetApplicationTypes?${qs.toString()}`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) {
      throw new Error(`GetApplicationTypes failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  /**
   * GET /api/WorkflowForm/GetFormInfo — 取單一表單的欄位定義（dynamic form schema）。
   * requestInfo 對應 App 的 RequestInfo model；建立新申請時最少要帶 formcode，
   * 多數表單還需要 formtype。可把 getWorkflowList() 回的某個 item 整包丟進來。
   */
  async getFormInfo(requestInfo: Record<string, unknown>): Promise<unknown> {
    const qs = new URLSearchParams({ requestInfo: JSON.stringify(requestInfo) });
    const res = await fetch(
      `${this.apiUrl}/api/WorkflowForm/GetFormInfo?${qs.toString()}`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) {
      throw new Error(`GetFormInfo failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }
}

// ─── .env loader（無依賴，極簡版） ─────────────────────────────
function loadEnv(path = ".env"): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), path), "utf8");
  } catch {
    return; // 沒有 .env 就跳過
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    // 去掉成對的引號
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`缺少環境變數 ${key}（請填 .env 或 export）`);
  return v;
}

// 把生成的 DEVICE_ID 寫回 .env：有既有的 DEVICE_ID= 行就就地更新，否則 append。
// 回傳是否成功寫入。
function persistDeviceId(id: string, path = ".env"): boolean {
  const full = resolve(process.cwd(), path);
  let raw = "";
  try {
    raw = readFileSync(full, "utf8");
  } catch {
    raw = ""; // 沒有 .env 就建一個新的
  }
  const line = `DEVICE_ID=${id}`;
  if (/^DEVICE_ID=.*$/m.test(raw)) {
    raw = raw.replace(/^DEVICE_ID=.*$/m, line);
  } else {
    if (raw.length && !raw.endsWith("\n")) raw += "\n";
    raw += line + "\n";
  }
  try {
    writeFileSync(full, raw, "utf8");
    return true;
  } catch {
    return false;
  }
}

// App 端的 deviceId 來自 Capacitor Device.getId():
//   - Android: ANDROID_ID（16 字元 hex）
//   - iOS:     identifierForVendor（UUID）
// 後端只檢查非空，但要固定一組，避免每次被當成新裝置上線。
// 沒設定時自動生成並寫回 .env，下次沿用同一份。
function getOrGenerateDeviceId(): string {
  const fromEnv = process.env.DEVICE_ID?.trim();
  if (fromEnv) return fromEnv;
  const generated = randomBytes(8).toString("hex"); // 模擬 Android ID
  process.env.DEVICE_ID = generated; // 本次執行後續也用同一份
  const saved = persistDeviceId(generated);
  if (saved) {
    console.warn(`[warn] DEVICE_ID 未設定，已自動生成並寫回 .env: ${generated}`);
  } else {
    console.warn(
      `[warn] DEVICE_ID 未設定，已自動生成: ${generated}\n` +
        `       （寫回 .env 失敗，請手動加上 DEVICE_ID=${generated} 以維持同一裝置身分）`,
    );
  }
  return generated;
}

// Haversine — 兩點之間的地表距離（公尺），跟 App utils.getGPSDistance 同義
function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── 共用：解析公司 + 登入 ────────────────────────────────────
async function connect(): Promise<Take5Client> {
  const companyCode = requireEnv("COMPANY_CODE");
  const email = requireEnv("EMAIL");
  const password = requireEnv("PASSWORD");

  const client = new Take5Client();
  const company = await client.resolveCompany(companyCode);
  console.log("[connect] ApiUrl =", company.ApiUrl);
  const deviceId = getOrGenerateDeviceId();
  await client.login({
    email,
    password,
    deviceId,
    deviceType: (process.env.DEVICE_TYPE as DeviceType) ?? "android",
  });
  console.log("[connect] 已登入:", email);
  return client;
}

// ─── 子指令：可申請表單清單（formcode 權威來源）──────────────
async function runApplyTypes(): Promise<void> {
  const client = await connect();
  console.log("[applytypes] GET /api/WorkflowForm/GetApplicationTypes");
  const raw = (await client.getApplicationTypes(false)) as
    | { ApplicationTypes?: Array<Record<string, unknown>> }
    | Array<Record<string, unknown>>;
  // 新後端回物件 { ApplicationTypes, ... }；舊後端直接回陣列
  const types: Array<Record<string, unknown>> = Array.isArray(raw)
    ? raw
    : raw.ApplicationTypes ?? [];
  if (types.length === 0) {
    console.log("（沒有可申請的表單，可能此帳號未開放申請或公司未設定）");
    if (process.env.DEBUG) console.log(JSON.stringify(raw, null, 2));
    return;
  }
  console.log(`共 ${types.length} 種可申請表單。每筆可整包餵回 forminfo：\n`);
  for (const item of types) {
    const pick = {
      folder: item.folder,
      formcode: item.formcode,
      formtype: item.formtype,
      typename: item.typename,
      applicationtype: item.applicationtype,
    };
    console.log(JSON.stringify(pick));
  }
  if (process.env.DEBUG) {
    console.log("\n[DEBUG] 原始回傳:\n", JSON.stringify(raw, null, 2));
  }
}

// ─── 子指令：簽核清單（發現可用 formcode）────────────────────
// list item 本身就是可餵回 getFormInfo() 的 requestInfo
const WORKFLOW_LIST_ALIASES: Record<string, string> = {
  "my-pendings": "/api/WorkflowForm/GetMyPendingApplicationsList",
  "my-leave-pendings": "/api/WorkflowForm/GetMyPendingLeaveApplicationsList",
  "my-closed": "/api/WorkflowForm/GetMyClosedApplicationsList",
  "my-leave-closed": "/api/WorkflowForm/GetMyClosedLeaveApplicationsList",
};

async function runForms(): Promise<void> {
  // 第 3 個 argv：alias（見上表）或直接給 /api/... 路徑，預設 my-pendings
  const arg = process.argv[3] ?? "my-pendings";
  const path = arg.startsWith("/api/") ? arg : WORKFLOW_LIST_ALIASES[arg];
  if (!path) {
    throw new Error(
      `未知的清單別名 "${arg}"。可用：${Object.keys(WORKFLOW_LIST_ALIASES).join(", ")}（或直接給 /api/... 路徑）`,
    );
  }
  const client = await connect();
  console.log("[forms] GET", path);
  const list = (await client.getWorkflowList(path)) as Array<Record<string, unknown>>;
  if (!Array.isArray(list) || list.length === 0) {
    console.log("（清單為空，換個別名試試，或先在 App 送一張申請單）");
    return;
  }
  console.log(`共 ${list.length} 筆。各 item 可整包餵回 forminfo：\n`);
  for (const item of list) {
    // 挑出做 GetFormInfo 探測會用到的關鍵欄位
    const pick = {
      formcode: item.formcode,
      formtype: item.formtype,
      typename: item.typename,
      applicationtype: item.applicationtype,
      forminstanceid: item.forminstanceid,
    };
    console.log(JSON.stringify(pick));
  }
  if (process.env.DEBUG) {
    console.log("\n[DEBUG] 原始 list:\n", JSON.stringify(list, null, 2));
  }
}

// ─── 子指令：GetFormInfo（dump 表單欄位 schema）──────────────
async function runFormInfo(): Promise<void> {
  // forminfo <formcode> [formtype]    或    forminfo '{"formcode":"...",...}'
  const a3 = process.argv[3];
  if (!a3) {
    throw new Error(
      "用法：forminfo <formcode> [formtype]  或  forminfo '<requestInfo JSON>'",
    );
  }
  let requestInfo: Record<string, unknown>;
  if (a3.trim().startsWith("{")) {
    requestInfo = JSON.parse(a3);
  } else {
    requestInfo = { formcode: a3 };
    if (process.argv[4]) requestInfo.formtype = process.argv[4];
  }
  const client = await connect();
  console.log("[forminfo] requestInfo =", JSON.stringify(requestInfo));
  const info = await client.getFormInfo(requestInfo);
  console.log(JSON.stringify(info, null, 2));
}

// ─── 子指令：打卡（原本的流程）───────────────────────────────
async function runClock(inOutArg?: string): Promise<void> {
  const companyCode = requireEnv("COMPANY_CODE");
  const email = requireEnv("EMAIL");
  const password = requireEnv("PASSWORD");
  const lat = requireEnv("LATITUDE");
  const lng = requireEnv("LONGITUDE");
  const inOut = (inOutArg ?? process.env.IN_OUT) === "in"; // 'in' → true(上班), 其他 → false(下班/統一打卡)

  const client = new Take5Client();

  console.log("[1/4] 解析公司:", companyCode);
  const company = await client.resolveCompany(companyCode);
  console.log("      ApiUrl       =", company.ApiUrl);
  console.log("      CompanyCode  =", company.CompanyCode, "(登入會用這個 ccode)");
  if (process.env.DEBUG) {
    console.log("      raw response =", JSON.stringify(company, null, 2));
  }

  console.log("[2/4] 登入:", email);
  const deviceId = getOrGenerateDeviceId();
  const token = await client.login({
    email,
    password,
    deviceId,
    deviceType: (process.env.DEVICE_TYPE as DeviceType) ?? "android",
  });
  console.log(
    "      token_type =", token.token_type,
    ", expires_in =", token.expires_in,
  );

  console.log("[3/4] 取員工資訊");
  const emp = await client.getEmployee(0);
  if (process.env.DEBUG) {
    console.log(
      "      Employee summary:",
      JSON.stringify(
        {
          EmpInfo: emp.EmpInfo,
          MachineGroup: emp.MachineGroup
            ? { code: emp.MachineGroup.code, machineList_count: emp.MachineGroup.machineList?.length ?? 0 }
            : null,
        },
        null,
        2,
      ),
    );
  }
  if (!emp.MachineGroup) {
    throw new Error("該員工沒有 MachineGroup（後端未指派打卡機群組）");
  }
  const machineList = emp.MachineGroup.machineList ?? [];
  if (machineList.length === 0) {
    throw new Error(
      `MachineGroup.machineList 為空（code=${emp.MachineGroup.code}）。可能此公司啟用的是 Wi-Fi/藍牙模式，或員工尚未指派打卡點`,
    );
  }
  // 過濾掉只能用 wifi/bluetooth 的機器，挑第一台支援 GPS 的
  const machine = machineList.find((m) => !m.wifiOnly && !m.bluetoothOnly) ?? machineList[0];
  // machine 自己有 range 就用，沒有就退到 machineGroup 的 range
  const machineRadius = machine.range ?? emp.MachineGroup.range;
  const machineLat =
    typeof machine.latitude === "string" ? parseFloat(machine.latitude) : machine.latitude;
  const machineLng =
    typeof machine.longitude === "string" ? parseFloat(machine.longitude) : machine.longitude;
  console.log(
    "      empid       =", emp.EmpInfo.empid,
    "\n      machineCode =", machine.machineCode,
    machine.machineName ? `(${machine.machineName})` : "",
    "\n      groupCode   =", emp.MachineGroup.code,
    "\n      machineLoc  =", machineLat, ",", machineLng, `(radius=${machineRadius}m)`,
  );

  // USE_MACHINE_LOCATION=1 → 直接用 machine 座標（保證在 range 內）
  const useMachineLoc = process.env.USE_MACHINE_LOCATION === "1";
  const sendLat = useMachineLoc && machineLat !== undefined ? machineLat : parseFloat(lat);
  const sendLng = useMachineLoc && machineLng !== undefined ? machineLng : parseFloat(lng);

  if (machineLat !== undefined && machineLng !== undefined) {
    const distance = haversineMeters(sendLat, sendLng, machineLat, machineLng);
    const inRange = machineRadius === undefined || distance <= machineRadius;
    console.log(
      `      距離       = ${distance.toFixed(1)}m`,
      machineRadius !== undefined ? ` / radius ${machineRadius}m` : "",
      inRange ? "✓ 在範圍內" : "✗ 超出範圍 — 後端可能標記為越界紀錄，不計入正規打卡",
    );
  }

  console.log(
    `[4/4] 送出打卡 (GPS) ${inOut ? "上班" : "下班"} — ${sendLat}, ${sendLng}`,
    useMachineLoc ? "(USE_MACHINE_LOCATION=1)" : "",
  );
  const result = await client.clockInOut({
    sourceType: "android",
    InOut: inOut,
    EmpId: emp.EmpInfo.empid,
    Latitude: sendLat,
    Longitude: sendLng,
    MachineCode: machine.machineCode,
    MachineGroupCode: emp.MachineGroup.code,
    TimeZoneMinutesOffset: 0, // App 內部寫死 0，由後端處理時區
    ValidType: ClockValidType.GPS,
  });
  console.log("✓ 打卡成功:", result.Time);
}

// ─── main：依子指令分派 ───────────────────────────────────────
//   npx tsx take5-clock.ts                  → 打卡（依 .env IN_OUT）
//   npx tsx take5-clock.ts in|out           → 打卡（覆寫 IN_OUT）
//   npx tsx take5-clock.ts applytypes       → 列可申請表單（formcode 權威來源）
//   npx tsx take5-clock.ts forms [alias]    → 列既有申請單（formcode 備案來源）
//   npx tsx take5-clock.ts forminfo <code>  → dump 表單欄位 schema
async function main(): Promise<void> {
  loadEnv();
  const sub = process.argv[2];
  if (sub === "applytypes") return runApplyTypes();
  if (sub === "forms") return runForms();
  if (sub === "forminfo") return runFormInfo();
  return runClock(sub); // sub 為 in|out|undefined
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("✗", msg);
  process.exit(1);
});
