/**
 * ==============================================================================
 * Google Apps Script - 장기요양기관 케어포 연동 및 서류 관리 자동화
 * 명세서 수정 버전: 2026-08-17
 * ==============================================================================
 */

// ==============================================================================
// 전역 상수 및 색상 정의 (Strict Color Rules)
// ==============================================================================
const COLOR_POSITIVE = "#d9ead3"; // 긍정 (수급중, 정상 작성, 연동 성공 등)
const COLOR_NEGATIVE = "#f4ccd0"; // 부정 (계약해지, 불명, 미작성, 오류, 갱신필요 등)
const COLOR_NEUTRAL = "#cccccc"; // 중립 (보류, 헤더, 작성 의무기간 외 미작성 등)
const COLOR_WHITE = "#ffffff";
const COLOR_TITLE = "#34495e";

const SHEET_NAME_CAREFOR = "케어포연동";
const SHEET_NAME_LOG = "Log";
const PROP_KEY_RUNNING = "CAREFOR_PIPELINE_RUNNING";

// ==============================================================================
// 메인 컨트롤러 및 온에디트 트리거
// ==============================================================================

/**
 * C1 셀 변경 감지 및 자동 실행 트리거 (onEdit)
 */
function onEdit(e) {
  if (!e) return;
  const range = e.range;
  const sheet = range.getSheet();

  if (
    sheet.getIndex() === 1 &&
    range.getA1Notation() === "C1" &&
    e.value === "업데이트"
  ) {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(PROP_KEY_RUNNING) === "true") {
      return;
    }

    try {
      props.setProperty(PROP_KEY_RUNNING, "true");
      runCareforPipeline(e.source, sheet);
    } finally {
      props.setProperty(PROP_KEY_RUNNING, "false");
    }
  }
}

/**
 * 수동 실행용 및 온에디트 연계 메인 함수
 */
