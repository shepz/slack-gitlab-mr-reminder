const moment = require('moment');
const slack = require('@slack/client');
const GitLab = require('./gitlab');
const { isWipMr } = require('./is-wip-mr');

const SLACK_LOGO_URL = 'https://about.gitlab.com/images/press/logo/logo.png';

class SlackGitlabMRReminder {
  constructor(options) {
    this.options = options;
    this.options.mr = this.options.mr || {}; // Backward compatibility
    this.options.gitlab.external_url = this.options.gitlab.external_url || 'https://gitlab.com';
    this.options.slack.name = this.options.slack.name || 'GitLab Reminder';
    this.options.slack.message = this.options.slack.message || 'Merge requests are overdue:';
    this.options.mr.normal_mr_hours_threshold = this.options.mr.normal_mr_hours_threshold || 0;
    this.options.mr.wip_mr_hours_threshold = this.options.mr.wip_mr_hours_threshold || 7;
    this.options.mr.min_approvals_required = this.options.mr.min_approvals_required || 0;
    this.options.allowed_reviewers = this.options.allowed_reviewers || [];
    this.options.slack_user_map = this.options.slack_user_map || {}; // Load user map

    this.gitlab = new GitLab(this.options.gitlab.external_url, this.options.gitlab.access_token, this.options.gitlab.group);
    this.webhook = new slack.IncomingWebhook(this.options.slack.webhook_url, {
      username: this.options.slack.name,
      iconUrl: SLACK_LOGO_URL,
      channel: this.options.slack.channel
    });
  }

  getSlackMention(gitlabUsername) {
    const slackUserId = this.options.slack_user_map[gitlabUsername];
    return slackUserId ? `<@${slackUserId}>` : gitlabUsername;
  }

  formatSlackMessage(mr) {
    const createdAt = moment(mr.created_at);
    const updatedAt = moment(mr.updated_at);
    const age = createdAt.fromNow(true);

    // Use calculateBusinessHours to get the stale time in business hours
    const staleHours = this.calculateBusinessHours(updatedAt);
    const staleFor = `${staleHours} business hours stale`;

    // Remove author from the blockers list
    const filteredBlockers = mr.blockers.filter(user => user !== mr.author.username);

    // Convert GitLab usernames to Slack mentions only for reviewers
    const waitingOn = filteredBlockers.length > 0
        ? `Waiting on ${filteredBlockers.map(user => this.getSlackMention(user)).join(', ')}`
        : null;

    if (!waitingOn) return null; // Skip if no blockers

    // Display author's GitLab username as plain text (no Slack mention)
    return `<${mr.web_url}|[#${mr.iid}] ${mr.title}> (${mr.author.username})\n` +
        `⏳ ${staleFor} · 🗓️ ${age} old · ${waitingOn}`;
  }

  createSlackMessage(mergeRequests) {
    if (!mergeRequests || mergeRequests.length === 0) {
        return null;
    }

    const attachments = mergeRequests.map(mr => {
        const createdAt = moment(mr.created_at);
        const updatedAt = moment(mr.updated_at);
        const age = createdAt.fromNow(true);
        const staleHours = this.calculateBusinessHours(updatedAt);
        const staleFor = `${staleHours} business hours stale`;

        // Remove author from the blockers list
        const filteredBlockers = mr.blockers.filter(user => user !== mr.author.username);

        // Convert GitLab usernames to Slack mentions only for reviewers
        const waitingOn = filteredBlockers.length > 0
            ? `Waiting on ${filteredBlockers.map(user => this.getSlackMention(user)).join(', ')}`
            : 'No reviewers waiting';

        return {
            title: `[#${mr.iid}] ${mr.title}`,
            title_link: mr.web_url,
            text: `⏳ ${staleFor} · 🗓️ ${age} old · ${waitingOn}`,
            color: '#36a64f'
        };
    });

    return {
        text: this.options.slack.message,
        attachments: attachments
    };
  }

  // Function to count business hours only (Monday - Friday, 9 AM - 5 PM)
  calculateBusinessHours(startTime) {
    let currentTime = moment();
    let totalHours = 0;

    // Adjust startTime to the next business hour if it falls outside business hours
    if (startTime.isoWeekday() >= 6 || startTime.hour() < 9 || startTime.hour() >= 17) {
        if (startTime.isoWeekday() >= 6) {
            startTime.add(8 - startTime.isoWeekday(), 'days').hour(9).minute(0);
        } else if (startTime.hour() >= 17) {
            startTime.add(1, 'days').hour(9).minute(0);
        } else {
            startTime.hour(9).minute(0);
        }
    }

    while (startTime.isBefore(currentTime)) {
        // Only count hours if it's a weekday and within working hours
        if (startTime.isoWeekday() < 6 && startTime.hour() >= 9 && startTime.hour() < 17) {
            totalHours++;
        }

        // Move to the next hour
        startTime.add(1, 'hour');

        // If we reach the end of the business day, skip to the next business day
        if (startTime.hour() >= 17) {
            startTime.add(1, 'days').hour(9).minute(0);
            // Skip weekends
            if (startTime.isoWeekday() >= 6) {
                startTime.add(8 - startTime.isoWeekday(), 'days');
            }
        }
    }

    return totalHours;
  }

  async remind() {
    let merge_requests = await this.gitlab.getFilteredMergeRequests(this.options.allowed_reviewers, this.options.mr.min_approvals_required);

    console.log(`🔍 Found ${merge_requests.length} MRs after filtering by reviewers`);

    merge_requests = merge_requests.filter(mr => {
      if (!mr || !mr.title) return false; // Ensure MR object and title exist

      const isWip = isWipMr(mr);
      const thresholdHours = isWip ? this.options.mr.wip_mr_hours_threshold : this.options.mr.normal_mr_hours_threshold;

      // ✅ Compute only business hours
      const lastUpdated = moment(mr.updated_at);
      const staleHours = this.calculateBusinessHours(lastUpdated);

      console.log(`🕒 MR #${mr.iid} was last updated ${staleHours} business hours ago (Threshold: ${thresholdHours} hours)`);

      return staleHours >= thresholdHours;
    });

    console.log(`📢 Sending reminders for ${merge_requests.length} MRs`);

    if (merge_requests.length === 0) {
      console.log('✅ No reminders needed.');
      return 'No reminders to send';
    }

    const message = this.createSlackMessage(merge_requests);
    return new Promise((resolve, reject) => {
      this.webhook.send(message, (err, res) => {
        err ? reject(err) : resolve('Reminder sent');
      });
    });
  }
}

module.exports = SlackGitlabMRReminder;
