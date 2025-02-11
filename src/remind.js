#!/usr/bin/env node
var yaml = require('js-yaml');
var fs = require('fs');
var SlackGitlabMRReminder = require('./slack-gitlab-mr-reminder');

const optionsFile = process.argv[2];

let options = {
    mr: {},
    slack: {},
    gitlab: {},
    allowed_reviewers: []
};

// ✅ Load config file if provided
if (fs.existsSync(optionsFile)) {
    options = yaml.load(fs.readFileSync(optionsFile, 'utf-8'));
}

// ✅ Load reviewers from config or ENV
if (process.env['ALLOWED_REVIEWERS']) {
    options.allowed_reviewers = process.env['ALLOWED_REVIEWERS'].split(',').map(user => user.trim());
} else if (options.allowed_reviewers) {
    options.allowed_reviewers = options.allowed_reviewers.map(user => user.trim());
}

// ✅ Load Slack settings
options.slack.webhook_url = options.slack.webhook_url || process.env['SLACK_WEBHOOK_URL'];
options.slack.channel = options.slack.channel || process.env['SLACK_CHANNEL'];

// ✅ Load GitLab settings
options.gitlab.access_token = options.gitlab.access_token || process.env['GITLAB_ACCESS_TOKEN'];
options.gitlab.group = options.gitlab.group || process.env['GITLAB_GROUP'];
options.gitlab.external_url = options.gitlab.external_url || process.env['GITLAB_EXTERNAL_URL'];

// ✅ Load MR thresholds
options.mr.normal_mr_days_threshold = options.mr.normal_mr_days_threshold || process.env['GITLAB_NORMAL_MR_DAYS_THRESHOLD'];
options.mr.wip_mr_days_threshold = options.mr.wip_mr_days_threshold || process.env['GITLAB_WIP_MR_DAYS_THRESHOLD'];

// ✅ Debug logs
if (process.env['REMINDER_DEBUG']) {
    console.log('Parsed options: ', JSON.stringify(options, null, 2));
    console.log('Env options: ', JSON.stringify(process.env, null, 2));
}

// ✅ Ensure `allowed_reviewers` is correctly passed
if (options.allowed_reviewers) {
    console.log(`🔍 Filtering MRs for allowed reviewers: ${options.allowed_reviewers.join(', ')}`);
} else {
    console.log(`⚠️ No allowed reviewers set. All MRs will be processed.`);
}

// ✅ Start the reminder process
const reminder = new SlackGitlabMRReminder(options);
reminder.remind();
