/**
 * contractEditManual/index.js
 * (수동) 급여계약내용 등록/변경/해지 프로세스
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

// 공통 유틸리티 및 프로세스 모듈 로드
const { smartClick } = require("../utils/click");
const { selectMultiplePersons } = require("../contractEdit/process3_select");
const { inputServiceTime } = require("../contractEdit/process4_time");
const { selectComboItem } = require("../contractEdit/process5_method");
const { finalizeInput } = require("../contractEdit/process6_grid");
const { selectServiceDays } = require("../contractEdit/process7_calendar");

/**
 * [입력] 버튼 클릭 (행 추가)
 */
async function addNewRow(page) {
  const frames = page.frames();
  let workFrame = frames.find(
    (f) =>
      f.name().includes("framesetWork") || f.name().includes("winNPA03020000"),
  );

  if (!workFrame) {
    for (const frame of frames) {
      try {
        if (await frame.$('xpath///div[contains(@id, "npia107p01")]')) {
          workFrame = frame;
          break;
        }
      } catch (e) {
        continue;
      }
    }
  }

  if (!workFrame)
    throw new Error("❌ [행 추가] 메인 작업 프레임을 찾을 수 없습니다.");

  const addBtnSelector =
    'xpath///div[contains(@id, "btn_addRow")]//div[text()="입력"]';
  try {
    await workFrame.waitForSelector(addBtnSelector, { timeout: 5000 });
    const addBtn = await workFrame.$(addBtnSelector);
    if (addBtn) {
      await smartClick(page, workFrame, addBtn);
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (btnErr) {
    console.error("❌ [입력] 버튼을 찾을 수 없습니다.");
  }
}

/**
 * [저장 및 통보] 버튼 클릭
 */
async function clickSaveAndNotify(page) {
  const saveBtnSelector =
    'xpath///div[contains(@id, "btn_save")]//div[text()="저장 및 통보"]';
  const frames = page.frames();
  let targetFrame = null;
  let saveBtn = null;

  for (const frame of frames) {
    saveBtn = await frame.$(saveBtnSelector);
    if (saveBtn) {
      targetFrame = frame;
      break;
    }
  }

  if (!saveBtn) {
    throw new Error("❌ 저장 버튼(btn_save)을 찾지 못했습니다.");
  }

  await smartClick(page, targetFrame, saveBtn);
}

/**
 * 방향키(위/아래) 및 엔터(기본값 Y)를 지원하는 커스텀 CLI 선택 함수
 * - 엔터 입력 시 항상 Y가 기본 선택됨
 */
/**
 * 방향키(위/아래) 및 엔터(기본값 Y)를 지원하는 커스텀 CLI 선택 함수
 * - 엔터 입력 시 항상 Y가 기본 선택됨
 * - 반복 호출 시 stdin 스트림 상태 꼬임 방지 처리 완료
 */
function askConfirmInteractive(promptText) {
  return new Promise((resolve) => {
    let selectedIndex = 0; // 항상 0(Y)으로 초기화
    const options = ["Y (예)", "N (아니오)"];

    const render = () => {
      process.stdout.write(`\r\x1b[K👉 ${promptText} [Y/n]\n`);
      options.forEach((opt, idx) => {
        const cursor = idx === selectedIndex ? "❯ " : "  ";
        const highlight =
          idx === selectedIndex ? `\x1b[36m\x1b[1m${opt}\x1b[0m` : opt;
        process.stdout.write(`\r\x1b[K${cursor}${highlight}\n`);
      });
    };

    // keypress 이벤트 방출 설정 및 입력 스트림 활성화
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume(); // 필수: 스트림 흐름 재개

    render();

    const onKeyPress = (str, key) => {
      if (!key) return;

      if (key.name === "up" || key.name === "w") {
        selectedIndex = 0; // Y (기본값)
        process.stdout.write("\x1b[3A");
        render();
      } else if (key.name === "down" || key.name === "s") {
        selectedIndex = 1; // N
        process.stdout.write("\x1b[3A");
        render();
      } else if (key.name === "return" || key.name === "enter") {
        // 엔터 클릭 시 현재 selectedIndex (기본 0: Y)로 확정
        cleanup();
        console.log("");
        resolve(selectedIndex === 0);
      } else if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit();
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeyPress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause(); // 핵심: 스트림을 일시 정지하여 다음 호출 시 깨끗한 상태 유지
    };

    process.stdin.on("keypress", onKeyPress);
  });
}

/**
 * CSV 파서 (원본 라인 정보 유지)
 */
function parseCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV 파일을 찾을 수 없습니다: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().replace(/^"|"$/g, ""));

  const rows = lines.slice(1).map((line, index) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row = { _originalIndex: index };
    headers.forEach((h, i) => {
      row[h] = values[i] || "";
    });
    return row;
  });

  return { headers, rows };
}

/**
 * CSV 데이터를 [수급자 + 시작시간 + 종료시간] 단위로 그룹핑
 */
