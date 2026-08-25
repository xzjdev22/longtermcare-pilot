function handleEdit(
  e, // 편집 이벤트 객체
) {
  // 이벤트 객체가 존재하지 않는 경우 즉시 반환하는 분기
  if (!e) return;

  const range = e.range;
  const sheet = range.getSheet();

  // 첫 번째 시트의 C1 셀 값이 "업데이트"로 변경된 경우 파이프라인을 실행하는 분기
  if (
    sheet.getIndex() === 1 &&
    range.getA1Notation() === "C1" &&
    e.value === "업데이트"
  ) {
    const props = PropertiesService.getScriptProperties();

    // 이미 실행 중인 상태인 경우 중복 실행 방지를 위해 반환하는 분기
    if (props.getProperty(PROP_KEY_RUNNING) === "true") return;

    try {
      props.setProperty(PROP_KEY_RUNNING, "true");
      runCareforPipeline(e.source, sheet);
    } finally {
      props.setProperty(PROP_KEY_RUNNING, "false");
    }
  }
}

function runCareforPipeline(
  ss, // 대상 스프레드시트 객체
  currentActiveSheet, // 현재 활성화된 시트 객체
) {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    "케어포 연동 진행",
    "하단의 케어포연동 시트와 구글드라이브(표준약관, 급여제공계획서, 급여제공 결과평가)가 모두 최신이어야 합니다. 진행하시겠습니까?",
    ui.ButtonSet.YES_NO,
  );

  const targetSs = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheets = targetSs.getSheets();
  const prevSheet = sheets.length > 0 ? sheets[0] : null;

  // 사용자가 진행을 취소한 경우 드롭다운을 리셋하고 종료하는 분기
  if (response !== ui.Button.YES) {
    if (currentActiveSheet) resetC1Dropdown(currentActiveSheet);
    return;
  }

  const logs = [];
  const now = new Date();
  const nowStr = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss",
  );
  const currentYearStr = now.getFullYear().toString();

  try {
    const prevC2Url = prevSheet
      ? (prevSheet.getRange("C2").getValue()?.toString().trim() ?? "")
      : "";
    const prevC3Url = prevSheet
      ? (prevSheet.getRange("C3").getValue()?.toString().trim() ?? "")
      : "";

    // 전년도 시트 URL이 누락된 경우 로그에 기록하는 분기
    if (!prevC2Url)
      addLog(
        logs,
        "-",
        2,
        "C2(전년도시트URL)",
        "URL 미입력",
        "전년도 시트 URL이 입력되지 않았습니다.",
      );

    // 구글 드라이브 URL이 누락된 경우 로그에 기록하는 분기
    if (!prevC3Url)
      addLog(
        logs,
        "-",
        3,
        "C3(드라이브URL)",
        "URL 미입력",
        "구글 드라이브 URL이 입력되지 않았습니다.",
      );

    let logSheet = targetSs.getSheetByName(SHEET_NAME_LOG);

    // 로그 시트가 존재하지 않으면 새로 생성하고, 존재하면 내용을 초기화하는 분기
    if (!logSheet) {
      logSheet = targetSs.insertSheet(SHEET_NAME_LOG);
    } else {
      logSheet.clear();
    }

    logSheet.appendRow([
      "발생일시",
      "수급자명",
      "행 번호(Row)",
      "열/항목명(Column)",
      "오류/이슈 구분",
      "상세 내용 및 조치 필요사항",
    ]);
    logSheet
      .getRange(1, 1, 1, 6)
      .setBackground(COLOR_TITLE)
      .setFontColor(COLOR_WHITE)
      .setFontWeight("bold");

    const driveFileMap = new Map();

    // 드라이브 URL이 존재하는 경우 재귀적으로 파일을 캐싱하는 분기
    if (prevC3Url) {
      try {
        const folderId = extractDriveIdFromUrl(prevC3Url);
        if (folderId) {
          cacheDriveFilesRecursive(
            DriveApp.getFolderById(folderId),
            driveFileMap,
          );
        } else {
          addLog(
            logs,
            "-",
            3,
            "C3(드라이브URL)",
            "URL 파싱 오류",
            "구글 드라이브 Folder ID를 추출할 수 없습니다.",
          );
        }
      } catch (err) {
        addLog(
          logs,
          "-",
          3,
          "C3(드라이브URL)",
          "드라이브 접근 오류",
          err.message,
        );
      }
    }

    const careforSheet = targetSs.getSheetByName(SHEET_NAME_CAREFOR);
    const careforData = careforSheet
      ? careforSheet.getDataRange().getValues()
      : [];
    const prevSheetMap = cacheSheetMetadata(prevSheet);

    let prevYearSheetMap = new Map();

    // 전년도 시트 URL이 존재하는 경우 해당 스프레드시트에 접근하여 메타데이터를 캐싱하는 분기
    if (prevC2Url) {
      try {
        const matchId = prevC2Url.match(/[-\w]{25,}/);
        if (!matchId)
          throw new Error("전년도 시트 URL에서 ID를 추출할 수 없습니다.");
        const prevYearSs = SpreadsheetApp.openById(matchId[0]);
        prevYearSheetMap = cacheSheetMetadata(prevYearSs.getSheets()[0]);
      } catch (err) {
        addLog(
          logs,
          "-",
          2,
          "C2(전년도시트URL)",
          "전년도 시트 접근 오류",
          err.message,
        );
      }
    }

    const careforRows = careforData.slice(10);
    const processedRows = [];

    // 케어포 원본 행들을 순회하며 수급자 데이터를 가공하는 반복문
    careforRows.forEach((row, idx) => {
      const result = processRecipientRow(
        row,
        idx,
        driveFileMap,
        prevSheetMap.get(nameFromRow(row)),
        prevYearSheetMap.get(nameFromRow(row)),
        currentYearStr,
        now,
      );

      // 데이터가 유효하지 않은 경우 에러 로그에 추가하고 건너뛰는 분기
      if (!result.isValid) {
        if (result.error) {
          addLog(
            logs,
            result.error.name,
            result.error.rowNum,
            result.error.colName,
            result.error.type,
            result.error.detail,
          );
        }
        return;
      }
      processedRows.push(result);
    });

    const newSheetName = nowStr;
    const newSheet = targetSs.insertSheet(newSheetName, 0);
    setupHeaderAndControls(newSheet, prevC2Url, prevC3Url);

    // 가공된 행 데이터가 존재하는 경우 시트에 일괄 반영하는 분기
    if (processedRows.length > 0) {
      const values = [];
      const backgrounds = [];
      const fontColors = [];
      const richTextValues = [];
      const notes = [];

      // 가공된 수급자 결과 객체들을 배열에 매핑하는 반복문
      processedRows.forEach((r) => {
        values.push([
          r.no,
          r.status.text,
          r.name,
          r.contractDate.text,
          r.planEndDate.text,
          r.fallUpper.text,
          r.bedsoresUpper.text,
          r.cognitionUpper.text,
          r.fallLower.text,
          r.bedsoresLower.text,
          r.cognitionLower.text,
          r.desireEval.text,
          r.planWriteDate.text,
          r.planType.text,
          r.resultEvalDate.text,
          r.planStartDate.text,
          r.planEndDateRef.text,
          r.contractStartDate.text,
          r.contractEndDate.text,
          r.remark.text,
        ]);
        backgrounds.push([
          COLOR_WHITE,
          r.status.color,
          COLOR_WHITE,
          r.contractDate.color,
          r.planEndDate.color,
          r.fallUpper.color,
          r.bedsoresUpper.color,
          r.cognitionUpper.color,
          r.fallLower.color,
          r.bedsoresLower.color,
          r.cognitionLower.color,
          r.desireEval.color,
          r.planWriteDate.color,
          r.planType.color,
          r.resultEvalDate.color,
          r.planStartDate.color,
          r.planEndDateRef.color,
          r.contractStartDate.color,
          r.contractEndDate.color,
          r.remark.color,
        ]);
        fontColors.push(Array(20).fill("#000000"));
        richTextValues.push([
          buildRichText(r.no),
          buildRichText(r.status.text),
          buildRichText(r.name),
          buildRichText(r.contractDate.text, r.contractDate.link),
          buildRichText(r.planEndDate.text),
          buildRichText(r.fallUpper.text),
          buildRichText(r.bedsoresUpper.text),
          buildRichText(r.cognitionUpper.text),
          buildRichText(r.fallLower.text),
          buildRichText(r.bedsoresLower.text),
          buildRichText(r.cognitionLower.text),
          buildRichText(r.desireEval.text),
          buildRichText(r.planWriteDate.text, r.planWriteDate.link),
          buildRichText(r.planType.text),
          buildRichText(r.resultEvalDate.text, r.resultEvalDate.link),
          buildRichText(r.planStartDate.text),
          buildRichText(r.planEndDateRef.text),
          buildRichText(r.contractStartDate.text, r.contractStartDate.link),
          buildRichText(r.contractEndDate.text, r.contractEndDate.link),
          buildRichText(r.remark.text),
        ]);
        notes.push([
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          r.contractStartDate.note || "",
          r.contractEndDate.note || "",
          r.remark.note || "",
        ]);
      });

      const dataRange = newSheet.getRange(6, 1, processedRows.length, 20);
      dataRange.setNumberFormat("@");
      dataRange.setValues(values);
      dataRange.setBackgrounds(backgrounds);
      dataRange.setFontColors(fontColors);
      dataRange.setRichTextValues(richTextValues);
      dataRange.setNotes(notes);

      newSheet
        .getDataRange()
        .setFontSize(12)
        .setHorizontalAlignment("center")
        .setVerticalAlignment("middle");

      const dValue = `${Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd")}\n${Utilities.formatDate(now, Session.getScriptTimeZone(), "HH:mm:ss")}`;
      const c1Rule = SpreadsheetApp.newDataValidation()
        .requireValueInList([dValue, "업데이트"], true)
        .build();
      newSheet
        .getRange("C1")
        .setDataValidation(c1Rule)
        .setValue(dValue)
        .setWrap(true)
        .setFontSize(10)
        .setHorizontalAlignment("center")
        .setVerticalAlignment("middle");
    }

    // 직전 시트가 존재하는 경우 조건부 서식 규칙을 복사하는 분기
    if (prevSheet) {
      try {
        const condRules = prevSheet.getConditionalFormatRules();
        if (condRules && condRules.length > 0)
          newSheet.setConditionalFormatRules(condRules);
      } catch (e) {}
    }

    // 누적된 로그가 존재하는 경우 로그 시트에 일괄 기록하는 분기
    if (logs.length > 0) {
      logSheet
        .getRange(logSheet.getLastRow() + 1, 1, logs.length, 6)
        .setValues(logs);
    }

    reorderAndCleanSheets(targetSs, newSheetName);
    ui.alert(
      "완료",
      "모든 데이터 연동 및 정리가 완료되었습니다.",
      ui.ButtonSet.OK,
    );
  } catch (globalErr) {
    addLog(
      logs,
      "GLOBAL",
      0,
      "파이프라인",
      "런타임 오류",
      globalErr.stack || globalErr.message,
    );
    const logSheet = targetSs.getSheetByName(SHEET_NAME_LOG);
    if (logSheet && logs.length > 0)
      logSheet
        .getRange(logSheet.getLastRow() + 1, 1, logs.length, 6)
        .setValues(logs);
    ui.alert(
      "오류 발생",
      "파이프라인 실행 중 오류가 발생했습니다. Log 시트를 확인해주세요.",
      ui.ButtonSet.OK,
    );
  }
}

function nameFromRow(
  row, // 수급자 원본 데이터 행 배열
) {
  const rawName = row[2]?.toString().trim() ?? ""; // Col C: 수급자명 원본 값
  return rawName
    .replace(/\(.*?\)/g, "")
    .replace(/[\r\n]+/g, "")
    .replace(/\s+/g, "")
    .trim();
}
