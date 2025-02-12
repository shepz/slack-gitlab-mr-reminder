var request = require('request-promise-native');

class GitLab {
  constructor(external_url, access_token, group) {
    this.external_url = external_url;
    this.access_token = access_token;
    this.group = group;
  }

  _getProjectMergeRequest(project_id, { page = 1 }) {
    const options = {
      uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests?state=opened&page=${page}`,
      headers: {
        'PRIVATE-TOKEN': this.access_token
      },
      json: true
    };
    return request(options);
  }
  async getProjectMergeRequests(project_id) {
    const options = {
      uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests?state=opened`,
      headers: {
        'PRIVATE-TOKEN': this.access_token,

      },
      json: true,
      resolveWithFullResponse: true,
    };

    try {
      let promises = []
      const resp = await request(options);
      const firstPage = resp.body;
      const totalPages = Number(resp.headers['x-total-pages']);
      for (let pageNumber = 2; pageNumber <= totalPages; pageNumber++) {
        promises.push(this._getProjectMergeRequest(project_id, { page: pageNumber }));
      }

      let merge_requests = firstPage;

      if (totalPages > 1) {
        merge_requests = merge_requests.concat(await Promise.all(promises));
      }
      return merge_requests;
    } catch (e) {
      throw e;
    }
  }

  _getProject({ page = 1 }) {
    const options = {
      uri: `${this.external_url}/api/v4/groups/${this.group}/projects?page=${page}`,
      headers: {
        'PRIVATE-TOKEN': this.access_token
      },
      json: true
    };
    return request(options);
  }

  async getProjects() {
    const options = {
      uri: `${this.external_url}/api/v4/groups/${this.group}/projects`,
      headers: {
        'PRIVATE-TOKEN': this.access_token
      },
      json: true,
      resolveWithFullResponse: true,
    };
    try {
      let promises = []
      const resp = await request(options);
      const firstPage = resp.body;
      const totalPages = Number(resp.headers['x-total-pages']);
      // console.log(resp.headers);

      for (let pageNumber = 2; pageNumber <= totalPages; pageNumber++) {
        promises.push(this._getProject({ page: pageNumber }));
      }

      let projects = firstPage;
      if (totalPages > 1) {
        projects = projects.concat(await Promise.all(promises));
      }

      return projects;
    } catch (e) {
      throw e;
    }
  }

  async hasUnresolvedDiscussions(project_id, mr_iid) {
    const options = {
      uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests/${mr_iid}/discussions`,
      headers: { 'PRIVATE-TOKEN': this.access_token },
      json: true
    };
    try {
      const discussions = await request(options);
      return discussions.some(discussion =>
        discussion.notes.some(note => note.resolvable && !note.resolved)
      );
    } catch (e) {
      console.error(`Error fetching discussions for MR ${mr_iid}:`, e.message);
      return false; // Assume no unresolved discussions on failure
    }
  }

  async isReviewPending(project_id, mr_iid) {
    const options = {
      uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests/${mr_iid}/approvals`,
      headers: { 'PRIVATE-TOKEN': this.access_token },
      json: true
    };
    try {
      const approvalData = await request(options);
      return approvalData.approvals_left > 0; // True if approvals are still needed
    } catch (e) {
      console.error(`Error checking approvals for MR ${mr_iid}:`, e.message);
      return false;
    }
  }

  async getUnresolvedReviewers(project_id, mr_iid) {
    const options = {
      uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests/${mr_iid}/discussions`,
      headers: { 'PRIVATE-TOKEN': this.access_token },
      json: true
    };
    try {
      const discussions = await request(options);
      return discussions
        .flatMap(discussion => discussion.notes)
        .filter(note => note.resolvable && !note.resolved)
        .map(note => note.author.username);
    } catch (e) {
      console.error(`Error fetching discussions for MR ${mr_iid}:`, e.message);
      return [];
    }
  }

  async getApprovedUsers(project_id, mr_iid, allowedReviewers) {
    const options = {
      uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests/${mr_iid}/approvals`,
      headers: { 'PRIVATE-TOKEN': this.access_token },
      json: true
    };
    try {
      const approvalData = await request(options);

      // ✅ List of users who have approved
      let approvedUsers = approvalData.approved_by.map(approver => approver.user.username);

      // ✅ If allowedReviewers is set, only count approvals from this list
      if (allowedReviewers.length > 0) {
        approvedUsers = approvedUsers.filter(user => allowedReviewers.includes(user));
      }

      // ✅ Number of valid approvals (from allowed reviewers only)
      const approvalCount = approvedUsers.length;

      return { approvedUsers, approvalCount };
    } catch (e) {
      console.error(`Error checking approved users for MR ${mr_iid}:`, e.message);
      return { approvedUsers: [], approvalCount: 0 };
    }
  }