function groupCSVData(rows) {
  const groups = [];
  const map = new Map();

  for (const row of rows) {
    const subject = row["Subject"] || row["이름"] || row["수급자"] || "";
    const startDate = row["Start Date"] || row["시작일"] || "";
    const startTime = row["Start Time"] || row["시작시간"] || "";
    const endTime = row["End Time"] || row["종료시간"] || "";

    if (!subject || !startDate || !startTime) continue;

    const dayMatch = startDate.match(/\d{2}$/);
    const day = dayMatch ? parseInt(dayMatch[0], 10) : null;
    if (day === null) continue;

    const groupKey = `${subject}_${startTime}_${endTime}`;

    if (!map.has(groupKey)) {
      const groupObj = {
        subject,
        startTime,
        endTime,
        days: [],
        rowIndices: [],
      };
      map.set(groupKey, groupObj);
      groups.push(groupObj);
    }

    const currentGroup = map.get(groupKey);
    if (!currentGroup.days.includes(day)) {
      currentGroup.days.push(day);
    }
    currentGroup.rowIndices.push(row._originalIndex);
  }

  groups.forEach((g) => g.days.sort((a, b) => a - b));

  return groups;
}

/**
 * 결과를 CSV 파일로 저장
 */
function saveResultCSV(outputPath, headers, rows, resultsMap) {
  const outputHeaders = [...headers];
  if (!outputHeaders.includes("Result")) outputHeaders.push("Result");
  if (!outputHeaders.includes("Message")) outputHeaders.push("Message");

  const lines = [outputHeaders.map((h) => `"${h}"`).join(",")];

  rows.forEach((row, idx) => {
    const res = resultsMap.get(idx) || { result: "SKIPPED", message: "미처리" };
    const rowData = {
      ...row,
      Result: res.result,
      Message: res.message,
    };

    const line = outputHeaders
      .map((h) => `"${(rowData[h] || "").toString().replace(/"/g, '""')}"`)
      .join(",");
    lines.push(line);
  });

  fs.writeFileSync(outputPath, lines.join("\n"), "utf-8");
}

/**
 * (수동) 급여계약 모듈 메인 실행 함수
 */
async function runManualContractEdit(page) {
  const csvPath = path.join(
    process.cwd(),
    "data",
    "Google_Calendar_Export.csv",
  );
  const resultCsvPath = path.join(
    process.cwd(),
    "data",
    "google_calendar_export_result.csv",
  );

  let headers = [];
  let rows = [];
  let groups = [];
  const resultsMap = new Map();

  try {
    const parsed = parseCSV(csvPath);
    headers = parsed.headers;
    rows = parsed.rows;
    groups = groupCSVData(rows);
  } catch (err) {
    console.error(`❌ CSV 파일 로드 실패: ${err.message}`);
    return;
  }

  if (groups.length === 0) {
    console.log("⚠️ 처리할 CSV 그룹 데이터가 없습니다.");
    return;
  }

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const daysStr = g.days
      .map((d) => `${String(d).padStart(2, "0")}일`)
      .join(", ");

    const timeLabel = `${g.startTime}~${g.endTime}`;

    console.log(`\n👤 수급자: ${g.subject}`);
    console.log(`⏰ 시  간: ${g.startTime} ~ ${g.endTime}`);
    console.log(`📅 날  짜: [${daysStr}]`);

    // 1. 입력 진행 여부 확인 (엔터 입력 시 기본값 Y)
    const confirmInput = await askConfirmInteractive(
      `[${g.subject} | ${g.startTime} | ${daysStr}] 항목을 화면에 입력하시겠습니까?`,
    );

    if (!confirmInput) {
      g.rowIndices.forEach((idx) => {
        resultsMap.set(idx, { result: "SKIPPED", message: "사용자 건너뜀" });
      });
      continue;
    }

    let isSuccess = false;
    let resultMessage = "";

    try {
      await addNewRow(page);
      await selectMultiplePersons(page);
      await inputServiceTime(page, {
        startTime: g.startTime,
        endTime: g.endTime,
      });
      await selectComboItem(page);
      await finalizeInput(page);
      await selectServiceDays(page, timeLabel, g.days);
      await clickSaveAndNotify(page);

      // 2. 저장 결과 수동 확인 (엔터 입력 시 기본값 Y)
      const confirmSuccess = await askConfirmInteractive(
        `해당 데이터(${g.subject} | ${timeLabel})가 성공적으로 저장되었습니까?`,
      );

      if (confirmSuccess) {
        isSuccess = true;
        resultMessage = "성공적으로 입력 완료";
      } else {
        isSuccess = false;
        resultMessage = "사용자가 실패로 입력함";
      }
    } catch (err) {
      console.error(`❌ [오류 발생] ${err.message}`);
      isSuccess = false;
      resultMessage = err.message;
    }

    // 시간대 그룹에 해당하는 모든 원본 행에 결과 기록
    g.rowIndices.forEach((idx) => {
      resultsMap.set(idx, {
        result: isSuccess ? "SUCCESS" : "FAILED",
        message: resultMessage,
      });
    });

    // 매 작업 완료 시마다 CSV 결과 갱신 저장
    saveResultCSV(resultCsvPath, headers, rows, resultsMap);
  }

  console.log("\n🏁 모든 수동 급여계약 등록 작업이 종료되었습니다.");
}

module.exports = { runManualContractEdit };
