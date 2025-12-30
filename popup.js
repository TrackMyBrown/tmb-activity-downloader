const form = document.getElementById("export-form");
const statusEl = document.getElementById("status");
const fetchBtn = document.getElementById("fetchBtn");
const fromInput = document.getElementById("fromDate");
const toInput = document.getElementById("toDate");

const normalizeDateInput = (raw) => {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, "");
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}/${month}/${year.slice(-2)}`;
  }
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  const [, dayPart, monthPart, yearPart] = match;
  const day = parseInt(dayPart, 10);
  const month = parseInt(monthPart, 10);
  if (Number.isNaN(day) || Number.isNaN(month) || day < 1 || day > 31 || month < 1 || month > 12) {
    return null;
  }
  const yearTwoDigits = yearPart.slice(-2);
  return `${day.toString().padStart(2, "0")}/${month.toString().padStart(2, "0")}/${yearTwoDigits}`;
};

const toApiDate = (ddmmyy) => {
  if (!ddmmyy) return null;
  const [day, month, shortYear] = ddmmyy.split("/");
  if (!day || !month || !shortYear) return null;
  const yearFourDigits = shortYear.length === 4 ? shortYear : `20${shortYear}`;
  return `${day}/${month}/${yearFourDigits}`;
};

const getDateFromNormalized = (normalized) => {
  const apiFormat = toApiDate(normalized);
  if (!apiFormat) return null;
  const [day, month, year] = apiFormat.split("/");
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
};

const MAX_RANGE_DAYS = 732;

const isRangeWithinLimit = (normalizedFrom, normalizedTo) => {
  const fromDate = getDateFromNormalized(normalizedFrom);
  const toDate = getDateFromNormalized(normalizedTo);
  if (!fromDate || !toDate) return false;
  const diffMs = Math.abs(toDate.getTime() - fromDate.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= MAX_RANGE_DAYS;
};

let isSubmitting = false;

const hasValidDate = (inputEl) => {
  if (!inputEl) return false;
  return Boolean(normalizeDateInput(inputEl.value.trim()));
};

const resetStatus = () => {
  statusEl.textContent = "";
  statusEl.style.color = "#0f172a";
  statusEl.classList.remove("loading");
};

const setStatus = (message, color) => {
  statusEl.textContent = message;
  if (color) {
    statusEl.style.color = color;
  }
  statusEl.classList.remove("loading");
};

const showLoadingStatus = (message) => {
  statusEl.textContent = message;
  statusEl.style.color = "#2563eb";
  statusEl.classList.add("loading");
};

const updateButtonState = () => {
  if (isSubmitting) return;
  const ready = hasValidDate(fromInput) && hasValidDate(toInput);
  fetchBtn.disabled = !ready;
};

[fromInput, toInput].forEach((input) => {
  input?.addEventListener("input", () => {
    resetStatus();
    updateButtonState();
  });
});

updateButtonState();

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetStatus();
  isSubmitting = true;
  fetchBtn.disabled = true;
  fetchBtn.textContent = "Fetching…";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus("No active tab.", "#b91c1c");
      return;
    }
    if (!tab.url?.includes("sportsbet.com.au")) {
      setStatus("Active tab must already be on sportsbet.com.au while you're logged in.", "#b91c1c");
      return;
    }
    const fromDateRaw = document.getElementById("fromDate").value.trim();
    const toDateRaw = document.getElementById("toDate").value.trim();
    const normalizedFrom = normalizeDateInput(fromDateRaw);
    const normalizedTo = normalizeDateInput(toDateRaw);
    if (!normalizedFrom || !normalizedTo) {
      setStatus("Select valid From/To dates before downloading.", "#b91c1c");
      return;
    }
    const fromDateParam = toApiDate(normalizedFrom);
    const toDateParam = toApiDate(normalizedTo);
    if (!fromDateParam || !toDateParam) {
      setStatus("Something went wrong parsing your dates.", "#b91c1c");
      return;
    }
    if (!isRangeWithinLimit(normalizedFrom, normalizedTo)) {
      setStatus("Downloads limited to 24 months at a time. Try a smaller range.", "#b91c1c");
      return;
    }

    showLoadingStatus("Downloading… large ranges can take a while.");

    const execResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: runSportsbetExport,
      args: [{ displayFrom: normalizedFrom, displayTo: normalizedTo, fromDate: fromDateParam, toDate: toDateParam }],
      world: "MAIN",
    });
    const result = execResults?.[0]?.result;
    if (!result) {
      setStatus("Exporter couldn't run on this tab. Refresh sportsbet.com.au and try again.", "#b91c1c");
      return;
    }

    if (result.success) {
      setStatus(`Downloaded ${result.rowCount} rows to ${result.fileName}`, "#15803d");
    } else {
      setStatus(result.message || "Failed to export.", "#b91c1c");
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Unexpected error.", "#b91c1c");
  } finally {
    isSubmitting = false;
    fetchBtn.textContent = "Download CSV";
    updateButtonState();
  }
});

// Runs inside the Sportsbet tab.
async function runSportsbetExport(dates) {
  const { displayFrom, displayTo, fromDate, toDate } = dates || {};
  if (!displayFrom || !displayTo || !fromDate || !toDate) {
    return { success: false, message: "Invalid dates provided." };
  }

  function searchObject(obj, predicate) {
    if (!obj || typeof obj !== "object") return null;
    for (const [key, value] of Object.entries(obj)) {
      const hit = predicate(key, value);
      if (hit) return hit;
      if (typeof value === "object") {
        const nested = searchObject(value, predicate);
        if (nested) return nested;
      }
    }
    return null;
  }

  const jwtPartPattern = /^[A-Za-z0-9-_]+$/;

  function isLikelyJwt(token) {
    if (typeof token !== "string") return false;
    const trimmed = token.trim();
    if (!trimmed) return false;
    const parts = trimmed.split(".");
    if (parts.length !== 3) return false;
    if (!parts.every((part) => part.length >= 10 && jwtPartPattern.test(part))) return false;
    return true;
  }

  function inspectTokenCandidate(key, value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (isLikelyJwt(trimmed)) return trimmed;
    if (key && key.toLowerCase().includes("token") && trimmed.includes(".") && trimmed.length > 60) {
      return trimmed;
    }
    return null;
  }

  function findAccessToken() {
    const knownKeys = new Set([
      "accesstoken",
      "accesstokenv2",
      "accesstoken_v2",
      "accesstoken2",
      "accesstokenlatest",
      "accesstokenlegacy",
      "accesstokenprod",
      "cxp-token",
      "cxptoken",
      "cxpaccesstoken",
    ]);

    const sources = [window.localStorage, window.sessionStorage];
    for (const storage of sources) {
      if (!storage) continue;
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        const raw = storage.getItem(key);
        if (!raw) continue;
        const direct = inspectTokenCandidate(key, raw);
        if (direct) return direct;
        if (key && knownKeys.has(key.toLowerCase())) {
          const trimmed = raw.trim();
          if (isLikelyJwt(trimmed)) return trimmed;
        }
        try {
          const parsed = JSON.parse(raw);
          const nested = searchObject(parsed, (nestedKey, value) =>
            inspectTokenCandidate(nestedKey, value),
          );
          if (nested) return nested;
        } catch {
          continue;
        }
      }
    }

    const cookieMatch = document.cookie.match(/(?:^|;\s*)(accesstoken|accesstokenv2)=([^;]+)/i);
    if (cookieMatch) {
      const candidate = decodeURIComponent(cookieMatch[2]);
      if (isLikelyJwt(candidate)) return candidate;
    }
    const cxpCookie = document.cookie.match(/(?:^|;\s*)cxp-token=([^;]+)/i);
    if (cxpCookie) {
      const candidate = decodeURIComponent(cxpCookie[1]);
      if (isLikelyJwt(candidate)) return candidate;
    }

    return null;
  }

  function normalizeCustomerId(candidate) {
    const digits = candidate.replace(/\D+/g, "");
    if (digits.length >= 4 && digits.length <= 9) {
      return digits;
    }
    return null;
  }

  function inspectCustomerCandidate(key, value) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      const normalized = normalizeCustomerId(trimmed);
      if (normalized) return normalized;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const stringified = String(Math.round(value));
      const normalized = normalizeCustomerId(stringified);
      if (normalized) return normalized;
    }
    if (key && key.toLowerCase().includes("customer") && typeof value === "string" && value.length > 0) {
      const normalized = normalizeCustomerId(value);
      if (normalized) return normalized;
    }
    return null;
  }

  function decodeJwtPayload(token) {
    if (!isLikelyJwt(token)) return null;
    const [, payload] = token.split(".");
    try {
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      const json = atob(padded);
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function findCustomerId() {
    const sources = [window.localStorage, window.sessionStorage];
    for (const storage of sources) {
      if (!storage) continue;
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        const raw = storage.getItem(key);
        if (!raw) continue;
        const direct = inspectCustomerCandidate(key, raw);
        if (direct) return direct;
        try {
          const parsed = JSON.parse(raw);
          const nested = searchObject(parsed, (nestedKey, value) =>
            inspectCustomerCandidate(nestedKey, value),
          );
          if (nested) return nested;
        } catch {
          continue;
        }
      }
    }
    const cookieMatch = document.cookie.match(/customer-id=([^;]+)/i);
    if (cookieMatch) {
      const normalized = normalizeCustomerId(decodeURIComponent(cookieMatch[1]));
      if (normalized) return normalized;
    }
    return null;
  }

  const limit = 50;
  const base = "https://www.sportsbet.com.au/apigw/history/transactions";
  const cols = [
    "Time (AEST)",
    "Type",
    "Summary",
    "Transaction Id",
    "Bet Id",
    "Amount",
    "Balance",
    "Single",
    "Multiple",
    "Exotic",
    "Pool",
  ];

  const accessToken = findAccessToken();
  if (!accessToken) {
    return {
      success: false,
      message: "Could not find your Sportsbet login. Make sure you are signed in on sportsbet.com.au.",
    };
  }

  const tokenPayload = decodeJwtPayload(accessToken);
  const derivedId = tokenPayload?.custId || tokenPayload?.accountNo;
  const custId = derivedId && /^\d+$/.test(String(derivedId)) ? String(derivedId) : findCustomerId();
  if (!custId) {
    return {
      success: false,
      message: "Unable to detect your Sportsbet account ID. Visit Account > Transactions and try again.",
    };
  }

  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    apptoken: "cxp-desktop-web",
    channel: "cxp",
    accesstoken: accessToken,
    authorization: `Bearer ${accessToken}`,
    "cxp-token": accessToken,
    "customer-id": custId,
    "x-request-id": crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
  };

  const toDateObject = (value) => {
    if (!value && value !== 0) return null;
    if (value instanceof Date) return value;
    if (typeof value === "number") {
      const ms = value > 1e12 ? value : value * 1000;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (/^\d+$/.test(trimmed)) {
        const num = Number(trimmed);
        if (Number.isFinite(num)) {
          const ms = trimmed.length >= 13 ? num : num * 1000;
          const date = new Date(ms);
          return Number.isNaN(date.getTime()) ? null : date;
        }
      }
      const candidate = trimmed.includes(" ") ? trimmed.replace(" ", "T") : trimmed;
      const date = new Date(candidate);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  };

  const rows = [];
  let lastId = null;
  let lastTime = null;

  try {
    const extractTransactions = (payload) => {
      if (!payload || typeof payload !== "object") return [];
      const candidates = [
        payload.transactions,
        payload.items,
        payload.transactionList,
        payload?.transactions?.items,
        payload?.transactions?.transactions,
        payload?.data,
      ];
      for (const candidate of candidates) {
        if (Array.isArray(candidate) && candidate.length) {
          return candidate;
        }
      }
      return Array.isArray(payload) ? payload : [];
    };

    const getRawTimestamp = (tx) =>
      tx.transactionTime || tx.transactionDate || tx.date || tx.time || tx.transaction_time || null;

    const formatAsParamTimestamp = (value) => {
      const date = toDateObject(value);
      if (!date) {
        return value ? String(value) : null;
      }
      return date.toISOString().replace("T", " ").split(".")[0];
    };

    while (true) {
      const params = new URLSearchParams({
        dateType: "CUSTOM",
        filterType: "ALL",
        fromDate,
        toDate,
        limit: String(limit),
        sortOrder: "DESC",
      });
      if (lastId) {
        params.set("lastId", lastId);
        if (lastTime) params.set("lastTime", lastTime);
      }
      const response = await fetch(`${base}?${params.toString()}`, {
        headers,
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Sportsbet responded ${response.status}`);
      }

      const data = await response.json();
      const chunk = extractTransactions(data);
      if (!chunk.length) {
        break;
      }
      rows.push(...chunk);
      const last = chunk[chunk.length - 1];
      lastId = last.transactionId || last.transactionID || last.id;
      const rawTs = getRawTimestamp(last);
      lastTime = formatAsParamTimestamp(rawTs);
      if (!lastId || chunk.length < limit) {
        break;
      }
    }

    if (!rows.length) {
      return { success: false, message: "No transactions found for that date range." };
    }

    const escapeVal = (val) => `"${String(val ?? "").replace(/"/g, '""')}"`;
    const toBool = (value) => {
      if (typeof value === "boolean") return String(value);
      if (typeof value === "string") {
        const lower = value.trim().toLowerCase();
        if (lower === "true" || lower === "false") return lower;
      }
      return "false";
    };
    const toDecimal = (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num.toFixed(2) : String(value ?? "0");
    };
    const formatTimestamp = (value) => {
      if (!value && value !== 0) return "";
      const date = toDateObject(value);
      if (!date) return typeof value === "number" ? String(value) : value;
      const datePart = date.toLocaleDateString("en-AU", { day: "2-digit", month: "2-digit", year: "numeric" });
      const timePart = date.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false });
      return `${datePart} ${timePart}`;
    };
    const mapRow = (tx) => ({
      "Time (AEST)": formatTimestamp(getRawTimestamp(tx) || tx.createdAt),
      Type: tx.type || tx.transactionType || "",
      Summary: tx.summary || tx.description || tx.detail || "",
      "Transaction Id": tx.transactionId || tx.id || "",
      "Bet Id": tx.betId || tx.betSlipId || tx.wagerId || "",
      Amount: toDecimal(tx.amount || tx.value || tx.stakeChange || tx.credit || tx.debit || 0),
      Balance: toDecimal(tx.balance || tx.balanceAmount || tx.runningBalance || 0),
      Single: toBool(tx.single || tx.isSingle),
      Multiple: toBool(tx.multiple || tx.isMulti),
      Exotic: toBool(tx.exotic || tx.isExotic),
      Pool: toBool(tx.pool || tx.isPool),
    });

    const csvLines = [cols.map((col) => `"${col}"`).join(",")];
    rows.forEach((tx) => {
      const mapped = mapRow(tx);
      csvLines.push(cols.map((col) => escapeVal(mapped[col])).join(","));
    });

    const csvContent = csvLines.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const fileName = `sportsbet-transactions-${displayFrom.replace(/\//g, "-")}-to-${displayTo.replace(/\//g, "-")}.csv`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 1000);

    return { success: true, rowCount: rows.length, fileName };
  } catch (error) {
    return { success: false, message: error.message };
  }
}
