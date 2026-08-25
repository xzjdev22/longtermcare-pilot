/**
 * ==============================================================================
 * Google Apps Script - 장기요양기관 케어포 연동 및 서류 관리 자동화
 * ==============================================================================
 */

// ==============================================================================
// 전역 상수 및 색상 정의 (Strict Color Rules)
// ==============================================================================
const COLOR_POSITIVE = "#d9ead3"; // 긍정 (수급중, 정상 작성, 연동 성공 등)
const COLOR_NEGATIVE = "#f4ccd0"; // 부정 (계약해지, 불명, 미작성, 오류, 갱신필요 등)
const COLOR_NEUTRAL = "#cccccc"; // 중립 (보류, 헤더, 계약해지, 해당없음 등)
const COLOR_WHITE = "#ffffff";
const COLOR_TITLE = "#34495e";

const SHEET_NAME_CAREFOR = "케어포연동";
const SHEET_NAME_LOG = "Log";
const PROP_KEY_RUNNING = "CAREFOR_PIPELINE_RUNNING";

// ==============================================================================
// 메인 컨트롤러 및 온에디트 트리거
// ==============================================================================

/**
 * C1 셀 변경 감지 및 자동 실행 트리거 (handleEdit)
 */
function handleEdit(e) {
  if (!e) return;
  const range = e.range;
  const sheet = range.getSheet();
  if (
    sheet.getIndex() === 1 &&
    range.getA1Notation() === "C1" &&
    e.value === "업데이트"
  ) {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(PROP_KEY_RUNNING) === "true") return;
    try {
      props.setProperty(PROP_KEY_RUNNING, "true");
      runCareforPipeline(e.source, sheet);
    } finally {
      props.setProperty(PROP_KEY_RUNNING, "false");
    }
  }
}

