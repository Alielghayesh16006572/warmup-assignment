const fs = require("fs");

// ─────────────────────────────────────────────
// HELPER UTILITIES
// ─────────────────────────────────────────────

/**
 * Converts a 12-hour time string "h:mm:ss am/pm" to total seconds from midnight.
 */
function timeToSeconds(timeStr) {
  timeStr = timeStr.trim().toLowerCase();
  const period = timeStr.includes("pm") ? "pm" : "am";
  const timePart = timeStr.replace("pm", "").replace("am", "").trim();
  const parts = timePart.split(":");
  let h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const s = parseInt(parts[2], 10);

  if (period === "am" && h === 12) h = 0;
  if (period === "pm" && h !== 12) h += 12;

  return h * 3600 + m * 60 + s;
}

/**
 * Converts total seconds to "h:mm:ss" format (hours can exceed 24).
 */
function secondsToHMS(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Converts "h:mm:ss" or "hhh:mm:ss" duration string to total seconds.
 */
function durationToSeconds(durationStr) {
  const [h, m, s] = durationStr.trim().split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

// ─────────────────────────────────────────────
// FUNCTION 1: getShiftDuration
// ─────────────────────────────────────────────

/**
 * Calculates the difference between startTime and endTime.
 * @param {string} startTime - "hh:mm:ss am/pm"
 * @param {string} endTime   - "hh:mm:ss am/pm"
 * @returns {string} - "h:mm:ss"
 */
function getShiftDuration(startTime, endTime) {
  const startSec = timeToSeconds(startTime);
  let endSec = timeToSeconds(endTime);
  let diff = endSec - startSec;
  // Handle overnight shifts (crosses midnight)
  if (diff < 0) diff += 24 * 3600;
  return secondsToHMS(diff);
}

// ─────────────────────────────────────────────
// FUNCTION 2: getIdleTime
// ─────────────────────────────────────────────

/**
 * Calculates idle time outside delivery hours (8:00 AM – 10:00 PM).
 * @param {string} startTime - "hh:mm:ss am/pm"
 * @param {string} endTime   - "hh:mm:ss am/pm"
 * @returns {string} - "h:mm:ss"
 */
function getIdleTime(startTime, endTime) {
  const startSec = timeToSeconds(startTime);
  const endSec = timeToSeconds(endTime);

  const deliveryStart = 8 * 3600;   // 8:00 AM
  const deliveryEnd = 22 * 3600;    // 10:00 PM

  let idleSec = 0;

  // Idle BEFORE 8:00 AM
  if (startSec < deliveryStart) {
    const preEnd = Math.min(endSec, deliveryStart);
    idleSec += preEnd - startSec;
  }

  // Idle AFTER 10:00 PM
  if (endSec > deliveryEnd) {
    const postStart = Math.max(startSec, deliveryEnd);
    idleSec += endSec - postStart;
  }

  return secondsToHMS(idleSec);
}

// ─────────────────────────────────────────────
// FUNCTION 3: getActiveTime
// ─────────────────────────────────────────────

/**
 * Calculates active delivery time = shiftDuration - idleTime.
 * @param {string} shiftDuration - "h:mm:ss"
 * @param {string} idleTime      - "h:mm:ss"
 * @returns {string} - "h:mm:ss"
 */
function getActiveTime(shiftDuration, idleTime) {
  const shiftSec = durationToSeconds(shiftDuration);
  const idleSec = durationToSeconds(idleTime);
  return secondsToHMS(shiftSec - idleSec);
}

// ─────────────────────────────────────────────
// FUNCTION 4: metQuota
// ─────────────────────────────────────────────

/**
 * Returns true if the driver's active hours meet the daily quota.
 * Eid al-Fitr period (Apr 10–30, 2025): quota = 6 hours.
 * Normal quota = 8 hours 24 minutes.
 * @param {string} date       - "yyyy-mm-dd"
 * @param {string} activeTime - "h:mm:ss"
 * @returns {boolean}
 */
function metQuota(date, activeTime) {
  const activeSec = durationToSeconds(activeTime);

  const eidStart = new Date("2025-04-10");
  const eidEnd = new Date("2025-04-30");
  const shiftDate = new Date(date);

  let quotaSec;
  if (shiftDate >= eidStart && shiftDate <= eidEnd) {
    quotaSec = 6 * 3600; // 6 hours
  } else {
    quotaSec = 8 * 3600 + 24 * 60; // 8h 24m
  }

  return activeSec >= quotaSec;
}

// ─────────────────────────────────────────────
// FUNCTION 5: addShiftRecord
// ─────────────────────────────────────────────

/**
 * Adds a new shift record to the text file.
 * Returns {} if duplicate (same driverID + date) exists.
 * Inserts after the last record of that driverID if it exists,
 * otherwise appends at end.
 * @param {string} textFile - path to shifts.txt
 * @param {object} shiftObj - { driverID, driverName, date, startTime, endTime }
 * @returns {object} - full record with 10 properties, or {}
 */
function addShiftRecord(textFile, shiftObj) {
  const { driverID, driverName, date, startTime, endTime } = shiftObj;

  const content = fs.readFileSync(textFile, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim() !== "");

  // Check for duplicate
  for (const line of lines) {
    const cols = line.split(",");
    if (cols[0].trim() === driverID && cols[2].trim() === date) {
      return {};
    }
  }

  // Calculate derived fields
  const shiftDuration = getShiftDuration(startTime, endTime);
  const idleTime = getIdleTime(startTime, endTime);
  const activeTime = getActiveTime(shiftDuration, idleTime);
  const quota = metQuota(date, activeTime);
  const hasBonus = false;

  const newRecord = {
    driverID,
    driverName,
    date,
    startTime,
    endTime,
    shiftDuration,
    idleTime,
    activeTime,
    metQuota: quota,
    hasBonus,
  };

  const newLine = `${driverID},${driverName},${date},${startTime},${endTime},${shiftDuration},${idleTime},${activeTime},${quota},${hasBonus}`;

  // Find last occurrence of driverID
  let lastIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols[0].trim() === driverID) {
      lastIndex = i;
    }
  }

  if (lastIndex === -1) {
    // Append at end
    lines.push(newLine);
  } else {
    // Insert after last record of this driverID
    lines.splice(lastIndex + 1, 0, newLine);
  }

  fs.writeFileSync(textFile, lines.join("\n") + "\n", "utf-8");

  return newRecord;
}

