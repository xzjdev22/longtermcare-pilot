/**
 * [utils/csvHandler.js] 구글 캘린더 CSV 파싱 및 결과 로깅 모듈
 */
const fs = require("fs");
const path = require("path");

function parseAndGroupCsv(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`❌ CSV 파일을 찾을 수 없습니다: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, "utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");

  if (lines.length <= 1) return [];

  // 원본 행 파싱
  const rows = lines.slice(1);
  const rawEvents = [];

  for (const row of rows) {
    const cols = row.split(",").map((c) => c.trim());
    if (cols.length < 5) continue;

    const [
      subject,
      startDate,
      startTime,
      endDate,
      endTime,
      isRecurring,
      description,
    ] = cols;
    if (!subject || !startDate || !startTime) continue;

    rawEvents.push({
      subject,
      startDate,
      startTime,
      endDate,
      endTime,
      isRecurring: isRecurring || "No",
      description: description || "",
    });
  }

  // 수급자별, 시간대별 그룹화
  const personMap = new Map();

  for (const event of rawEvents) {
    if (!personMap.has(event.subject)) {
      personMap.set(event.subject, new Map());
    }
    const timeSlotsMap = personMap.get(event.subject);
    const timeKey = `${event.startTime}~${event.endTime}`;

    if (!timeSlotsMap.has(timeKey)) {
      timeSlotsMap.set(timeKey, {
        startTime: event.startTime,
        endTime: event.endTime,
        dates: [],
        rawRows: [], // 로그 기록용 원본 참조
      });
    }

    const slot = timeSlotsMap.get(timeKey);
    slot.dates.push(event.startDate);
    slot.rawRows.push(event);
  }

  // 데이터 배열 변환
  const result = [];
  for (const [name, timeSlotsMap] of personMap.entries()) {
    result.push({
      name,
      timeSlots: Array.from(timeSlotsMap.values()),
    });
  }

  return result;
}

/**
 * 실행 결과를 CSV 파일로 저장
 */
function saveResultLog(outputFilePath, processedData) {
  const absolutePath = path.resolve(outputFilePath);
  const headers = [
    "Subject",
    "Start Date",
    "Start Time",
    "End Date",
    "End Time",
    "Is Recurring",
    "Description",
    "Result",
    "Message",
  ];
  const csvLines = [headers.join(",")];

  for (const person of processedData) {
    for (const slot of person.timeSlots) {
      const resultStatus = slot.result || "FAILED";
      const resultMsg = slot.message
        ? `"${slot.message.replace(/"/g, '""')}"`
        : "";

      for (const row of slot.rawRows) {
        const line = [
          row.subject,
          row.startDate,
          row.startTime,
          row.endDate,
          row.endTime,
          row.isRecurring,
          `"${row.description}"`,
          resultStatus,
          resultMsg,
        ].join(",");
        csvLines.push(line);
      }
    }
  }

  fs.writeFileSync(absolutePath, csvLines.join("\n"), "utf-8");
  console.log(`📄 [Log] 결과 리포트 저장 완료: ${absolutePath}`);
}

module.exports = { parseAndGroupCsv, saveResultLog };