/**
 * 수동 실행용 및 온에디트 연계 메인 함수 (Core Pipeline)
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
    // Step 2: 드라이브 전체 파일 구조 메모리 캐싱 (성능 최적화)
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
        const matchId = prevC2Url.match(/[-\w]{25,}/);
        if (!matchId)
          throw new Error("전년도 시트 URL에서 ID를 추출할 수 없습니다.");

        const prevYearSs = SpreadsheetApp.openById(matchId[0]);
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
    // Step 4: 수급자별 데이터 연산 및 비즈니스 로직 적용
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
        const rawRowStr = row.join(" ");
        const dateRangeMatch = rawRowStr.match(
          /(\d{2}\.\d{2}\.\d{2})\s*~\s*(\d{2}\.\d{2}\.\d{2})/,
        );

        if (dateRangeMatch) {
          recipientResult.planStartDate = {
            text: parseDateString(dateRangeMatch[1]) || dateRangeMatch[1],
            color: COLOR_POSITIVE,
          };
          recipientResult.planEndDateRef = {
            text: parseDateString(dateRangeMatch[2]) || dateRangeMatch[2],
            color: COLOR_POSITIVE,
          };
        } else if (prevYearRecipientData?.planStartDate?.text) {
          recipientResult.planStartDate = {
            text: prevYearRecipientData.planStartDate.text,
            color: COLOR_WHITE,
          };
          recipientResult.planEndDateRef = {
            text: prevYearRecipientData.planEndDateRef.text,
            color: COLOR_WHITE,
          };
        } else if (prevRecipientData?.planStartDate?.text) {
          recipientResult.planStartDate = {
            text: prevRecipientData.planStartDate.text,
            color: COLOR_WHITE,
          };
          recipientResult.planEndDateRef = {
            text: prevRecipientData.planEndDateRef.text,
            color: COLOR_WHITE,
          };
        } else {
          recipientResult.planStartDate = {
            text: "오류",
            color: COLOR_NEGATIVE,
          };
          recipientResult.planEndDateRef = {
            text: "오류",
            color: COLOR_NEGATIVE,
          };
        }

        if (prevRecipientData?.planEndDate?.text) {
          recipientResult.planEndDate = {
            text: prevRecipientData.planEndDate.text,
            color: COLOR_WHITE,
          };
        } else if (prevYearRecipientData?.planEndDateRef?.text) {
          recipientResult.planEndDate = {
            text: prevYearRecipientData.planEndDateRef.text,
            color: COLOR_WHITE,
          };
        } else if (
          recipientResult.planEndDateRef.text &&
          recipientResult.planEndDateRef.text !== "오류"
        ) {
          recipientResult.planEndDate = {
            text: recipientResult.planEndDateRef.text,
            color: COLOR_WHITE,
          };
        } else {
          recipientResult.planEndDate = {
            text: "알 수 없음",
            color: COLOR_NEGATIVE,
          };
        }

        const planEndDateStr = recipientResult.planEndDate.text;
        const isAfterPrevMonthFirstDay =
          hasPreviousMonthFirstDayPassed(planEndDateStr);

        let prevYearContractEnd =
          prevYearRecipientData?.contractEndDate?.text ?? "";

        if (prevYearContractEnd instanceof Date) {
          prevYearContractEnd = Utilities.formatDate(
            prevYearContractEnd,
            Session.getScriptTimeZone(),
            "yyyy-MM-dd",
          );
        } else {
          prevYearContractEnd =
            parseDateString(prevYearContractEnd) ||
            String(prevYearContractEnd).trim();
        }

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
          console.log(name, { isAfterPrevMonthFirstDay });
          if (isAfterPrevMonthFirstDay) {
            const fileKey = `${name}_표준약관`;
            const driveFile =
              driveFileMap.get(fileKey) ||
              driveFileMap.get(`${name}_표준약관_인정유효기간갱신`);

            if (driveFile && driveFile.fileDate.startsWith(currentYearStr)) {
              recipientResult.contractDate = {
                text: parseDateString(driveFile.fileDate) || driveFile.fileDate,
                color: COLOR_POSITIVE,
                link: driveFile.fileUrl,
              };
            } else {
              recipientResult.contractDate = {
                text: "갱신필요",
                color: COLOR_NEGATIVE,
                link: "",
              };
            }
          } else {
            recipientResult.contractDate = {
              text: "갱신필요",
              color: COLOR_WHITE,
              link: "",
            };
          }
        }

        const processEvalCell = (colIdx, isShortFormat = false, yearType) => {
          const val = row[colIdx];
          const parsedVal = parseDateString(val);
          let isDueMonth = false;
          switch (yearType) {
            case "YEAR":
              isDueMonth = isAfterPrevMonthFirstDay;
              break;

            case "UPPER":
              isDueMonth = hasDueMonthPassed(planEndDateStr, "UPPER");
              break;

            case "LOWER":
              isDueMonth = hasDueMonthPassed(planEndDateStr, "LOWER");
              break;

            default:
              break;
          }

          if (parsedVal) {
            const formatted = isShortFormat
              ? formatToMMdd(parsedVal)
              : parsedVal;
            return { text: formatted, color: COLOR_POSITIVE };
          } else {
            const strVal = val != null ? String(val).trim() : "";
            if (strVal === "미작성" || !strVal) {
              return {
                text: "미작성",
                color: isDueMonth ? COLOR_NEGATIVE : COLOR_WHITE,
              };
            }
            if (strVal.includes("계약해지") || strVal.includes("해당없음")) {
              return { text: strVal, color: COLOR_NEUTRAL };
            }
            return { text: strVal, color: COLOR_NEGATIVE };
          }
        };

        recipientResult.fallUpper = processEvalCell(4, true, "UPPER");
        recipientResult.bedsoresUpper = processEvalCell(6, true, "UPPER");
        recipientResult.cognitionUpper = processEvalCell(8, true, "UPPER");
        recipientResult.fallLower = processEvalCell(5, true, "LOWER");
        recipientResult.bedsoresLower = processEvalCell(7, true, "LOWER");
        recipientResult.cognitionLower = processEvalCell(9, true, "LOWER");
        ((recipientResult.desireEval = processEvalCell(10, true)), "YEAR");

        const rawPlanText = row[11]?.toString().trim() ?? "";
        const matchPublic = rawPlanText.match(
          /(\d{2,4}[.-]\d{1,2}[.-]\d{1,2})/,
        );

        if (
          rawPlanText.includes("미작성") ||
          !rawPlanText ||
          rawPlanText.includes("GMT")
        ) {
          recipientResult.planWriteDate = {
            text: "미작성",
            color: isAfterPrevMonthFirstDay ? COLOR_NEGATIVE : COLOR_WHITE,
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
            formattedDate &&
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
              text: `${formattedDate || rawPlanText}\n(파일오류)`,
              color: COLOR_NEGATIVE,
              link: "",
            };
          }
        } else {
          recipientResult.planWriteDate = {
            text: parseDateString(rawPlanText) || rawPlanText,
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

        if (!isAfterPrevMonthFirstDay) {
          if (prevRecipientData?.resultEvalDate) {
            const cleanResDate =
              parseDateString(prevRecipientData.resultEvalDate.text) ||
              prevRecipientData.resultEvalDate.text;
            recipientResult.resultEvalDate = {
              text: cleanResDate,
              color: COLOR_WHITE,
              link: prevRecipientData.resultEvalDate.link,
            };
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
            const cleanDriveDate =
              parseDateString(driveFile.fileDate) || driveFile.fileDate;
            recipientResult.resultEvalDate = {
              text: cleanDriveDate,
              color: COLOR_POSITIVE,
              link: driveFile.fileUrl,
            };
          } else {
            recipientResult.resultEvalDate = {
              text: "미작성",
              color: COLOR_NEGATIVE,
              link: "",
            };
          }
        }

        const cleanDateObj = (obj) => {
          if (!obj || !obj.text)
            return { text: "", color: COLOR_WHITE, link: "", note: "" };
          const parsed = parseDateString(obj.text);
          return {
            text: parsed || obj.text,
            color: COLOR_WHITE,
            link: obj.link || "",
            note: obj.note || "",
          };
        };

        if (prevRecipientData?.contractStartDate?.text) {
          recipientResult.contractStartDate = cleanDateObj(
            prevRecipientData.contractStartDate,
          );
          recipientResult.contractEndDate = cleanDateObj(
            prevRecipientData.contractEndDate,
          );
          recipientResult.remark = {
            text: prevRecipientData.remark?.text || "",
            color: COLOR_WHITE,
            note: prevRecipientData.remark?.note || "",
          };
        } else {
          //   console.log(name, { recipientResult }, { prevYearRecipientData });

          //   if (!recipientResult.contractDate.text) {
          //     recipientResult.contractStartDate = cleanDateObj(
          //       prevYearRecipientData?.contractStartDate,
          //     );
          //     recipientResult.contractEndDate = cleanDateObj(
          //       prevYearRecipientData?.contractEndDate,
          //     );
          //   } else {
          //     recipientResult.contractStartDate = {
          //       text: "알 수 없음",
          //       color: COLOR_NEGATIVE,
          //     };
          //     recipientResult.contractEndDate = {
          //       text: "알 수 없음",
          //       color: COLOR_NEGATIVE,
          //     };
          //   }

          recipientResult.contractStartDate =
            prevYearRecipientData?.contractStartDate
              ? cleanDateObj(prevYearRecipientData?.contractStartDate)
              : {
                  text: "알 수 없음",
                  color: COLOR_NEGATIVE,
                };
          recipientResult.contractEndDate =
            prevYearRecipientData?.contractEndDate
              ? cleanDateObj(prevYearRecipientData?.contractEndDate)
              : {
                  text: "알 수 없음",
                  color: COLOR_NEGATIVE,
                };

          recipientResult.remark = {
            text: prevRecipientData?.remark?.text || "",
            color: COLOR_WHITE,
            note: prevRecipientData?.remark?.note || "",
          };
        }

        if (recipientResult.planStartDate.text) {
          recipientResult.planStartDate.text =
            parseDateString(recipientResult.planStartDate.text) ||
            recipientResult.planStartDate.text;
        }
        if (recipientResult.planEndDateRef.text) {
          recipientResult.planEndDateRef.text =
            parseDateString(recipientResult.planEndDateRef.text) ||
            recipientResult.planEndDateRef.text;
        }
        if (recipientResult.planEndDate.text) {
          recipientResult.planEndDate.text =
            parseDateString(recipientResult.planEndDate.text) ||
            recipientResult.planEndDate.text;
        }
      } catch (rowErr) {
        addLog(
          logs,
          name,
          rowIndex,
          "행 전체 연산",
          "런타임 오류",
          rowErr.stack || rowErr.message,
        );
      }

      processedRows.push(recipientResult);
    });

    // --------------------------------------------------------------------------
    // Step 5: 새 시트 생성 및 데이터 기록
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

      const nowVal = new Date();
      const dStr = Utilities.formatDate(
        nowVal,
        Session.getScriptTimeZone(),
        "yyyy-MM-dd",
      );
      const tStr = Utilities.formatDate(
        nowVal,
        Session.getScriptTimeZone(),
        "HH:mm:ss",
      );
      const dValue = `${dStr}\n${tStr}`;
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

    // Step 6: 정확한 요구사항별 시트 순서 정렬 및 관리
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
  const sheetName = sheet.getName();

  const now = new Date();
  const dateStr = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd",
  );
  const timeStr = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "HH:mm:ss",
  );
  const displayValue = `${dateStr}\n${timeStr}`;

  sheet.getRange("A1").setValue("케어포");
  sheet.getRange("B1").setValue("연동일시");

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList([displayValue, "업데이트"], true)
    .build();

  sheet.getRange("C1").setDataValidation(rule).setValue(displayValue);
  sheet.getRange("C1").setWrap(true);

  sheet.getRange("A2").setValue("전년도");
  sheet.getRange("B2").setValue("시트");
  sheet.getRange("C2").setValue(c2Val);

  sheet.getRange("A3").setValue("수급자");
  sheet.getRange("B3").setValue("기본자료");
  sheet.getRange("C3").setValue(c3Val);

  sheet
    .getRange("A1:B1")
    .setBackground("#38761d")
    .setFontColor(COLOR_WHITE)
    .setFontWeight("bold");
  sheet
    .getRange("A2:B2")
    .setBackground(COLOR_WHITE)
    .setFontColor("#000000")
    .setFontWeight("bold");
  sheet
    .getRange("A3:B3")
    .setBackground("#e69138")
    .setFontColor(COLOR_WHITE)
    .setFontWeight("bold");

  sheet
    .getRange("C1:C3")
    .setBackground(COLOR_WHITE)
    .setFontColor("#000000")
    .setFontWeight("normal");

  sheet.getRange("C1").setFontSize(10);
  sheet.getRange("C2:C3").setFontSize(12);

  sheet.getRange("A1:A3").setHorizontalAlignment("right");
  sheet.getRange("B1:B3").setHorizontalAlignment("left");
  sheet.getRange("C1:C3").setHorizontalAlignment("center");
  sheet.getRange("C1").setVerticalAlignment("middle");

  sheet
    .getRange("A1:B3")
    .setBorder(
      true,
      true,
      true,
      true,
      false,
      false,
      "black",
      SpreadsheetApp.BorderStyle.SOLID,
    );
  sheet
    .getRange("C1:C3")
    .setBorder(
      true,
      true,
      true,
      true,
      false,
      false,
      "black",
      SpreadsheetApp.BorderStyle.SOLID,
    );

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
    "인정유효기간\n(시작)",
    "인정유효기간\n(종료)",
    "비고",
  ];

  const headerRange = sheet.getRange(5, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange
    .setBackground(COLOR_TITLE)
    .setFontColor(COLOR_WHITE)
    .setFontWeight("bold")
    .setFontSize(10);
  headerRange.setHorizontalAlignment("center").setVerticalAlignment("middle");

  sheet
    .getDataRange()
    .setFontSize(12)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  headerRange.setFontSize(10);

  sheet.getRange("C1").setFontSize(10).setWrap(true);

  sheet.setFrozenRows(5);
  sheet.setFrozenColumns(3);

  const maxCols = sheet.getMaxColumns();
  if (maxCols > headers.length) {
    sheet.deleteColumns(headers.length + 1, maxCols - headers.length);
  }

  sheet.setColumnWidth(1, 48);
  sheet.setColumnWidth(2, 64);
  sheet.setColumnWidth(3, 96);
  sheet.setColumnWidth(4, 104);
  sheet.setColumnWidth(5, 104);
  for (let col = 6; col <= 11; col++) {
    sheet.setColumnWidth(col, 88);
  }
  for (let col = 12; col <= 19; col++) {
    sheet.setColumnWidth(col, 104);
  }
  sheet.setColumnWidth(20, 320);
}

function resetC1Dropdown(sheet) {
  const sheetName = sheet.getName();
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList([sheetName, "업데이트"], true)
    .build();
  sheet.getRange("C1").setDataValidation(rule).setValue(sheetName);
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
  if (!url) return null;
  const str = String(url).trim();
  const match = str.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return match[1];
  }
  if (str.length >= 25 && /^[a-zA-Z0-9_-]+$/.test(str)) {
    return str;
  }
  const generalMatch = str.match(/([a-zA-Z0-9_-]{25,})/);
  return generalMatch ? generalMatch[1] : str;
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

function parseDateString(val) {
  if (!val) return null;
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  const str = String(val).trim();
  const parsedDate = new Date(str);
  if (!isNaN(parsedDate.getTime()) && str.includes("GMT")) {
    return Utilities.formatDate(
      parsedDate,
      Session.getScriptTimeZone(),
      "yyyy-MM-dd",
    );
  }
  const match = str.match(/(\d{2,4})[.-](\d{1,2})[.-](\d{1,2})/);
  if (match) {
    let year = match[1];
    if (year.length === 2) year = "20" + year;
    const month = match[2].padStart(2, "0");
    const day = match[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

/**
 * 날짜 형식을 MM/dd로 변환하는 함수 (기존 '/' 형식으로 복구)
 */