// ─────────────────────────────────────────────
// FUNCTION 6: setBonus
// ─────────────────────────────────────────────

/**
 * Sets the hasBonus field for a specific driverID + date in the file.
 * @param {string}  textFile  - path to shifts.txt
 * @param {string}  driverID
 * @param {string}  date      - "yyyy-mm-dd"
 * @param {boolean} newValue
 */
function setBonus(textFile, driverID, date, newValue) {
  const content = fs.readFileSync(textFile, "utf-8");
  const lines = content.split("\n");

  const updated = lines.map((line) => {
    if (line.trim() === "") return line;
    const cols = line.split(",");
    if (cols[0].trim() === driverID && cols[2].trim() === date) {
      cols[9] = String(newValue);
      return cols.join(",");
    }
    return line;
  });

  fs.writeFileSync(textFile, updated.join("\n"), "utf-8");
}

// ─────────────────────────────────────────────
// FUNCTION 7: countBonusPerMonth
// ─────────────────────────────────────────────

/**
 * Counts bonus records for a given driverID and month.
 * Returns -1 if driverID not found.
 * @param {string} textFile
 * @param {string} driverID
 * @param {string} month - "m" or "mm"
 * @returns {number}
 */
function countBonusPerMonth(textFile, driverID, month) {
  const content = fs.readFileSync(textFile, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim() !== "");

  const targetMonth = parseInt(month, 10);
  let found = false;
  let count = 0;

  for (const line of lines) {
    const cols = line.split(",");
    if (cols[0].trim() === driverID) {
      found = true;
      const recordMonth = parseInt(cols[2].trim().split("-")[1], 10);
      if (recordMonth === targetMonth && cols[9].trim() === "true") {
        count++;
      }
    }
  }

  return found ? count : -1;
}

// ─────────────────────────────────────────────
// FUNCTION 8: getTotalActiveHoursPerMonth
// ─────────────────────────────────────────────

/**
 * Returns total active hours for a driverID in a given month.
 * @param {string} textFile
 * @param {string} driverID
 * @param {number} month
 * @returns {string} - "hhh:mm:ss"
 */
function getTotalActiveHoursPerMonth(textFile, driverID, month) {
  const content = fs.readFileSync(textFile, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim() !== "");

  let totalSec = 0;

  for (const line of lines) {
    const cols = line.split(",");
    if (cols[0].trim() === driverID) {
      const recordMonth = parseInt(cols[2].trim().split("-")[1], 10);
      if (recordMonth === month) {
        totalSec += durationToSeconds(cols[7].trim());
      }
    }
  }

  return secondsToHMS(totalSec);
}

