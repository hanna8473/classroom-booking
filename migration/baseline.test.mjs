import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { test } from 'node:test';

function loadRules(file, names, globals) {
  const html = readFileSync(new URL('../classroom-baseline/' + file, import.meta.url), 'utf8');
  const context = createContext(globals);
  for (const name of names) {
    const pattern = new RegExp('^([ \\t]*)function ' + name + '\\([^\\n]*?\\{(?:[^\\n]*\\}\\r?$|[\\s\\S]*?^\\1\\})', 'm');
    const match = html.match(pattern);
    assert.ok(match, name + ' was not found in ' + file);
    runInContext(match[0], context);
  }
  return context;
}

class SchoolClock extends Date {
  constructor(...args) {
    super(...(args.length ? args : [2026, 10, 19, 18, 0]));
  }
}

function bookingRules(overrides = {}) {
  return loadRules('index.html', [
    'toMinutes', 'isTimeInRangeNow', 'getDayOfWeek', 'getEffectiveThuRuleDay',
    'isWithinBookingTime', 'getEffectiveAvailability', 'canAttemptBookingFor',
    'isRoomAllowedOnDate', 'roomHasBookingOn', 'getVisibleRoomsFor',
    'isNewThuClassroomSlot', 'gradeOfUserName', 'allowBookingFor'
  ], {
    Date: SchoolClock,
    getDateKey: date => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'),
      String(date.getDate()).padStart(2,'0')].join('-'),
    console, thursdayRuleDates: new Set(), bookings: {}, scheduleNotes: {},
    tempAvailability: {}, baseWeeklyAvailability: {}, weeklyAvailability: {},
    bookingTimes: { eveningStart: '18:00', eveningEnd: '22:00' },
    CLASSROOM_GRADE: { '7-1': '7' }, NEW_THU_CLASSROOMS: ['7-1'],
    classrooms: ['도서관', '강당', '7-1'], timeSlots: ['저녁1교시', '저녁2교시'],
    ...overrides
  });
}

const today = new SchoolClock();

test('same classroom and slot: another applicant is allowed', () => {
  const rules = bookingRules({ bookings: {
    '2026-11-19-도서관-저녁1교시': [{ name: '7가나다' }]
  } });
  assert.equal(rules.allowBookingFor('7라마바', today, '도서관', '저녁1교시').allowed, true);
});

test('same applicant and slot: switching classrooms still counts as duplicate', () => {
  const rules = bookingRules({ bookings: {
    '2026-11-19-강당-저녁2교시': { old: { name: '7가나다' } }
  } });
  assert.equal(rules.allowBookingFor('7가나다', today, '도서관', '저녁2교시').reason,
    '동일 시간대 이미 신청됨');
});

test('temporary availability replaces the weekday grid; special library slot stays open', () => {
  const rules = bookingRules({
    baseWeeklyAvailability: { 목: { '7-1': { 저녁1교시: true } } },
    tempAvailability: { '2026-11-19': { 강당: { 저녁1교시: true } } }
  });
  assert.equal(rules.canAttemptBookingFor(today, '7-1', '저녁1교시'), false);
  assert.equal(rules.canAttemptBookingFor(today, '도서관', '저녁1교시'), true);
});

test('explicit grade-room approval and matching grade are separate checks', () => {
  const rules = bookingRules({
    bookingTimes: { eveningStart: '20:00', eveningEnd: '22:00' },
    baseWeeklyAvailability: { 목: { '7-1': { 저녁1교시: true } } }
  });
  assert.equal(rules.allowBookingFor('7가나다', today, '7-1', '저녁1교시').allowed, true);
  assert.equal(rules.allowBookingFor('8라마바', today, '7-1', '저녁1교시').allowed, false);
});

test('time windows include opening, exclude closing, and can cross midnight', () => {
  const rules = bookingRules();
  assert.equal(rules.isTimeInRangeNow('18:00', '19:00'), true);
  assert.equal(rules.isTimeInRangeNow('17:00', '18:00'), false);
  assert.equal(rules.isTimeInRangeNow('17:00', '01:00'), true);
  assert.equal(rules.isTimeInRangeNow('19:00', '01:00'), false);
});

function cleaningRules(overrides = {}) {
  return loadRules('cleaning_duty_3.html', [
    'computeWeeks', 'getShortfallDay', 'computeDayTargets', 'orderZonesForPicking',
    'classroomGenderForWeek'
  ], {
    WEEKDAYS: ['월','화','수','목','금'], ASSIGN_DAYS: ['월','화','수','목'],
    SHORTFALL_NONE: '없음', shortfallDay: {}, genderSplitFlip: {},
    zones: { demo: [{ groupSize: 3 }, { groupSize: 2 }, { groupSize: 1 }] },
    otherGender: gender => gender === '여' ? '남' : '여',
    ...overrides
  });
}

test('cleaning calendar advances by seven days across month boundaries', () => {
  const weeks = cleaningRules().computeWeeks('2026-11-30', 2);
  assert.equal(weeks[0].dates.월, '11/30');
  assert.equal(weeks[0].dates.금, '12/4');
  assert.equal(weeks[1].dates.월, '12/7');
});

test('shortfall targets differ between default Tuesday and no specific day', () => {
  const defaultTargets = cleaningRules().computeDayTargets('demo', 22);
  const evenTargets = cleaningRules({ shortfallDay: { demo: '없음' } }).computeDayTargets('demo', 22);
  assert.deepEqual({ ...defaultTargets }, { 월: 6, 화: 4, 수: 6, 목: 6 });
  assert.deepEqual({ ...evenTargets }, { 월: 6, 화: 6, 수: 5, 목: 5 });
});

test('two-person zones come first without changing the original zone order', () => {
  const zones = [3, 1, 2, 4].map(groupSize => ({ groupSize }));
  assert.deepEqual(Array.from(cleaningRules().orderZonesForPicking(zones), z => z.groupSize),
    [2, 1, 3, 4]);
  assert.deepEqual(zones.map(z => z.groupSize), [3, 1, 2, 4]);
});

test('classroom gender alternates by week and honors the saved flip', () => {
  const ordinary = cleaningRules();
  const flipped = cleaningRules({ genderSplitFlip: { demo: true } });
  assert.equal(ordinary.classroomGenderForWeek('demo', 1), '여');
  assert.equal(ordinary.classroomGenderForWeek('demo', 2), '남');
  assert.equal(flipped.classroomGenderForWeek('demo', 1), '남');
});