function formatToMMdd(dateStr) {
  const parsed = parseDateString(dateStr);
  if (!parsed) return dateStr;
  const parts = parsed.split("-");
  if (parts.length === 3) {
    return `${parts[1]}/${parts[2]}`;
  }
  return dateStr;
}

// function isCurrentInOneMonthBefore(dateStr) {
//   const parsed = parseDateString(dateStr);
//   if (!parsed) return false;
//   const target = new Date(parsed);
//   const now = new Date();
//   const diffTime = target - now;
//   const diffDays = diffTime / (1000 * 60 * 60 * 24);
//   return diffDays >= 0 && diffDays <= 30;
// }

// function isCurrentAfterOneMonthBefore(dateStr) {
//   const parsed = parseDateString(dateStr);
//   if (!parsed) return false;
//   const target = new Date(parsed);
//   const now = new Date();
//   return now > target;
// }

function hasPreviousMonthFirstDayPassed(dateStr) {
  const parsed = parseDateString(dateStr);
  if (!parsed) return false;

  const target = new Date(parsed);

  // 1. dateStr이 속한 월의 '전월 1일' 구하기
  const prevMonthFirstDay = new Date(
    target.getFullYear(),
    target.getMonth() - 1,
    1,
  );

  // 2. 오늘 날짜 구하기 (시간 정보 제거)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 3. 시간 비교를 위해 전월 1일도 시간 정보 초기화
  prevMonthFirstDay.setHours(0, 0, 0, 0);

  // 4. 오늘이 전월 1일과 같거나 그 이후라면(즉, 전월 1일이 지났으면) true 반환
  return today >= prevMonthFirstDay;
}