function runCareforPipeline(ss, currentActiveSheet) {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    "케어포 연동 진행",
    "하단의 케어포연동 시트와 구글드라이브(표준약관, 급여제공계획서, 급여제공 결과평가)가 모두 최신이어야 합니다. 진행하시겠습니까?",
    ui.ButtonSet.YES_NO,
  );

  const targetSs = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheets = targetSs.getSheets();
  const prevSheet = sheets.length > 0 ? sheets[0] : null;

  if (response !== ui.Button.YES) {
    if (currentActiveSheet) {
      resetC1Dropdown(currentActiveSheet);
    }
    return;
  }

  const logs = [];
  const now = new Date();
  const nowStr = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss",
  );

  try {
    // --------------------------------------------------------------------------
    // Step 1: 유효성 검사 및 Log 시트 점검
    // --------------------------------------------------------------------------
    const prevC2Url = prevSheet
      ? (prevSheet.getRange("C2").getValue()?.toString().trim() ?? "")
      : "";
    const prevC3Url = prevSheet
      ? (prevSheet.getRange("C3").getValue()?.toString().trim() ?? "")
      : "";

    if (!prevC2Url) {
      addLog(
        logs,
        "-",
        2,
        "C2(전년도시트URL)",
        "URL 미입력",
        "전년도 시트 URL이 입력되지 않았습니다.",
      );
    }
    if (!prevC3Url) {
      addLog(
        logs,
        "-",
        3,
        "C3(드라이브URL)",
        "URL 미입력",
        "구글 드라이브 URL이 입력되지 않았습니다.",
      );
    }

    let logSheet = targetSs.getSheetByName(SHEET_NAME_LOG);
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

    // --------------------------------------------------------------------------
    // Step 2: 드라이브 전체 파일 구조 메모리 캐싱
    // --------------------------------------------------------------------------
    const driveFileMap = new Map();
    if (prevC3Url) {
      try {
        const folderId = extractDriveIdFromUrl(prevC3Url);
        if (folderId) {
          const rootFolder = DriveApp.getFolderById(folderId);
          cacheDriveFilesRecursive(rootFolder, driveFileMap);
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

    // --------------------------------------------------------------------------
    // Step 3: 케어포연동 시트 데이터 및 직전/전년도 시트 캐싱
    // --------------------------------------------------------------------------
    const careforSheet = targetSs.getSheetByName(SHEET_NAME_CAREFOR);
    const careforData = careforSheet
      ? careforSheet.getDataRange().getValues()
      : [];

    const prevSheetMap = cacheSheetMetadata(prevSheet);

    let prevYearSheetMap = new Map();
    if (prevC2Url) {
      try {
        const prevYearSs = SpreadsheetApp.openByUrl(prevC2Url);
        const prevYearSheet = prevYearSs.getSheets()[0];
        prevYearSheetMap = cacheSheetMetadata(prevYearSheet);
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

    // --------------------------------------------------------------------------
    // Step 4: 수급자별 데이터 연산
    // --------------------------------------------------------------------------
    const careforRows = careforData.slice(10); // 11행부터 시작
    const processedRows = [];

    careforRows.forEach((row, idx) => {
      const rawNo = row[0];
      if (!rawNo || isNaN(parseInt(rawNo, 10))) {
        return;
      }

      const rowIndex = 11 + idx;
      const rawStatus = row[1]?.toString().trim() ?? "";
      const rawName = row[2]?.toString().trim() ?? "";

      const name = rawName
        .replace(/\(.*?\)/g, "")
        .replace(/[\r\n]+/g, "")
        .replace(/\s+/g, "")
        .trim();

      if (!name) {
        addLog(
          logs,
          "미상",
          rowIndex,
          "수급자명",
          "필수 데이터 누락",
          "수급자명이 결손되어 해당 행을 스킵합니다.",
        );
        return;
      }

      let statusText = "불명";
      let statusColor = COLOR_NEGATIVE;
      if (rawStatus.includes("수급중")) {
        statusText = "수급중";
        statusColor = COLOR_POSITIVE;
      } else if (rawStatus.includes("계약해지")) {
        statusText = "계약해지";
        statusColor = COLOR_NEGATIVE;
      } else if (rawStatus.includes("보류")) {
        statusText = "보류";
        statusColor = COLOR_NEUTRAL;
      }

      const prevRecipientData = prevSheetMap.get(name);
      const prevYearRecipientData = prevYearSheetMap.get(name);

      const recipientResult = {
        no: rawNo,
        status: { text: statusText, color: statusColor },
        name: name,
        contractDate: { text: "", link: "", color: COLOR_WHITE },
        planEndDate: { text: "", color: COLOR_WHITE },
        fallUpper: { text: "", color: COLOR_WHITE },
        bedsoresUpper: { text: "", color: COLOR_WHITE },
        cognitionUpper: { text: "", color: COLOR_WHITE },
        fallLower: { text: "", color: COLOR_WHITE },
        bedsoresLower: { text: "", color: COLOR_WHITE },
        cognitionLower: { text: "", color: COLOR_WHITE },
        desireEval: { text: "", color: COLOR_WHITE },
        planWriteDate: { text: "", link: "", color: COLOR_WHITE },
        planType: { text: "", color: COLOR_WHITE },
        resultEvalDate: { text: "", link: "", color: COLOR_WHITE },
        planStartDate: { text: "", color: COLOR_WHITE },
        planEndDateRef: { text: "", color: COLOR_WHITE },
        contractStartDate: { text: "", note: "", link: "", color: COLOR_WHITE },
        contractEndDate: { text: "", note: "", link: "", color: COLOR_WHITE },
        remark: { text: "", note: "", color: COLOR_WHITE },
      };

      try {
        // 4-1. 급여제공계획 적용기간 시작/종료
        const rawRowStr = row.join(" ");
        const dateRangeMatch = rawRowStr.match(
          /(\d{2}\.\d{2}\.\d{2})\s*~\s*(\d{2}\.\d{2}\.\d{2})/,
        );

        if (dateRangeMatch) {
          recipientResult.planStartDate = {
            text: formatYYMMDD(dateRangeMatch[1]),
            color: COLOR_POSITIVE,
          };
          recipientResult.planEndDateRef = {
            text: formatYYMMDD(dateRangeMatch[2]),
            color: COLOR_POSITIVE,
          };
        } else if (prevYearRecipientData?.planStartDate?.text) {
          recipientResult.planStartDate = prevYearRecipientData.planStartDate;
          recipientResult.planEndDateRef = prevYearRecipientData.planEndDateRef;
        } else if (prevRecipientData?.planStartDate?.text) {
          recipientResult.planStartDate = prevRecipientData.planStartDate;
          recipientResult.planEndDateRef = prevRecipientData.planEndDateRef;
        } else {
          recipientResult.planStartDate = {
            text: "오류",
            color: COLOR_NEGATIVE,
          };
          recipientResult.planEndDateRef = {
            text: "오류",
            color: COLOR_NEGATIVE,
          };
          addLog(
            logs,
            name,
            rowIndex,
            "급여제공계획 적용기간",
            "필수 데이터 누락",
            "적용기간 시작/종료일을 찾을 수 없습니다.",
          );
        }

        // 4-2. 급여제공계획서 종료일자
        if (prevRecipientData?.planEndDate?.text) {
          recipientResult.planEndDate = prevRecipientData.planEndDate;
        } else if (prevYearRecipientData?.planEndDateRef?.text) {
          recipientResult.planEndDate = prevYearRecipientData.planEndDateRef;
        } else if (
          recipientResult.planEndDateRef.text &&
          recipientResult.planEndDateRef.text !== "오류"
        ) {
          recipientResult.planEndDate = recipientResult.planEndDateRef;
        } else {
          recipientResult.planEndDate = {
            text: "알 수 없음\n(직접입력필요)",
            color: COLOR_NEGATIVE,
          };
        }

        const planEndDateStr = recipientResult.planEndDate.text;
        const isDueMonth = isCurrentInOneMonthBefore(planEndDateStr);

        // 4-3. 표준약관 작성일자
        const prevYearContractEnd =
          prevYearRecipientData?.contractEndDate?.text ?? "";
        const currentYearStr = now.getFullYear().toString();

        if (
          prevYearContractEnd &&
          !prevYearContractEnd.startsWith(currentYearStr)
        ) {
          recipientResult.contractDate = {
            text: "",
            color: COLOR_WHITE,
            link: "",
          };
        } else {
          if (isDueMonth || isCurrentAfterOneMonthBefore(planEndDateStr)) {
            const fileKey = `${name}_표준약관`;
            const driveFile =
              driveFileMap.get(fileKey) ||
              driveFileMap.get(`${name}_표준약관_급여계약기간갱신(인증서)`);

            if (driveFile && driveFile.fileDate.startsWith(currentYearStr)) {
              recipientResult.contractDate = {
                text: driveFile.fileDate,
                color: COLOR_POSITIVE,
                link: driveFile.fileUrl,
              };
            } else {
              recipientResult.contractDate = {
                text: "갱신필요",
                color: COLOR_NEGATIVE,
                link: "",
              };
              addLog(
                logs,
                name,
                rowIndex,
                "표준약관 작성일자",
                "미작성 및 갱신 필요 건",
                "올해 기준 표준약관 파일 날짜 불일치 또는 미작성",
              );
            }
          } else {
            recipientResult.contractDate = {
              text: "갱신필요",
              color: COLOR_NEGATIVE,
              link: "",
            };
          }
        }

        // 4-4. 기초평가 & 욕구사정
        const processEvalCell = (colIdx) => {
          const val = row[colIdx]?.toString().trim() ?? "";
          const parsedVal = parseDateString(val);
          if (parsedVal) {
            return { text: parsedVal, color: COLOR_POSITIVE };
          } else {
            if (val === "미작성" || !val) {
              return {
                text: "미작성",
                color: isDueMonth ? COLOR_NEGATIVE : COLOR_NEUTRAL,
              };
            }
            return {
              text: val,
              color: isDueMonth ? COLOR_NEGATIVE : COLOR_NEUTRAL,
            };
          }
        };

        recipientResult.fallUpper = processEvalCell(4);
        recipientResult.fallLower = processEvalCell(5);
        recipientResult.bedsoresUpper = processEvalCell(6);
        recipientResult.bedsoresLower = processEvalCell(7);
        recipientResult.cognitionUpper = processEvalCell(8);
        recipientResult.cognitionLower = processEvalCell(9);
        recipientResult.desireEval = processEvalCell(10);

        // 4-5. 급여제공계획서 작성일자 & 종류
        const rawPlanText = row[11]?.toString().trim() ?? "";
        const matchPublic = rawPlanText.match(
          /(\d{2,4}[.-]\d{1,2}[.-]\d{1,2})/,
        );

        if (rawPlanText.includes("미작성") || !rawPlanText) {
          recipientResult.planWriteDate = {
            text: "미작성",
            color: isDueMonth ? COLOR_NEGATIVE : COLOR_NEUTRAL,
            link: "",
          };
        } else if (rawPlanText.includes("계약해지")) {
          recipientResult.planWriteDate = {
            text: "계약해지",
            color: COLOR_NEUTRAL,
            link: "",
          };
        } else if (matchPublic) {
          const formattedDate = parseDateString(matchPublic[1]);
          const driveFile = driveFileMap.get(`${name}_급여제공계획서`);

          if (
            driveFile &&
            (driveFile.fileDate === formattedDate ||
              formattedDate.includes(driveFile.fileDate))
          ) {
            recipientResult.planWriteDate = {
              text: formattedDate,
              color: COLOR_POSITIVE,
              link: driveFile.fileUrl,
            };
          } else {
            recipientResult.planWriteDate = {
              text: `${formattedDate}\n(파일오류)`,
              color: COLOR_NEGATIVE,
              link: "",
            };
            addLog(
              logs,
              name,
              rowIndex,
              "급여제공계획서 작성일자",
              "파일 미매칭",
              "드라이브 파일 날짜 불일치",
            );
          }
        } else {
          recipientResult.planWriteDate = {
            text: rawPlanText,
            color: COLOR_POSITIVE,
            link: "",
          };
        }

        const planTypeStr = rawPlanText.includes("목욕")
          ? "방문목욕"
          : "방문요양";
        recipientResult.planType = {
          text: planTypeStr,
          color: recipientResult.planWriteDate.color,
        };

        // 4-6. 결과평가 작성일자
        if (!isDueMonth) {
          if (prevRecipientData?.resultEvalDate) {
            recipientResult.resultEvalDate = prevRecipientData.resultEvalDate;
          } else {
            recipientResult.resultEvalDate = {
              text: "",
              color: COLOR_WHITE,
              link: "",
            };
          }
        } else {
          const driveFile =
            driveFileMap.get(`${name}_급여제공결과평가`) ||
            driveFileMap.get(`${name}_급여제공결과평가(모니터링)`);
          if (driveFile && driveFile.fileDate.startsWith(currentYearStr)) {
            recipientResult.resultEvalDate = {
              text: driveFile.fileDate,
              color: COLOR_POSITIVE,
              link: driveFile.fileUrl,
            };
          } else {
            const prevText = prevRecipientData?.resultEvalDate?.text ?? "";
            recipientResult.resultEvalDate = {
              text: prevText ? `${prevText}\n(파일오류)` : "미작성",
              color: COLOR_NEGATIVE,
              link: "",
            };
            addLog(
              logs,
              name,
              rowIndex,
              "결과평가 작성일자",
              "미작성",
              "의무 기간 내 결과평가 파일 누락",
            );
          }
        }

        // 4-7. 계약기간 및 비고 이관
        if (prevRecipientData?.contractStartDate?.text) {
          recipientResult.contractStartDate =
            prevRecipientData.contractStartDate;
          recipientResult.contractEndDate = prevRecipientData.contractEndDate;
          recipientResult.remark = prevRecipientData.remark;
        } else {
          if (!recipientResult.contractDate.text) {
            recipientResult.contractStartDate =
              prevYearRecipientData?.contractStartDate ?? {
                text: "",
                color: COLOR_WHITE,
              };
            recipientResult.contractEndDate =
              prevYearRecipientData?.contractEndDate ?? {
                text: "",
                color: COLOR_WHITE,
              };
          } else {
            recipientResult.contractStartDate = {
              text: "알 수 없음\n(직접입력필요)",
              color: COLOR_NEGATIVE,
            };
            recipientResult.contractEndDate = {
              text: "알 수 없음\n(직접입력필요)",
              color: COLOR_NEGATIVE,
            };
          }
          recipientResult.remark = prevRecipientData?.remark ?? {
            text: "",
            color: COLOR_WHITE,
          };
        }
      } catch (rowErr) {
        addLog(
          logs,
          name,
          rowIndex,
          "행 전체 연산",
          "런타임 오류",
          rowErr.message,
        );
      }

      processedRows.push(recipientResult);
    });

    // --------------------------------------------------------------------------
    // Step 5: 새 시트 생성 및 데이터 작성
    // --------------------------------------------------------------------------
    const newSheetName = nowStr;
    const newSheet = targetSs.insertSheet(newSheetName, 0);

    setupHeaderAndControls(newSheet, prevC2Url, prevC3Url);

    if (processedRows.length > 0) {
      const rowCount = processedRows.length;
      const values = [];
      const backgrounds = [];
      const fontColors = [];
      const richTextValues = [];
      const notes = [];

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

      const dataRange = newSheet.getRange(6, 1, rowCount, 20);
      dataRange.setValues(values);
      dataRange.setBackgrounds(backgrounds);
      dataRange.setFontColors(fontColors);
      dataRange.setRichTextValues(richTextValues);
      dataRange.setNotes(notes);
    }

    if (prevSheet) {
      try {
        const condRules = prevSheet.getConditionalFormatRules();
        if (condRules && condRules.length > 0) {
          newSheet.setConditionalFormatRules(condRules);
        }
      } catch (e) {}
    }

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
    if (logSheet && logs.length > 0) {
      logSheet
        .getRange(logSheet.getLastRow() + 1, 1, logs.length, 6)
        .setValues(logs);
    }
    ui.alert(
      "오류 발생",
      "파이프라인 실행 중 오류가 발생했습니다. Log 시트를 확인해주세요.",
      ui.ButtonSet.OK,
    );
  }
}

// ==============================================================================
// 서브 헬퍼 함수 및 유틸리티
// ==============================================================================

function setupHeaderAndControls(sheet, c2Val, c3Val) {
  sheet.getRange("A1").setValue("케어포");
  sheet.getRange("B1").setValue("연동일시");
  sheet.getRange("C1").setValue("업데이트");

  // 수정된 드롭다운 유효성 검사 생성 방식
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["업데이트"], true)
    .build();
  sheet.getRange("C1").setDataValidation(rule).setValue("업데이트");

  sheet.getRange("A2").setValue("전년도");
  sheet.getRange("B2").setValue("시트");
  sheet.getRange("C2").setValue(c2Val);

  sheet.getRange("A3").setValue("수급자");
  sheet.getRange("B3").setValue("기본자료");
  sheet.getRange("C3").setValue(c3Val);

  sheet
    .getRange("A1:B3")
    .setBackground("#1155cc")
    .setFontColor(COLOR_WHITE)
    .setFontWeight("bold");
  sheet.getRange("A1:A3").setHorizontalAlignment("right");
  sheet.getRange("B1:B3").setHorizontalAlignment("left");

  const headers = [
    "No.",
    "현황",
    "수급자명",
    "표준약관\n작성일자",
    "급여제공계획서\n종료일자",
    "낙상위험도\n(상반기)",
    "욕창위험도\n(상반기)",
    "인지기능\n(상반기)",
    "낙상위험도\n(하반기)",
    "욕창위험도\n(하반기)",
    "인지기능\n(하반기)",
    "욕구사정",
    "급여제공계획서\n작성일자",
    "급여제공계획서\n종류",
    "결과평가\n작성일자",
    "급여제공계획\n적용기간(시작)",
    "급여제공계획\n적용기간(종료)",
    "급여계약기간(시작)",
    "급여계약기간(종료)",
    "비고",
  ];

  const headerRange = sheet.getRange(5, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange
    .setBackground(COLOR_TITLE)
    .setFontColor(COLOR_WHITE)
    .setFontWeight("bold");
  headerRange.setHorizontalAlignment("center").setVerticalAlignment("middle");

  sheet
    .getDataRange()
    .setFontSize(12)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setFrozenRows(5);
  sheet.setFrozenColumns(3);
}

function resetC1Dropdown(sheet) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["업데이트"], true)
    .build();
  sheet.getRange("C1").setDataValidation(rule).setValue("업데이트");
}

function addLog(logsArray, recipientName, rowNum, colName, issueType, detail) {
  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss",
  );
  logsArray.push([
    timestamp,
    recipientName,
    rowNum,
    colName,
    issueType,
    detail,
  ]);
}

function extractDriveIdFromUrl(url) {
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function cacheDriveFilesRecursive(folder, map) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    const dateMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);

    if (dateMatch) {
      const parentFolder = folder.getName().replace(/\s+/g, "").trim();
      const key = `${parentFolder}_${fileName.split("_")[1] || fileName}`;
      const fileDate = dateMatch[1];

      const existing = map.get(key);
      if (!existing || existing.fileDate < fileDate) {
        map.set(key, {
          fileName: fileName,
          fileUrl: file.getUrl(),
          fileDate: fileDate,
        });
      }
      map.set(fileName, {
        fileName: fileName,
        fileUrl: file.getUrl(),
        fileDate: fileDate,
      });
    }
  }

  const subFolders = folder.getFolders();
  while (subFolders.hasNext()) {
    cacheDriveFilesRecursive(subFolders.next(), map);
  }
}