// ─────────────────────────────────────────────
// FUNCTION 9: getRequiredHoursPerMonth
// ─────────────────────────────────────────────

/**
 * Calculates total required hours for a driver in a month.
 * - Days off are excluded.
 * - Eid period quota = 6h, normal = 8h24m.
 * - Each bonus reduces required hours by 2h.
 * @param {string} textFile
 * @param {string} rateFile
 * @param {number} bonusCount
 * @param {string} driverID
 * @param {number} month
 * @returns {string} - "hhh:mm:ss"
 */
function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
  const shiftContent = fs.readFileSync(textFile, "utf-8");
  const shiftLines = shiftContent.split("\n").filter((l) => l.trim() !== "");

  const rateContent = fs.readFileSync(rateFile, "utf-8");
  const rateLines = rateContent.split("\n").filter((l) => l.trim() !== "");

  // Find driver's day off
  let dayOff = null;
  for (const line of rateLines) {
    const cols = line.split(",");
    if (cols[0].trim() === driverID) {
      dayOff = cols[1].trim().toLowerCase();
      break;
    }
  }

  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  const eidStart = new Date("2025-04-10");
  const eidEnd = new Date("2025-04-30");

  let totalSec = 0;

  for (const line of shiftLines) {
    const cols = line.split(",");
    if (cols[0].trim() === driverID) {
      const dateStr = cols[2].trim();
      const recordMonth = parseInt(dateStr.split("-")[1], 10);
      if (recordMonth === month) {
        const shiftDate = new Date(dateStr);
        const shiftDayName = dayNames[shiftDate.getDay()];

        // Skip day off
        if (dayOff && shiftDayName === dayOff) continue;

        // Determine quota for this day
        let quotaSec;
        if (shiftDate >= eidStart && shiftDate <= eidEnd) {
          quotaSec = 6 * 3600;
        } else {
          quotaSec = 8 * 3600 + 24 * 60;
        }

        totalSec += quotaSec;
      }
    }
  }

  // Subtract 2 hours per bonus
  totalSec -= bonusCount * 2 * 3600;
  if (totalSec < 0) totalSec = 0;

  return secondsToHMS(totalSec);
}

// ─────────────────────────────────────────────
// FUNCTION 10: getNetPay
// ─────────────────────────────────────────────

/**
 * Calculates the net monthly pay after deductions for missing hours.
 * @param {string} driverID
 * @param {string} actualHours   - "hhh:mm:ss"
 * @param {string} requiredHours - "hhh:mm:ss"
 * @param {string} rateFile
 * @returns {number}
 */
function getNetPay(driverID, actualHours, requiredHours, rateFile) {
  const rateContent = fs.readFileSync(rateFile, "utf-8");
  const rateLines = rateContent.split("\n").filter((l) => l.trim() !== "");

  let basePay = 0;
  let tier = 0;

  for (const line of rateLines) {
    const cols = line.split(",");
    if (cols[0].trim() === driverID) {
      basePay = parseInt(cols[2].trim(), 10);
      tier = parseInt(cols[3].trim(), 10);
      break;
    }
  }

  const actualSec = durationToSeconds(actualHours);
  const requiredSec = durationToSeconds(requiredHours);

  // No deduction if actual >= required
  if (actualSec >= requiredSec) {
    return basePay;
  }

  const missingTotalSec = requiredSec - actualSec;
  const missingTotalHours = missingTotalSec / 3600; // decimal hours

  // Allowed missing hours per tier
  const allowedMissingHours = { 1: 50, 2: 20, 3: 10, 4: 3 };
  const allowed = allowedMissingHours[tier] || 0;

  const billableDecimalHours = missingTotalHours - allowed;

  if (billableDecimalHours <= 0) {
    return basePay;
  }

  // Only full hours count
  const billableFullHours = Math.floor(billableDecimalHours);

  const deductionRatePerHour = Math.floor(basePay / 185);
  const salaryDeduction = billableFullHours * deductionRatePerHour;

  return basePay - salaryDeduction;
}

// ─────────────────────────────────────────────
// EXPORTS (for testing with publicTests.js)
// ─────────────────────────────────────────────
module.exports = {
  getShiftDuration,
  getIdleTime,
  getActiveTime,
  metQuota,
  addShiftRecord,
  setBonus,
  countBonusPerMonth,
  getTotalActiveHoursPerMonth,
  getRequiredHoursPerMonth,
  getNetPay,
};