function hasDueMonthPassed(dateStr, halfYearType) {
  const parsed = parseDateString(dateStr);
  if (!parsed) return false;

  const target = new Date(parsed);

  // 오늘 날짜 (시간 정보 제거)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. 기준일 한 달 전이 상반기인지 하반기인지 판단하기 위해 한 달 전 월 구하기
  const prevMonthDate = new Date(
    target.getFullYear(),
    target.getMonth() - 1,
    1,
  );
  const prevMonth = prevMonthDate.getMonth(); // 0(1월) ~ 11(12월)

  // 한 달 전이 상반기(1월~6월: 0~5)인지 하반기(7월~12월: 6~11)인지 판단
  const isPrevMonthUpper = prevMonth >= 0 && prevMonth <= 5;

  // 날짜 범위(1일부터 말일)를 체크하는 헬퍼 함수
  const isWithinMonth = (year, monthIndex) => {
    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 0); // 다음 달의 0일 = 이번 달의 말일
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return today >= start && today <= end;
  };

  // 2. 상반기일 때
  if (isPrevMonthUpper) {
    if (halfYearType === "UPPER") {
      // 지금이 기준일 한 달 전의 1일부터 말일 이내인지
      return isWithinMonth(
        prevMonthDate.getFullYear(),
        prevMonthDate.getMonth(),
      );
    } else if (halfYearType === "LOWER") {
      // 지금이 기준일 5달 후의 1일부터 말일 이내인지
      const target5Month = new Date(
        target.getFullYear(),
        target.getMonth() + 5,
        1,
      );
      return isWithinMonth(target5Month.getFullYear(), target5Month.getMonth());
    }
  }
  // 3. 하반기일 때
  else {
    if (halfYearType === "UPPER") {
      // 지금이 기준일 7달 전의 1일부터 말일 이내인지
      const target7Month = new Date(
        target.getFullYear(),
        target.getMonth() - 7,
        1,
      );
      return isWithinMonth(target7Month.getFullYear(), target7Month.getMonth());
    } else if (halfYearType === "LOWER") {
      // 지금이 기준일 한 달 전의 1일부터 말일 이내인지
      return isWithinMonth(
        prevMonthDate.getFullYear(),
        prevMonthDate.getMonth(),
      );
    }
  }

  return false;
}