function cacheSheetMetadata(sheet) {
  const map = new Map();
  if (!sheet) return map;

  const lastRow = sheet.getLastRow();
  if (lastRow < 6) return map;

  const range = sheet.getRange(6, 1, lastRow - 5, 20);
  const values = range.getValues();
  const backgrounds = range.getBackgrounds();
  const richTexts = range.getRichTextValues();
  const notes = range.getNotes();

  values.forEach((r, i) => {
    const name = r[2]
      ?.toString()
      .replace(/\(.*?\)/g, "")
      .replace(/[\r\n]+/g, "")
      .replace(/\s+/g, "")
      .trim();
    if (name) {
      map.set(name, {
        contractDate: {
          text: r[3],
          color: backgrounds[i][3],
          link: richTexts[i][3]?.getLinkUrl(),
        },
        planEndDate: { text: r[4], color: backgrounds[i][4] },
        resultEvalDate: {
          text: r[14],
          color: backgrounds[i][14],
          link: richTexts[i][14]?.getLinkUrl(),
        },
        planStartDate: { text: r[15], color: backgrounds[i][15] },
        planEndDateRef: { text: r[16], color: backgrounds[i][16] },
        contractStartDate: {
          text: r[17],
          color: backgrounds[i][17],
          note: notes[i][17],
          link: richTexts[i][17]?.getLinkUrl(),
        },
        contractEndDate: {
          text: r[18],
          color: backgrounds[i][18],
          note: notes[i][18],
          link: richTexts[i][18]?.getLinkUrl(),
        },
        remark: { text: r[19], color: backgrounds[i][19], note: notes[i][19] },
      });
    }
  });

  return map;
}