  async getPendingApprovals(project_id, mr_iid) {
    const options = {
      uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests/${mr_iid}/approvals`,
      headers: { 'PRIVATE-TOKEN': this.access_token },
      json: true
    };
    try {
      const approvalData = await request(options);

      // ✅ Filter only users who have NOT approved
      const pendingApprovers = approvalData.approvers
        .filter(approver => !approver.approved)
        .map(approver => approver.username);

      return pendingApprovers;
    } catch (e) {
      console.error(`Error checking approvals for MR ${mr_iid}:`, e.message);
      return [];
    }
  }

  async getReviewersAndAssignees(project_id, mr_iid) {
    const options = {
      uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests/${mr_iid}`,
      headers: { 'PRIVATE-TOKEN': this.access_token },
      json: true
    };

    try {
      const mr = await request(options);

      const reviewers = mr.reviewers ? mr.reviewers.map(r => r.username) : [];
      const assignees = mr.assignees ? mr.assignees.map(a => a.username) : [];

      return [...new Set([...reviewers, ...assignees])]; // Remove duplicates
    } catch (e) {
      console.error(`Error fetching reviewers for MR ${mr_iid}:`, e.message);
      return [];
    }
  }

  async getGroupMergeRequests() {
    const projects = await this.getProjects();
    const merge_requests = await Promise.all(
      projects
        .filter((project) => project.id !== undefined)
        .map((project) => this.getProjectMergeRequests(project.id))
    );
    return [].concat(...merge_requests);
  }

  async getFilteredMergeRequests(allowedReviewers, minApprovalsRequired = 0) {
    if (!Array.isArray(allowedReviewers)) {
      allowedReviewers = [];
    }
    console.log(`🔍 Applying allowed reviewers: ${allowedReviewers.length > 0 ? allowedReviewers.join(', ') : "None (all reviewers allowed)"}`);
    console.log(`🔍 Minimum approvals required: ${minApprovalsRequired}`);

    const projects = await this.getProjects();
    const merge_requests = await Promise.all(
      projects
        .filter(project => project.id !== undefined)
        .map(async project => {
          const mrs = await this.getProjectMergeRequests(project.id);
          return Promise.all(
            mrs.map(async mr => {
              const unresolvedUsers = await this.getUnresolvedReviewers(project.id, mr.iid);
              const pendingReviewers = await this.getPendingApprovals(project.id, mr.iid);
              const assignedReviewers = await this.getReviewersAndAssignees(project.id, mr.iid);

              // ✅ Fetch approved users (only from allowed reviewers)
              const { approvedUsers, approvalCount } = await this.getApprovedUsers(project.id, mr.iid, allowedReviewers);

              // 🛑 **Remove duplicates and filter out approved users**
              let blockers = [...new Set([...unresolvedUsers, ...pendingReviewers, ...assignedReviewers])]
                .filter(user => !approvedUsers.includes(user));

              console.log(`🔍 MR #${mr.iid}: ${mr.title}`);
              console.log(`   Author: ${mr.author.username}`);
              console.log(`   Reviewers before filtering: ${blockers.length > 0 ? blockers.join(', ') : "None"}`);
              console.log(`   Allowed reviewers: ${allowedReviewers.length > 0 ? allowedReviewers.join(', ') : "None"}`);
              console.log(`   Current approvals from allowed reviewers: ${approvalCount}, Required: ${minApprovalsRequired}`);

              // ✅ Apply the minimum approval requirement (only counting allowed reviewers)
              if (approvalCount >= minApprovalsRequired) {
                console.log(`   ✅ MR #${mr.iid} already has ${approvalCount} approvals from allowed reviewers (Threshold: ${minApprovalsRequired}). Skipping.`);
                return null;
              }

              // ✅ Apply allowed reviewers filtering
              if (allowedReviewers.length > 0) {
                blockers = blockers.filter(user => allowedReviewers.includes(user));

                console.log(`   ✅ Reviewers after filtering: ${blockers.length > 0 ? blockers.join(', ') : "None (MR will be skipped)"}`);

                if (blockers.length === 0) {
                  console.log(`   ❌ Skipping MR #${mr.iid} (No allowed reviewers found)`);
                  return null;
                }
              }

              mr.blockers = blockers;
              return mr;
            })
          );
        })
    );

    return [].concat(...merge_requests).filter(mr => mr !== null);
  }


}

module.exports = GitLab;