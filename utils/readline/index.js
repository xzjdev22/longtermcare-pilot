const readline = require("readline");

let rl = null;

/**
 * 전역에서 단 하나의 readline 인터페이스만 유지합니다.
 */
function getInterface() {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return rl;
}

/**
 * 사용자의 입력을 기다리는 Promise 기반 함수
 */
const ask = (q) => {
  const interface = getInterface();
  return new Promise((res) => interface.question(q, res));
};

/**
 * 모든 공정이 끝났을 때만 호출하여 인터페이스를 닫습니다.
 */
function closeInterface() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

module.exports = { ask, closeInterface };