function buildRichText(text, linkUrl) {
  const builder = SpreadsheetApp.newRichTextValue().setText(text || "");
  if (linkUrl) builder.setLinkUrl(linkUrl);
  return builder.build();
}

function parseDateString(str) {
  if (!str) return null;
  const match = String(str).match(/(\d{2,4})[.-](\d{1,2})[.-](\d{1,2})/);
  if (match) {
    let year = match[1];
    if (year.length === 2) year = "20" + year;
    const month = match[2].padStart(2, "0");
    const day = match[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

function formatYYMMDD(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split(".");
  if (parts.length === 3) {
    const year = parts[0].length === 2 ? `20${parts[0]}` : parts[0];
    const month = parts[1].padStart(2, "0");
    const day = parts[2].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}

function isCurrentInOneMonthBefore(endDateStr) {
  if (!endDateStr) return false;
  // 문자열 강제 변환 및 안전 검사 추가
  const str = String(endDateStr);
  if (!str.match(/\d{4}-\d{2}-\d{2}/)) return false;
  try {
    const endParts = str.split("-");
    const endYear = parseInt(endParts[0], 10);
    const endMonth = parseInt(endParts[1], 10);

    let targetYear = endYear;
    let targetMonth = endMonth - 1;
    if (targetMonth === 0) {
      targetYear -= 1;
      targetMonth = 12;
    }

    const now = new Date();
    return (
      now.getFullYear() === targetYear && now.getMonth() + 1 === targetMonth
    );
  } catch (e) {
    return false;
  }
}

function isCurrentAfterOneMonthBefore(endDateStr) {
  if (!endDateStr) return false;
  const str = String(endDateStr);
  if (!str.match(/\d{4}-\d{2}-\d{2}/)) return false;
  try {
    const endParts = str.split("-");
    const endYear = parseInt(endParts[0], 10);
    const endMonth = parseInt(endParts[1], 10);

    let targetYear = endYear;
    let targetMonth = endMonth - 1;
    if (targetMonth === 0) {
      targetYear -= 1;
      targetMonth = 12;
    }

    const now = new Date();
    const nowDateVal = now.getFullYear() * 12 + (now.getMonth() + 1);
    const targetDateVal = targetYear * 12 + targetMonth;

    return nowDateVal > targetDateVal;
  } catch (e) {
    return false;
  }
}

function reorderAndCleanSheets(ss, currentSheetName) {
  const sheets = ss.getSheets();
  const currentSheet = ss.getSheetByName(currentSheetName);
  let careSync = ss.getSheetByName(SHEET_NAME_CAREFOR);
  let logSheet = ss.getSheetByName(SHEET_NAME_LOG);

  const prevSheetTarget = sheets.find(
    (s) =>
      s.getName() !== currentSheetName &&
      !s.getName().includes(SHEET_NAME_CAREFOR) &&
      !s.getName().includes(SHEET_NAME_LOG),
  );

  sheets.forEach((s) => {
    let name = s.getName();
    if (name.includes("(직전시트)")) {
      const cleanName = name.replace("(직전시트)", "");
      try {
        s.setName(cleanName);
      } catch (e) {}
    }
  });

  if (prevSheetTarget) {
    try {
      const oldName = prevSheetTarget.getName().replace("(직전시트)", "");
      prevSheetTarget.setName(`(직전시트)${oldName}`);
    } catch (e) {}
  }

  if (currentSheet) {
    ss.setActiveSheet(currentSheet);
    ss.moveActiveSheet(1);
  }
  if (careSync) {
    ss.setActiveSheet(careSync);
    ss.moveActiveSheet(2);
  }
  if (prevSheetTarget) {
    ss.setActiveSheet(prevSheetTarget);
    ss.moveActiveSheet(3);
  }
  if (logSheet) {
    ss.setActiveSheet(logSheet);
    ss.moveActiveSheet(4);
  }

  const allSheetsAfter = ss.getSheets();
  const pastSheets = allSheetsAfter.filter((s) => {
    const name = s.getName();
    return (
      name !== currentSheetName &&
      name !== SHEET_NAME_CAREFOR &&
      name !== SHEET_NAME_LOG &&
      !name.includes("(직전시트)")
    );
  });

  pastSheets.sort((a, b) => b.getName().localeCompare(a.getName()));

  if (pastSheets.length > 2) {
    pastSheets.slice(2).forEach((s) => {
      try {
        ss.deleteSheet(s);
      } catch (e) {}
    });
  }
}