/**
 * Step 6: 정확한 요구사항별 시트 순서 정렬 및 관리 함수
 */
function reorderAndCleanSheets(targetSs, currentSheetName) {
  const currentSheet = targetSs.getSheetByName(currentSheetName);
  const careforSheet = targetSs.getSheetByName(SHEET_NAME_CAREFOR);
  const logSheet = targetSs.getSheetByName(SHEET_NAME_LOG);

  const sheets = targetSs.getSheets();
  let oldPrevSheet = null;

  sheets.forEach((s) => {
    const name = s.getName();
    if (name.startsWith("(직전시트)")) {
      s.setName(name.replace("(직전시트)", "").trim());
    }
  });

  let prevTargetSheet = targetSs
    .getSheets()
    .find(
      (s) =>
        s.getName() !== currentSheetName &&
        s.getName() !== SHEET_NAME_CAREFOR &&
        s.getName() !== SHEET_NAME_LOG,
    );

  if (prevTargetSheet) {
    prevTargetSheet.setName("(직전시트) " + prevTargetSheet.getName());
  }

  if (currentSheet) {
    targetSs.setActiveSheet(currentSheet);
    targetSs.moveActiveSheet(1);
  }
  if (careforSheet) {
    targetSs.setActiveSheet(careforSheet);
    targetSs.moveActiveSheet(2);
  }
  if (prevTargetSheet) {
    targetSs.setActiveSheet(prevTargetSheet);
    targetSs.moveActiveSheet(3);
  }
  if (logSheet) {
    targetSs.setActiveSheet(logSheet);
    targetSs.moveActiveSheet(4);
  }

  const now = new Date();
  const dateStr = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd",
  );
  const timeStr = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "HH:mm:ss",
  );
  const displayValue = `${dateStr}\n${timeStr}`;

  if (currentSheet) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList([displayValue, "업데이트"], true)
      .build();
    currentSheet
      .getRange("C1")
      .setDataValidation(rule)
      .setValue(displayValue)
      .setWrap(true)
      .setFontSize(10);
  }
  if (prevTargetSheet) {
    const cleanName = prevTargetSheet
      .getName()
      .replace("(직전시트)", "")
      .trim();
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList([cleanName, "업데이트"], true)
      .build();
    prevTargetSheet
      .getRange("C1")
      .setDataValidation(rule)
      .setValue(cleanName)
      .setWrap(true)
      .setFontSize(10);
  }

  if (currentSheet) {
    const maxRows = currentSheet.getMaxRows();
    const lastRow = currentSheet.getLastRow();
    if (maxRows > lastRow) {
      currentSheet.deleteRows(lastRow + 1, maxRows - lastRow);
    }
  }

  const allSheets = targetSs.getSheets();
  const pastSheets = [];
  for (let i = 4; i < allSheets.length; i++) {
    pastSheets.push(allSheets[i]);
  }
  pastSheets.sort((a, b) => a.getName().localeCompare(b.getName()));
  if (pastSheets.length > 2) {
    for (let i = 2; i < pastSheets.length; i++) {
      targetSs.deleteSheet(pastSheets[i]);
    }
  }

  targetSs.setActiveSheet(currentSheet);
}
