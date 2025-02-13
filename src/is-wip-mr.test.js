const { isWipMr } = require('./is-wip-mr');

test('Bracket WIP case-insensitive', () => {
  expect(isWipMr({ title: ' [wiP]true' })).toBeTruthy();
});

test('Colon WIP case-insensitive', () => {
  expect(isWipMr({ title: ' wiP:true' })).toBeTruthy();
});

test('not a WIP', () => {
  expect(isWipMr({ title: ' [wi P]true' })).toBeFalsy();
  expect(isWipMr({ title: ' w iP:true' })).toBeFalsy();
});

test('Draft MR', () => {
  expect(isWipMr({ title: 'Feature update', work_in_progress: true })).toBeTruthy();
});

test('Missing title', () => {
  expect(isWipMr({})).toBeFalsy();
  expect(isWipMr(null)).toBeFalsy();
  expect(isWipMr(undefined)).toBeFalsy();
});
