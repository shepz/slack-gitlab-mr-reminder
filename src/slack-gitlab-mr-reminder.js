const moment = require('moment');
const slack = require('@slack/client');
const GitLab = require('./gitlab');
const { isWipMr } = require('./is-wip-mr');

const SLACK_LOGO_URL = 'https://about.gitlab.com/images/press/logo/logo.png';

class SlackGitlabMRReminder {
  constructor(options) {
    this.options = options;
    this.options.mr = this.options.mr || {}; // backward compatible
    this.options.gitlab.external_url = this.options.gitlab.external_url || 'https://gitlab.com';
    this.options.slack.name = this.options.slack.name || 'GitLab Reminder';
    this.options.slack.message = this.options.slack.message || 'Merge requests are overdue:';
    this.options.mr.normal_mr_days_threshold = this.options.mr.normal_mr_days_threshold || 0;
    this.options.mr.wip_mr_days_threshold = this.options.mr.wip_mr_days_threshold || 7;
    this.gitlab = new GitLab(this.options.gitlab.external_url, this.options.gitlab.access_token, this.options.gitlab.group);
    this.webhook = new slack.IncomingWebhook(this.options.slack.webhook_url, {
      username: this.options.slack.name,
      iconUrl: SLACK_LOGO_URL,
      channel: this.options.slack.channel
    });
  }

  formatSlackMessage(mr) {
    const createdAt = moment(mr.created_at);
    const updatedAt = moment(mr.updated_at);
    const age = createdAt.fromNow(true);
    const staleFor = moment().diff(moment(mr.updated_at), 'days') > 0 ? updatedAt.fromNow(true) : 'Just updated';

    // Remove author from blockers (they shouldn't be waiting on themselves)
    const filteredBlockers = mr.blockers.filter(user => user !== mr.author.username);
    const waitingOn = filteredBlockers.length > 0 ? `Waiting on ${filteredBlockers.join(', ')}` : 'Needs attention';

    return `<${mr.web_url}|[#${mr.iid}] ${mr.title}> (${mr.author.username})\n` +
      `⏳ ${staleFor} stale · 🗓️ ${age} old · ${waitingOn}`;
  }

  createSlackMessage(merge_requests) {
    const messages = merge_requests.map(mr => this.formatSlackMessage(mr));
    return {
      text: this.options.slack.message,
      attachments: messages.map(text => ({ text, color: '#FC6D26' }))
    };
  }

  async remind() {
    let merge_requests = await this.gitlab.getFilteredMergeRequests();

    merge_requests = merge_requests.filter(mr => {
      if (!mr || !mr.title) return false; // Ensure MR object and title exist

      const isWip = isWipMr(mr);
      const threshold = isWip ? this.options.mr.wip_mr_days_threshold : this.options.mr.normal_mr_days_threshold;

      return moment().diff(moment(mr.updated_at), 'days') > threshold;
    });

    if (merge_requests.length === 0) {
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
