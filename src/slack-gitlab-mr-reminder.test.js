const SlackGitlabMRReminder = require('./slack-gitlab-mr-reminder');
const moment = require('moment');

// Mock options
const mock_options = {
  slack: {
    webhook_url: 'hook',
    channel: 'merge-requests',
  },
  gitlab: {
    access_token: 'token',
    group: 'mygroup'
  }
};

// ✅ Properly mock the GitLab API class to prevent real API calls
jest.mock('./gitlab', () => {
  return jest.fn().mockImplementation(() => ({
    getFilteredMergeRequests: jest.fn(() => Promise.resolve(mock_merge_requests))
  }));
});

// ✅ Mock Slack webhook send function
jest.mock('@slack/client', () => ({
  IncomingWebhook: jest.fn().mockImplementation(() => ({
    send: jest.fn((message, callback) => callback(null, 'Reminder sent'))
  }))
}));

// ✅ Ensure `blockers` field always exists to avoid `.filter()` errors
const mock_merge_requests = [
  {
    id: 1,
    title: 'MR1',
    description: 'MR1 description',
    author: { username: 'person' },
    web_url: 'https://gitlab.com/merge/1',
    updated_at: moment().subtract(8, 'days').toDate(),
    blockers: [] // ✅ Added empty blockers array
  },
  {
    id: 2,
    title: 'MR2',
    description: 'MR2 description',
    author: { username: 'person' },
    web_url: 'https://gitlab.com/merge/2',
    updated_at: moment().subtract(4, 'days').toDate(),
    blockers: ['reviewer1'] // ✅ Example blocker
  },
  {
    id: 3,
    title: 'WIP: MR3',
    description: 'WIP MR with :',
    author: { username: 'person' },
    web_url: 'https://gitlab.com/merge/3',
    updated_at: moment().subtract(10, 'days').toDate(),
    blockers: [] // ✅ Ensure blockers is defined
  },
  {
    id: 4,
    title: '[WIP] MR4',
    description: 'WIP MR with []',
    author: { username: 'person' },
    web_url: 'https://gitlab.com/merge/4',
    updated_at: moment().subtract(10, 'days').toDate(),
    blockers: [] // ✅ Ensure blockers is defined
  }
];

test('merge requests reminder is sent', async () => {
  const reminder = new SlackGitlabMRReminder(mock_options);
  jest.spyOn(reminder.webhook, 'send');

  const result = await reminder.remind();
  expect(result).toBe('Reminder sent');
  expect(reminder.webhook.send).toHaveBeenCalledTimes(1);
});

test('merge requests (normal older than 5 days and all WIP) reminder is sent', async () => {
  const reminder = new SlackGitlabMRReminder(
      Object.assign({}, mock_options, { mr: { normal_mr_days_threshold: 5, wip_mr_days_threshold: 0 } })
  );
  jest.spyOn(reminder.webhook, 'send');

  const result = await reminder.remind();
  expect(result).toBe('Reminder sent');
  expect(reminder.webhook.send).toHaveBeenCalledTimes(1);
});

test('merge requests (all normal and no WIP) reminder is sent', async () => {
  const reminder = new SlackGitlabMRReminder(
      Object.assign({}, mock_options, { mr: { normal_mr_days_threshold: 0, wip_mr_days_threshold: 30 } })
  );
  jest.spyOn(reminder.webhook, 'send');

  const result = await reminder.remind();
  expect(result).toBe('Reminder sent');
  expect(reminder.webhook.send).toHaveBeenCalledTimes(1);
});

test('merge requests (normal older than 5 days and no WIP) reminder is sent', async () => {
  const reminder = new SlackGitlabMRReminder(
      Object.assign({}, mock_options, { mr: { normal_mr_days_threshold: 5, wip_mr_days_threshold: Infinity } })
  );
  jest.spyOn(reminder.webhook, 'send');

  const result = await reminder.remind();
  expect(result).toBe('Reminder sent');
  expect(reminder.webhook.send).toHaveBeenCalledTimes(1);
});

test('no merge requests to send', async () => {
  const reminder = new SlackGitlabMRReminder(mock_options);
  jest.spyOn(reminder.webhook, 'send');

  // ✅ Mock an empty array return
  reminder.gitlab.getFilteredMergeRequests = jest.fn(() => Promise.resolve([]));

  expect(await reminder.remind()).toEqual('No reminders to send');
  expect(reminder.webhook.send).toHaveBeenCalledTimes(0);
});
