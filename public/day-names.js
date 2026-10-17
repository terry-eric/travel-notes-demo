const dayNameEscape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function dayNumber(index) {
 if (!Number.isSafeInteger(index) || index < 0) throw new Error('請選擇有效的行程日期。');
 return index + 1;
}

/** A blank name restores the numbered-day label; arbitrary text stays plain text. */
export function validateDayName(value, index) {
 const number = dayNumber(index);
 if (value === undefined) return `第${number}天`;
 if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
  throw new Error('每日名稱需為文字，且不可包含換行或控制字元。');
 }
 const title = value.trim();
 if (title.length > 120) throw new Error('每日名稱最多可填寫 120 個字。');
 return title || `第${number}天`;
}

/** Returns a new snapshot so a failed save cannot mutate the displayed/cloud base. */
export function renameDay(days, index, value) {
 dayNumber(index);
 if (!Array.isArray(days) || index >= days.length || !days[index] || typeof days[index] !== 'object') {
  throw new Error('請選擇有效的行程日期。');
 }
 const title = validateDayName(value, index);
 const next = structuredClone(days);
 next[index].title = title;
 return next;
}

/** Render beside the day's date, outside stop cards/navigation buttons. */
export function renderDayName(day, index, { canEdit = false } = {}) {
 const number = dayNumber(index), title = dayNameEscape(validateDayName(day?.title, index));
 if (canEdit !== true) return `<h3 class="day-name-heading">${title}</h3>`;
 const id = `day-name-${index}`;
 return `<form class="day-name-form" data-day-name-form data-day-index="${index}" aria-label="第${number}天的名稱"><label class="day-name-field" for="${id}"><span class="day-name-label">第${number}天名稱</span><input class="day-name-input" id="${id}" name="dayName" data-day-index="${index}" type="text" value="${title}" maxlength="120" autocomplete="off" placeholder="第${number}天"></label><button class="day-name-save" type="submit">儲存名稱</button><button type="button" class="plain" data-day-name-cancel hidden>取消</button></form>`;
}
